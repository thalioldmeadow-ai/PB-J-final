import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { adminConfigured, adminTokenMatches } from "../ai/overrides";

export type AdminActorType = "admin_user" | "break_glass";

export interface AdminActor {
  type: AdminActorType;
  /** Supabase auth user id for admin_user; a non-secret fingerprint for break_glass. */
  actorId: string;
  /** Present only for a Supabase administrator. */
  userId?: string;
  email?: string | null;
}

export interface AdminRequest extends Request {
  adminActor?: AdminActor;
}

export class AdminAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function supabaseAdminConfigured(): boolean {
  return Boolean(env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY"));
}

export function adminAccessConfigured(): boolean {
  return adminConfigured() || supabaseAdminConfigured();
}

function supabaseBaseUrl(): string {
  return env("SUPABASE_URL").replace(/\/+$/, "");
}

function supabaseApiKey(): string {
  // The anon key is enough for /auth/v1/user. Fall back to the service key when
  // a deployment only supplies the server credential.
  return env("SUPABASE_ANON_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
}

function bearerToken(req: Request): string {
  const header = (req.get("authorization") ?? "").trim();
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match ? match[1].trim() : "";
  }
  // Kept for the existing token-only dashboard during migration. Query-string
  // and body tokens are deliberately ignored.
  return (req.get("x-admin-token") ?? "").trim();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 5000,
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify a Supabase access token with Supabase Auth. This validates the
 * signature, expiry and token type, rather than decoding unverified claims.
 */
export async function verifySupabaseAccessToken(
  token: string,
): Promise<{ id: string; email: string | null }> {
  if (!supabaseAdminConfigured()) {
    throw new AdminAuthError(503, "supabase_admin_not_configured");
  }

  let response: globalThis.Response;
  try {
    response = await fetchWithTimeout(`${supabaseBaseUrl()}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: supabaseApiKey(),
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch {
    throw new AdminAuthError(503, "supabase_auth_unavailable");
  }

  if (response.status === 401 || response.status === 403) {
    throw new AdminAuthError(401, "invalid_or_expired_token");
  }
  if (!response.ok) {
    throw new AdminAuthError(503, "supabase_auth_unavailable");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminAuthError(503, "supabase_auth_unavailable");
  }

  const user = body as { id?: unknown; email?: unknown } | null;
  if (!user || typeof user.id !== "string" || !UUID_RE.test(user.id)) {
    throw new AdminAuthError(401, "invalid_token_subject");
  }

  return {
    id: user.id,
    email: typeof user.email === "string" ? user.email : null,
  };
}

/**
 * Check the trusted server-side admin_users table with the service role.
 * A Supabase user_metadata flag or a client-supplied role is never accepted.
 */
export async function isSupabaseAdmin(userId: string): Promise<boolean> {
  if (!supabaseAdminConfigured()) {
    throw new AdminAuthError(503, "supabase_admin_not_configured");
  }
  if (!UUID_RE.test(userId)) return false;

  let response: globalThis.Response;
  try {
    response = await fetchWithTimeout(
      `${supabaseBaseUrl()}/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
          Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
          Accept: "application/json",
        },
      },
    );
  } catch {
    throw new AdminAuthError(503, "supabase_admin_lookup_unavailable");
  }

  if (response.status === 401 || response.status === 403) {
    throw new AdminAuthError(503, "supabase_admin_lookup_unavailable");
  }
  if (!response.ok) {
    throw new AdminAuthError(503, "supabase_admin_lookup_unavailable");
  }

  try {
    const rows = (await response.json()) as unknown;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    throw new AdminAuthError(503, "supabase_admin_lookup_unavailable");
  }
}

function breakGlassActor(token: string): AdminActor {
  // Never persist the token itself. The fingerprint is only for correlating
  // break-glass actions in the audit log.
  const fingerprint = createHash("sha256").update(token).digest("hex").slice(0, 16);
  return {
    type: "break_glass",
    actorId: `break_glass:${fingerprint}`,
  };
}

export async function authenticateAdmin(req: Request): Promise<AdminActor> {
  if (!adminAccessConfigured()) {
    throw new AdminAuthError(503, "admin_not_configured");
  }

  const token = bearerToken(req);
  if (!token) {
    throw new AdminAuthError(401, "admin_authentication_required");
  }

  // Temporary break-glass path. It is server-only, audited, and must be
  // retired once every administrator has a Supabase account in admin_users.
  if (adminConfigured() && adminTokenMatches(token)) {
    return breakGlassActor(token);
  }

  if (JWT_RE.test(token) && supabaseAdminConfigured()) {
    const user = await verifySupabaseAccessToken(token);
    if (!(await isSupabaseAdmin(user.id))) {
      throw new AdminAuthError(403, "administrator_required");
    }
    return {
      type: "admin_user",
      actorId: user.id,
      userId: user.id,
      email: user.email,
    };
  }

  throw new AdminAuthError(401, "invalid_admin_credentials");
}

export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    (req as AdminRequest).adminActor = await authenticateAdmin(req);
    next();
  } catch (error) {
    if (error instanceof AdminAuthError) {
      next(error);
      return;
    }
    // Do not leak upstream response bodies or credentials in logs.
    console.error("Admin authentication failed unexpectedly");
    next(new AdminAuthError(503, "admin_authentication_unavailable"));
  }
}

export function adminActor(req: Request): AdminActor | null {
  return (req as AdminRequest).adminActor ?? null;
}
