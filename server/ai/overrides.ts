/**
 * Operator overrides for the AI layer.
 *
 * Values set in the admin dashboard are stored here, separate from the
 * environment, so a change does not need a restart and does not edit .env.
 * Nothing secret is stored: provider keys stay in the environment and are only
 * ever read by the server.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { AiLimits, ProviderId } from "./config";
import { AI_FEATURES, type AiFeature } from "./features";

export interface AiOverrides {
  /** False pauses all AI requests; true resumes them when a model is available. */
  aiEnabled?: boolean;
  /** Emergency pause is separate from the ordinary on/off switch. */
  emergencyPaused?: boolean;
  emergencyReason?: string;
  emergencyAt?: string;
  emergencyBy?: string;
  /** False disables a provider that has a key; true enables one within policy. */
  providers?: Partial<Record<ProviderId, boolean>>;
  /** "provider:model", or null to fall back to the environment default. */
  defaultModel?: string | null;
  backupModel?: string | null;
  /** Explicit ordered fallback chain. `backupModel` remains the legacy first entry. */
  fallbackModels?: string[];
  /** Models switched off by an administrator, as "provider:model". */
  disabledModels?: string[];
  /** Optional per-feature model overrides. A missing/null entry uses the default. */
  featureModels?: Partial<Record<AiFeature, string | null>>;
  limits?: Partial<
    Pick<
      AiLimits,
      | "requestsPerDay"
      | "tokensPerDay"
      | "monthlyBudgetAud"
      | "monthlyHardLimitAud"
      | "dailyLimitAud"
      | "costPerDayUsd"
      | "costPerMonthUsd"
      | "requestsPerDayPerUser"
      | "tokensPerDayPerUser"
      | "costPerMonthPerUserUsd"
      | "perUserDailyLimitAud"
      | "perUserMonthlyLimitAud"
    >
  >;
  /** Percentages of a spending ceiling that raise an admin warning. */
  warningThresholds?: number[];
  /** Optional per-model daily/monthly spending ceilings, in AUD. */
  modelLimits?: Record<string, { dailyAud?: number; monthlyAud?: number }>;
  /** Daily request ceiling per provider. */
  providerLimits?: Partial<Record<ProviderId, number>>;
  /** Opaque user hashes whose AI access is paused. */
  disabledUsers?: string[];
  updatedAt?: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "ai-settings.json");
const HISTORY_FILE = path.join(DATA_DIR, "ai-settings-history.json");
const MAX_SNAPSHOTS = 10;

interface ConfigSnapshot {
  savedAt: string;
  overrides: AiOverrides;
}

interface ConfigHistory {
  version: 1;
  snapshots: ConfigSnapshot[];
}

let cached: AiOverrides | null = null;

const isProvider = (value: unknown): value is ProviderId =>
  value === "freebuff" || value === "openai" || value === "huggingface";

