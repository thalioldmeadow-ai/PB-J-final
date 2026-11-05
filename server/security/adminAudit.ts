import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AdminActor } from "./adminAuth";

/**
 * Administrator audit records.
 *
 * The live application currently uses local JSON stores and custom session
 * auth. When Supabase server credentials are configured, audit rows are written
 * through the service-role-only record_admin_audit RPC. Otherwise they are
 * appended atomically to data/admin-audit.json (mode 0600).
 *
 * Callers must pass only safe metadata. Never pass tokens, passwords, API keys,
 * prompts, journal text or ciphertext.
 */

export interface AdminAuditInput {
  actor: AdminActor;
  action: string;
  targetUserId?: string | null;
  success: boolean;
  errorCode?: string | null;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface AdminAuditRecord {
  id: string;
  adminUserId: string | null;
  actorType: "admin_user" | "break_glass" | "system";
  actorId: string;
  action: string;
  targetUserId: string | null;
  success: boolean;
  errorCode: string | null;
  requestId: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface AuditFile {
  version: 1;
  entries: AdminAuditRecord[];
}

const MAX_LOCAL_ENTRIES = 5000;
const MAX_ACTION_LENGTH = 120;
const MAX_ERROR_LENGTH = 120;
const MAX_ACTOR_LENGTH = 120;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dataDir(): string {
  return path.join(process.cwd(), "data");
}

function auditFile(): string {
  return path.join(dataDir(), "admin-audit.json");
}

function supabaseUrl(): string {
  return (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
}

function supabaseServiceKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const serialised = JSON.stringify(value);
    if (serialised.length > 32_000) return { truncated: true };
    return JSON.parse(serialised) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildRecord(input: AdminAuditInput, requestId: string): AdminAuditRecord {
  return {
    id: randomUUID(),
    adminUserId: input.actor.type === "admin_user" ? input.actor.userId ?? null : null,
    actorType: input.actor.type,
    actorId: (cleanText(input.actor.actorId, MAX_ACTOR_LENGTH) ?? "unknown").slice(
      0,
      MAX_ACTOR_LENGTH,
    ),
    action: cleanText(input.action, MAX_ACTION_LENGTH) ?? "unknown",
    targetUserId: cleanText(input.targetUserId, 120),
    success: Boolean(input.success),
    errorCode: cleanText(input.errorCode, MAX_ERROR_LENGTH),
    requestId,
    createdAt: new Date().toISOString(),
    metadata: safeMetadata(input.metadata),
  };
}

async function recordInSupabase(record: AdminAuditRecord): Promise<boolean> {
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${url}/rest/v1/rpc/record_admin_audit`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        p_admin_user_id: record.adminUserId,
        p_actor_type: record.actorType,
        p_actor_id: record.actorId,
        p_action: record.action,
        // The audit foreign key only accepts Supabase UUIDs. Legacy accounts
        // use 40-hex ids and are retained in the text reference column.
        p_target_user_id:
          record.targetUserId && UUID_RE.test(record.targetUserId)
            ? record.targetUserId
            : null,
        p_target_user_ref: record.targetUserId,
        p_success: record.success,
        p_error_code: record.errorCode,
        p_request_id: record.requestId,
        p_metadata: record.metadata,
      }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function appendLocal(record: AdminAuditRecord): void {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = auditFile();

  let parsed: AuditFile = { version: 1, entries: [] };
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8");
    const candidate = JSON.parse(raw) as Partial<AuditFile>;
    if (!candidate || !Array.isArray(candidate.entries)) {
      throw new Error("admin_audit_file_invalid");
    }
    parsed = {
      version: 1,
      entries: candidate.entries as AdminAuditRecord[],
    };
  }

  parsed.entries.unshift(record);
  if (parsed.entries.length > MAX_LOCAL_ENTRIES) {
    parsed.entries = parsed.entries.slice(0, MAX_LOCAL_ENTRIES);
  }

  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // The file mode is best-effort on filesystems that do not support it.
    }
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

export async function recordAdminAudit(
  input: AdminAuditInput,
): Promise<{ ok: boolean; storage: "supabase" | "json" | "none" }> {
  const requestId = cleanText(input.requestId, 120) ?? randomUUID();
  const record = buildRecord(input, requestId);

  if (await recordInSupabase(record)) {
    return { ok: true, storage: "supabase" };
  }

  try {
    appendLocal(record);
    return { ok: true, storage: "json" };
  } catch {
    // Do not include actor, metadata or the underlying error; an audit failure
    // must not turn into a secret leak in logs.
    console.error("Admin audit write failed");
    return { ok: false, storage: "none" };
  }
}

/** Read local audit records for tests and administrator diagnostics. */
export function listLocalAdminAudit(limit = 100): AdminAuditRecord[] {
  const file = auditFile();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AuditFile>;
    if (!parsed || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}
