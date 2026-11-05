/**
 * Reusable server-only Supabase clients.
 *
 * This module is intentionally outside `src/` and must never be imported by
 * browser code. The service-role client is the only client with database write
 * authority and is used by trusted server jobs/tests, not by page components.
 *
 * Credentials are read lazily from the process environment. Nothing here logs,
 * returns or serialises a key.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = (name: string): string => (process.env[name] || "").trim();

const usable = (value: string): boolean =>
  Boolean(value) && !value.includes("YOUR_") && !value.includes("YOUR-");

const projectParts = (): { host: string; ref: string | null } | null => {
  const raw = env("SUPABASE_URL");
  if (!usable(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname;
    const match = host.match(/^([a-z0-9]{20})\.supabase\.co$/i);
    return { host, ref: match?.[1] || null };
  } catch {
    return null;
  }
};

export interface SupabaseEnvironmentStatus {
  variables: {
    SUPABASE_URL: boolean;
    SUPABASE_ANON_KEY: boolean;
    SUPABASE_SERVICE_ROLE_KEY: boolean;
  };
  missing: string[];
  projectHost: string | null;
  projectRef: string | null;
  authActivationEnabled: boolean;
}

export const supabaseEnvironmentStatus = (): SupabaseEnvironmentStatus => {
  const variables = {
    SUPABASE_URL: usable(env("SUPABASE_URL")),
    SUPABASE_ANON_KEY: usable(env("SUPABASE_ANON_KEY")),
    SUPABASE_SERVICE_ROLE_KEY: usable(env("SUPABASE_SERVICE_ROLE_KEY")),
  };
  const parts = projectParts();
  return {
    variables,
    missing: Object.entries(variables)
      .filter(([, present]) => !present)
      .map(([name]) => name),
    projectHost: parts?.host || null,
    projectRef: parts?.ref || null,
    authActivationEnabled: env("SUPABASE_AUTH_ENABLED").toLowerCase() === "true",
  };
};

export class SupabaseClientConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseClientConfigError";
  }
}

const requireConfigured = (keyName: "SUPABASE_ANON_KEY" | "SUPABASE_SERVICE_ROLE_KEY") => {
  const status = supabaseEnvironmentStatus();
  if (!status.variables.SUPABASE_URL || !status.variables[keyName]) {
    throw new SupabaseClientConfigError(
      `Supabase is not configured: ${status.missing.join(", ") || keyName}.`,
    );
  }
  return {
    url: env("SUPABASE_URL").replace(/\/+$/, ""),
    key: env(keyName),
  };
};

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
} as const;

let adminClient: SupabaseClient | null = null;
let adminCacheKey = "";
let anonClient: SupabaseClient | null = null;
let anonCacheKey = "";

/** Server-only client using the service role. Never return this to a browser. */
export const getSupabaseAdminClient = (): SupabaseClient => {
  const { url, key } = requireConfigured("SUPABASE_SERVICE_ROLE_KEY");
  const cacheKey = `${url}\u0000${key}`;
  if (adminClient && adminCacheKey === cacheKey) return adminClient;
  adminClient = createClient(url, key, {
    ...clientOptions,
    global: { headers: { "X-Client-Info": "serene-structure-server" } },
  });
  adminCacheKey = cacheKey;
  return adminClient;
};

/** Server-only client using the anon key for non-privileged probes/calls. */
export const getSupabaseAnonClient = (): SupabaseClient => {
  const { url, key } = requireConfigured("SUPABASE_ANON_KEY");
  const cacheKey = `${url}\u0000${key}`;
  if (anonClient && anonCacheKey === cacheKey) return anonClient;
  anonClient = createClient(url, key, {
    ...clientOptions,
    global: { headers: { "X-Client-Info": "serene-structure-server" } },
  });
  anonCacheKey = cacheKey;
  return anonClient;
};