/** Only known keys and finite numbers survive a save, so a bad body cannot poison config. */
export const cleanOverrides = (raw: unknown): AiOverrides => {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: AiOverrides = {};

  if (typeof input.aiEnabled === "boolean") out.aiEnabled = input.aiEnabled;
  if (typeof input.emergencyPaused === "boolean") out.emergencyPaused = input.emergencyPaused;
  if (typeof input.emergencyReason === "string") {
    out.emergencyReason = input.emergencyReason.trim().slice(0, 300);
  }
  if (typeof input.emergencyAt === "string" && !Number.isNaN(Date.parse(input.emergencyAt))) {
    out.emergencyAt = new Date(input.emergencyAt).toISOString();
  }
  if (typeof input.emergencyBy === "string") {
    out.emergencyBy = input.emergencyBy.trim().slice(0, 160);
  }

  if (Array.isArray(input.warningThresholds)) {
    out.warningThresholds = [
      ...new Set(
        input.warningThresholds
          .map((value) => Math.round(Number(value)))
          .filter((value) => Number.isFinite(value) && value > 0 && value < 100),
      ),
    ]
      .sort((a, b) => a - b)
      .slice(0, 6);
  }

  if (Array.isArray(input.disabledUsers)) {
    out.disabledUsers = [
      ...new Set(
        input.disabledUsers
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().toLowerCase())
          .filter((value) => /^[a-f0-9]{16,64}$/.test(value)),
      ),
    ].slice(0, 500);
  }

  if (input.providers && typeof input.providers === "object") {
    const providers: Partial<Record<ProviderId, boolean>> = {};
    for (const [key, value] of Object.entries(input.providers as Record<string, unknown>)) {
      if (isProvider(key) && typeof value === "boolean") providers[key] = value;
    }
    out.providers = providers;
  }

  const modelRef = (value: unknown): string | null | undefined => {
    if (value === null) return null;
    if (typeof value !== "string") return undefined;
    const clean = value.trim();
    if (!clean) return null;
    return /^[a-z]+:[A-Za-z0-9._:\/-]{1,120}$/.test(clean) ? clean : undefined;
  };

  const defaultModel = modelRef(input.defaultModel);
  if (defaultModel !== undefined) out.defaultModel = defaultModel;
  const backupModel = modelRef(input.backupModel);
  if (backupModel !== undefined) out.backupModel = backupModel;

  if (Array.isArray(input.fallbackModels)) {
    out.fallbackModels = [
      ...new Set(
        input.fallbackModels
          .map((value) => modelRef(value))
          .filter((value): value is string => typeof value === "string"),
      ),
    ].slice(0, 3);
  }

  if (Array.isArray(input.disabledModels)) {
    out.disabledModels = [
      ...new Set(
        input.disabledModels
          .map((value) => modelRef(value))
          .filter((value): value is string => typeof value === "string"),
      ),
    ].slice(0, 100);
  }

  if (input.featureModels && typeof input.featureModels === "object") {
    const source = input.featureModels as Record<string, unknown>;
    const featureModels: Partial<Record<AiFeature, string | null>> = {};
    for (const feature of AI_FEATURES) {
      if (!(feature in source)) continue;
      const value = modelRef(source[feature]);
      if (value !== undefined) featureModels[feature] = value;
    }
    out.featureModels = featureModels;
  }

  if (input.limits && typeof input.limits === "object") {
    const source = input.limits as Record<string, unknown>;
    const limits: AiOverrides["limits"] = {};
    const ranges: Record<string, [number, number]> = {
      requestsPerDay: [1, 100_000],
      tokensPerDay: [1_000, 100_000_000],
      monthlyBudgetAud: [0, 100_000],
      monthlyHardLimitAud: [0, 100_000],
      dailyLimitAud: [0, 100_000],
      costPerDayUsd: [0, 10_000],
      costPerMonthUsd: [0, 10_000],
      requestsPerDayPerUser: [1, 10_000],
      tokensPerDayPerUser: [1_000, 100_000_000],
      costPerMonthPerUserUsd: [0, 10_000],
      perUserDailyLimitAud: [0, 100_000],
      perUserMonthlyLimitAud: [0, 100_000],
    };
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const value = Number(source[key]);
      if (!Number.isFinite(value)) continue;
      limits[key as keyof NonNullable<AiOverrides["limits"]>] = Math.min(max, Math.max(min, value));
    }
    out.limits = limits;
  }

  if (input.modelLimits && typeof input.modelLimits === "object") {
    const modelLimits: Record<string, { dailyAud?: number; monthlyAud?: number }> = {};
    for (const [key, value] of Object.entries(input.modelLimits as Record<string, unknown>)) {
      const ref = modelRef(key);
      if (!ref || !value || typeof value !== "object") continue;
      const source = value as Record<string, unknown>;
      const next: { dailyAud?: number; monthlyAud?: number } = {};
      for (const field of ["dailyAud", "monthlyAud"] as const) {
        const parsed = Number(source[field]);
        if (Number.isFinite(parsed)) next[field] = Math.min(100_000, Math.max(0, parsed));
      }
      if (Object.keys(next).length > 0) modelLimits[ref] = next;
    }
    out.modelLimits = modelLimits;
  }

  if (input.providerLimits && typeof input.providerLimits === "object") {
    const providerLimits: Partial<Record<ProviderId, number>> = {};
    for (const [key, value] of Object.entries(input.providerLimits as Record<string, unknown>)) {
      const parsed = Number(value);
      if (isProvider(key) && Number.isFinite(parsed)) {
        providerLimits[key] = Math.round(Math.min(1_000_000, Math.max(1, parsed)));
      }
    }
    out.providerLimits = providerLimits;
  }

  return out;
};

export const loadOverrides = (): AiOverrides => {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const cleaned = cleanOverrides(raw);
    if (raw && typeof raw.updatedAt === "string") cleaned.updatedAt = raw.updatedAt;
    cached = cleaned;
  } catch {
    cached = {};
  }
  return cached;
};

const hasConfiguration = (value: AiOverrides): boolean =>
  Object.keys(value).some((key) => key !== "updatedAt");

