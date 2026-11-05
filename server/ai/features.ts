/**
 * The product-facing AI feature names.
 *
 * These are the same `mode` values the app already sends with assistant
 * requests. Keeping the list here avoids a dependency cycle between config,
 * overrides and prompt assembly.
 */

export const AI_FEATURES = [
  "planning",
  "budget",
  "habits",
  "progress",
  "lists",
  "general",
] as const;

export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  planning: "Planning",
  budget: "Budget",
  habits: "Routines and habits",
  progress: "Progress",
  lists: "Lists",
  general: "General / Coach",
};

export const isAiFeature = (value: unknown): value is AiFeature =>
  typeof value === "string" && (AI_FEATURES as readonly string[]).includes(value);
