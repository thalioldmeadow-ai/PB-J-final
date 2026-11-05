/**
 * Legacy credit migration planning.
 *
 * Pure functions only: no filesystem, network or Supabase access. The runner in
 * scripts/migrate-legacy-credits.ts supplies verified profile mappings and the
 * set of already-imported source wallets.
 *
 * A legacy account is eligible only when:
 *   * its stored shape is valid;
 *   * exactly one Supabase profile has that legacy_user_id;
 *   * it has no request/history rows that would require lossy reconstruction;
 *   * neither the source wallet nor the profile has already been imported.
 *
 * The planner never derives ownership from a device id, token hash, email or
 * user-supplied value.
 */

import { createHash } from "crypto";

export const LEGACY_SOURCE_RE = /^[a-f0-9]{16,64}$/;
const LEGACY_PLAN = new Set(["free", "plus"]);

export interface LegacyCreditFileLike {
  version?: unknown;
  accounts?: unknown;
  requests?: unknown;
  history?: unknown;
}

export interface LegacyCreditCandidate {
  sourceKey: string;
  balance: number;
  allocated: number;
  plan: "free" | "plus";
  historyCount: number;
  requestCount: number;
  checksum: string;
  sourcePlan: Record<string, unknown>;
}

export interface RejectedLegacyAccount {
  sourceKey: string;
  reason: string;
}

export interface LegacyProfileMapping {
  id: string;
  legacyUserId: string;
}

export interface LegacyImportRecord {
  sourceKey: string;
  userId: string;
}

export type LegacyMigrationStatus =
  | "ready"
  | "already_imported"
  | "unmatched"
  | "ambiguous"
  | "history_requires_review"
  | "source_conflict";

export interface LegacyMigrationRow {
  sourceKey: string;
  status: LegacyMigrationStatus;
  balance: number;
  allocated: number;
  plan: "free" | "plus";
  historyCount: number;
  requestCount: number;
  checksum: string;
  profileId?: string;
  reason?: string;
}

export interface LegacyMigrationPlan {
  rows: LegacyMigrationRow[];
  rejected: RejectedLegacyAccount[];
  summary: Record<LegacyMigrationStatus | "invalid", number>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const finiteNonNegative = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const uniqueString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Stable checksum for a legacy wallet, excluding its secret token hash. */
export const legacyCandidateChecksum = (
  sourceKey: string,
  account: Record<string, unknown>,
  historyCount: number,
  requestCount: number,
): string => {
  const fields = {
    sourceKey,
    plan: account.plan,
    balance: account.balance,
    allocated: account.allocated,
    periodCreditsUsed: account.periodCreditsUsed,
    periodStart: account.periodStart,
    periodEnd: account.periodEnd,
    subscriptionStatus: account.subscriptionStatus,
    createdAt: account.createdAt,
    historyCount,
    requestCount,
  };
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
};

/**
 * Extract valid legacy wallets. The raw token hash is deliberately not copied
 * into a candidate, report or log.
 */
export const readLegacyCandidates = (
  raw: LegacyCreditFileLike,
): { candidates: LegacyCreditCandidate[]; rejected: RejectedLegacyAccount[] } => {
  const candidates: LegacyCreditCandidate[] = [];
  const rejected: RejectedLegacyAccount[] = [];
  const accounts =
    raw.accounts && typeof raw.accounts === "object"
      ? (raw.accounts as Record<string, unknown>)
      : {};
  const history = Array.isArray(raw.history) ? raw.history : [];
  const requests =
    raw.requests && typeof raw.requests === "object"
      ? (raw.requests as Record<string, unknown>)
      : {};

  for (const [key, value] of Object.entries(accounts)) {
    const sourceKey = key.trim().toLowerCase();
    if (!LEGACY_SOURCE_RE.test(sourceKey)) {
      rejected.push({ sourceKey: key.slice(0, 80), reason: "invalid_source_key" });
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      rejected.push({ sourceKey, reason: "invalid_account_shape" });
      continue;
    }
    const account = value as Record<string, unknown>;
    if (account.userId !== key) {
      rejected.push({ sourceKey, reason: "account_key_mismatch" });
      continue;
    }
    if (!LEGACY_PLAN.has(String(account.plan))) {
      rejected.push({ sourceKey, reason: "invalid_plan" });
      continue;
    }
    const balance = finiteNonNegative(account.balance);
    const allocated = finiteNonNegative(account.allocated);
    if (balance === null || allocated === null || allocated < balance) {
      rejected.push({ sourceKey, reason: "invalid_balance" });
      continue;
    }

    const historyCount = history.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>).userId === key,
    ).length;
    const requestCount = Object.values(requests).filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>).userId === key,
    ).length;

    candidates.push({
      sourceKey,
      balance,
      allocated,
      plan: String(account.plan) as "free" | "plus",
      historyCount,
      requestCount,
      checksum: legacyCandidateChecksum(sourceKey, account, historyCount, requestCount),
      sourcePlan: {
        periodCreditsUsed: account.periodCreditsUsed,
        periodStart: account.periodStart,
        periodEnd: account.periodEnd,
        subscriptionStatus: account.subscriptionStatus,
        createdAt: account.createdAt,
      },
    });
  }

  candidates.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
  return { candidates, rejected };
};