const readHistory = (): ConfigHistory => {
  try {
    const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as Partial<ConfigHistory>;
    return {
      version: 1,
      snapshots: Array.isArray(raw.snapshots) ? raw.snapshots.slice(0, MAX_SNAPSHOTS) : [],
    };
  } catch {
    return { version: 1, snapshots: [] };
  }
};

const writeHistory = (history: ConfigHistory): void => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${HISTORY_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(history, null, 2), { mode: 0o600 });
    fs.renameSync(temp, HISTORY_FILE);
  } catch {
    // A read-only disk still keeps the current in-memory configuration.
  }
};

const snapshot = (overrides: AiOverrides): ConfigSnapshot => ({
  savedAt: new Date().toISOString(),
  overrides: cleanOverrides(overrides),
});

const appendSnapshot = (overrides: AiOverrides): void => {
  if (!hasConfiguration(overrides)) return;
  const history = readHistory();
  history.snapshots.unshift(snapshot(overrides));
  history.snapshots = history.snapshots.slice(0, MAX_SNAPSHOTS);
  writeHistory(history);
};

const writeOverrides = (next: AiOverrides): AiOverrides => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temp, FILE);
  } catch {
    // The dashboard still works for this process even on a read-only disk.
  }
  cached = next;
  return next;
};

export const saveOverrides = (input: unknown, createSnapshot = true): AiOverrides => {
  const previous = loadOverrides();
  const cleaned = cleanOverrides(input);
  // Partial dashboard saves must not erase unrelated controls (for example a
  // budget save should not silently re-enable a provider).
  const next: AiOverrides = {
    ...previous,
    ...cleaned,
    providers: { ...(previous.providers || {}), ...(cleaned.providers || {}) },
    limits: { ...(previous.limits || {}), ...(cleaned.limits || {}) },
    modelLimits:
      cleaned.modelLimits !== undefined
        ? { ...(previous.modelLimits || {}), ...cleaned.modelLimits }
        : previous.modelLimits,
    warningThresholds:
      cleaned.warningThresholds !== undefined
        ? cleaned.warningThresholds
        : previous.warningThresholds,
    providerLimits: { ...(previous.providerLimits || {}), ...(cleaned.providerLimits || {}) },
    featureModels: { ...(previous.featureModels || {}), ...(cleaned.featureModels || {}) },
    fallbackModels:
      cleaned.fallbackModels !== undefined ? cleaned.fallbackModels : previous.fallbackModels,
    disabledModels:
      cleaned.disabledModels !== undefined ? cleaned.disabledModels : previous.disabledModels,
    updatedAt: new Date().toISOString(),
  };
  if (createSnapshot) appendSnapshot(previous);
  return writeOverrides(next);
};

/** Restore the most recent pre-change configuration. */
export const restorePreviousOverrides = (): AiOverrides | null => {
  const history = readHistory();
  const previous = history.snapshots.shift();
  if (!previous) return null;
  const current = loadOverrides();
  if (hasConfiguration(current)) {
    history.snapshots.unshift(snapshot(current));
    history.snapshots = history.snapshots.slice(0, MAX_SNAPSHOTS);
  }
  writeHistory(history);
  const restored: AiOverrides = {
    ...cleanOverrides(previous.overrides),
    updatedAt: new Date().toISOString(),
  };
  return writeOverrides(restored);
};

export const configHistorySummary = (): {
  available: boolean;
  count: number;
  previousAt: string | null;
} => {
  const history = readHistory();
  return {
    available: history.snapshots.length > 0,
    count: history.snapshots.length,
    previousAt: history.snapshots[0]?.savedAt || null,
  };
};

/** Test helper: forget the in-memory copy so the file is read again. */
export const resetOverridesCache = () => {
  cached = null;
};

/** Pause or resume AI for one opaque user hash. */
export const setUserAiDisabled = (userId: string, disabled: boolean): AiOverrides => {
  const current = loadOverrides();
  const users = new Set(current.disabledUsers || []);
  if (disabled) users.add(userId);
  else users.delete(userId);
  return saveOverrides({ ...current, disabledUsers: [...users] }, false);
};

/** The admin credential is a server-only environment value, never sent to the browser. */
export const adminConfigured = (): boolean => Boolean(process.env.AI_ADMIN_TOKEN?.trim());

export const adminTokenMatches = (candidate: string | undefined): boolean => {
  const expected = process.env.AI_ADMIN_TOKEN?.trim() || "";
  if (!expected || !candidate) return false;
  // Hash both first so the comparison is fixed length and constant time.
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(candidate).digest();
  return crypto.timingSafeEqual(a, b);
};