const emptySummary = (): Record<LegacyMigrationStatus | "invalid", number> => ({
  ready: 0,
  already_imported: 0,
  unmatched: 0,
  ambiguous: 0,
  history_requires_review: 0,
  source_conflict: 0,
  invalid: 0,
});

/**
 * Decide what can be imported. `profiles` must come from a trusted server query
 * of profiles.legacy_user_id, not from browser input.
 */
export const planLegacyCreditMigration = (
  raw: LegacyCreditFileLike,
  profiles: LegacyProfileMapping[],
  imports: LegacyImportRecord[],
): LegacyMigrationPlan => {
  const { candidates, rejected } = readLegacyCandidates(raw);
  const summary = emptySummary();
  summary.invalid = rejected.length;

  const profilesByLegacy = new Map<string, LegacyProfileMapping[]>();
  for (const profile of profiles) {
    if (!UUID_RE.test(profile.id)) continue;
    const key = profile.legacyUserId.trim().toLowerCase();
    if (!LEGACY_SOURCE_RE.test(key)) continue;
    const list = profilesByLegacy.get(key) || [];
    list.push({ id: profile.id, legacyUserId: key });
    profilesByLegacy.set(key, list);
  }

  const importsBySource = new Map(imports.map((entry) => [entry.sourceKey, entry.userId]));
  const importedProfiles = new Set(imports.map((entry) => entry.userId));

  const rows: LegacyMigrationRow[] = [];
  for (const candidate of candidates) {
    const base = {
      sourceKey: candidate.sourceKey,
      balance: candidate.balance,
      allocated: candidate.allocated,
      plan: candidate.plan,
      historyCount: candidate.historyCount,
      requestCount: candidate.requestCount,
      checksum: candidate.checksum,
    };

    const existingSource = importsBySource.get(candidate.sourceKey);
    if (existingSource) {
      rows.push({
        ...base,
        status: "already_imported",
        profileId: existingSource,
        reason: "this source wallet is already recorded as imported",
      });
      summary.already_imported += 1;
      continue;
    }

    const matches = profilesByLegacy.get(candidate.sourceKey) || [];
    if (matches.length === 0) {
      rows.push({
        ...base,
        status: "unmatched",
        reason: "no Supabase profile has this legacy_user_id",
      });
      summary.unmatched += 1;
      continue;
    }
    if (matches.length > 1) {
      rows.push({
        ...base,
        status: "ambiguous",
        reason: "more than one Supabase profile claims this legacy_user_id",
      });
      summary.ambiguous += 1;
      continue;
    }

    const profileId = matches[0].id;
    if (importedProfiles.has(profileId)) {
      rows.push({
        ...base,
        status: "source_conflict",
        profileId,
        reason: "this profile already imported a different legacy wallet",
      });
      summary.source_conflict += 1;
      continue;
    }

    if (candidate.historyCount > 0 || candidate.requestCount > 0) {
      rows.push({
        ...base,
        status: "history_requires_review",
        profileId,
        reason:
          "legacy request/history rows exist; preserve them manually rather than importing only the balance",
      });
      summary.history_requires_review += 1;
      continue;
    }

    rows.push({
      ...base,
      status: "ready",
      profileId,
      reason: "verified legacy_user_id mapping; exact balance will be set, not added",
    });
    summary.ready += 1;
  }

  return { rows, rejected, summary };
};

/** A report must never contain token hashes, credentials or ciphertext. */
export const redactMigrationPlan = (plan: LegacyMigrationPlan) => ({
  generatedAt: new Date().toISOString(),
  summary: plan.summary,
  rows: plan.rows,
  rejected: plan.rejected,
});
