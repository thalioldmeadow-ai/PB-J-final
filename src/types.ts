export type ThemeType = 'beige' | 'vibrant' | 'orange' | 'green' | 'blue' | 'pink' | 'dark' | 'vibrate' | 'earthy';
export type FontSizeType = 'small' | 'medium' | 'large';
export type FontType = 'standard';export type ScheduleIntervalType = 60 | 30 | 15 | 10 | 5;

/** Which provider the assistant should try first; "auto" follows the server default. */
export type AiProviderChoice = 'auto' | 'freebuff' | 'openai' | 'huggingface';
/** Chosen by the owner to tune the safety rules; no birthday is collected. */
export type AiAgeBand = 'child' | 'teen' | 'adult';

export interface UserSettings {
  theme: ThemeType;
  fontSize: FontSizeType;
  fontType: FontType;
  scheduleInterval: ScheduleIntervalType;
  showCycleTracking: boolean;
  /** Off keeps every message on the device and uses the built-in replies. */
  aiEnabled?: boolean;
  aiProvider?: AiProviderChoice;
  aiAgeBand?: AiAgeBand;
  /** Off stops saved notes being used or stored at all. Defaults to on. */
  aiMemoryEnabled?: boolean;
  /** Off by default: only an explicit "remember ..." creates a note. */
  aiMemoryAutoSave?: boolean;
}

export interface AiMemoryFact {
  id: string;
  text: string;
  createdAt: string;
  /** What kind of note it is; older notes have no kind and read as "note". */
  kind?: 'preference' | 'goal' | 'project' | 'routine' | 'planning' | 'note';
  /** explicit: the person said "remember"; manual: added in Settings; auto: optional. */
  source?: 'explicit' | 'manual' | 'auto';
  updatedAt?: string;
}

export interface AiConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export type AiAttachmentKind = 'image' | 'video' | 'file';

/** A file attached to one coach message; previews and text stay in the vault. */
export interface AiChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: AiAttachmentKind;
  /** Compressed image, or the first frame of a video, as a data URL. */
  preview?: string;
  /** Extracted text for small text-based files. */
  text?: string;
}

export interface AiStoredMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  provider?: string;
  model?: string;
  attachments?: AiChatAttachment[];
}

export interface AiProviderStatus {
  id: AiProviderChoice;
  label: string;
  configured: boolean;
  enabled?: boolean;
  disabledReason?: string;
  pinnedProvider?: string;
  models: { id: string; label: string; capabilities?: { streaming: boolean; tools: boolean; structuredOutputs: boolean } }[];
}

export interface AiCreditAction {
  key: string;
  label: string;
  description: string;
  cost: number;
}

export interface AiCreditSubscription {
  tier: 'free' | 'plus';
  label: string;
  status: 'active' | 'past_due' | 'canceled' | 'expired' | 'refunded';
  startedAt: string;
  renewalAt: string;
  expiresAt: string;
  cancelAtPeriodEnd?: boolean;
  inGracePeriod?: boolean;
  managementUrl?: string;
  providerRef?: string;
}

export interface AiCreditEntitlements {
  tier: 'free' | 'plus';
  status: 'active' | 'past_due' | 'canceled' | 'expired' | 'refunded';
  active: boolean;
  advancedFeatures: boolean;
  requestsPerDay: number;
  tokensPerDay: number;
  memoryLimit: number;
  historyLimit: number;
  historyCharLimit: number;
  maxAttachments: number;
}

export interface AiCreditPlanOffer {
  id: 'free' | 'plus';
  label: string;
  creditsPerPeriod: number;
  periodDays: number;
  benefits: string[];
}

export interface AiCreditSummary {
  plan: { id: 'free' | 'plus'; label: string };
  subscription: AiCreditSubscription;
  entitlements: AiCreditEntitlements;
  benefits: string[];
  plans: AiCreditPlanOffer[];
  balance: number;
  total: number;
  periodCreditsUsed: number;
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  actions: AiCreditAction[];
}

export interface AiCreditHistoryEntry {
  id: string;
  userId: string;
  action: string;
  actionLabel: string;
  credits: number;
  createdAt: string;
  completedAt?: string;
  status: 'pending' | 'succeeded' | 'failed';
  requestId: string;
  plan: 'free' | 'plus';
  userShortId?: string;
}

export interface AiStatus {
  enabled: boolean;
  defaultModel: string | null;
  backupModel: string | null;
  streaming?: boolean;
  order?: string[];
  providers: AiProviderStatus[];
  limits: {
    requestsPerDay: number;
    tokensPerDay: number;
    costPerMonthUsd: number;
    requestsPerMinutePerClient: number;
    requestsPerDayPerUser?: number;
    costPerMonthPerUserUsd?: number;
  };
  userLimits?: {
    requestsPerDay: number;
    tokensPerDay: number;
    costPerMonthUsd: number;
  };
  /** The caller's own counters, keyed by a hash the server cannot reverse. */
  user?: {
    today: { requests: number; inputTokens: number; outputTokens: number; costUsd: number };
    thisMonth: { requests: number; inputTokens: number; outputTokens: number; costUsd: number };
  } | null;
  cache?: { enabled: boolean; ttlSeconds: number };
  memoryLimit?: number;
  retention?: { serverKeepsPrompts: boolean; ledgerKeepsContent: boolean };
  usage: AiUsage;
}

export interface AiUsage {
  day: string;
  month: string;
  today: { requests: number; inputTokens: number; outputTokens: number; costUsd: number };
  thisMonth: { requests: number; inputTokens: number; outputTokens: number; costUsd: number };
}

export interface UserProfile {
  uid: string;
  email: string;
  settings: UserSettings;
}

export interface Task {
  id: string;
  uid: string;
  title: string;
  description?: string;
  completed: boolean;
  date: string; // ISO 8601 date string
  timeSlot?: string;
  listId?: string;
  order: number;
  type?: 'todo' | 'timeblock';
  time?: string;
  color?: string;
  duration?: number; // in minutes
  subtasks?: { id: string; title: string; completed: boolean }[];
}

export interface RoutineStep {
  id: string;
  title: string;
  subtitle?: string;
  duration?: number; // in seconds
  completed: boolean;
  icon?: string;
}

export interface Routine {
  id: string;
  uid: string;
  name: string;
  type: 'morning' | 'night' | 'custom';
  steps: RoutineStep[];
  order?: number;
  createdAt?: string;
  // Optional per-routine streak (toggled in Settings)
  streakEnabled?: boolean;
  streak?: number;
  bestStreak?: number;
  lastCompletedDate?: string; // YYYY-MM-DD the routine was last fully completed
}

export interface ChallengeDay {
  dayNumber: number;
  task: string;
}

export interface Challenge {
  id: string;
  uid?: string;
  challengeId?: string;
  title: string;
  description: string;
  days: ChallengeDay[];
  startDate?: string;
  completedDays?: number[];
  active?: boolean;
}

export interface ActiveChallenge {
  id: string;
  uid: string;
  challengeId: string;
  startDate: string; // ISO 8601 date string
  currentDay: number;
  completedDays: number[];
}

export interface Meal {
  id: string;
  uid: string;
  date: string; // ISO 8601 date string
  type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  name: string;
  recipe?: string;
  link?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
  ingredients?: string[];
  instructions?: string;
  prepTime?: string;
  cookTime?: string;
  photo?: string;
}

export interface Exercise {
  name: string;
  sets?: string;
  reps?: string;
  weight?: string;
}

export interface Workout {
  id: string;
  uid: string;
  date: string; // ISO 8601 date string
  name: string;
  duration?: string;
  type?: string;
  details?: string;
  link?: string;
  exercises?: Exercise[];
  calories?: number;
  instructions?: string;
  photo?: string;
  createdAt?: string;
}

export interface SleepLog {
  id: string;
  uid: string;
  date: string; // ISO 8601 date string
  duration: string; // e.g. "7h 30m"
  quality: number; // 0-100
  notes?: string;
}

export interface ActivityLog {
  id: string;
  uid: string;
  date: string; // ISO 8601 date string
  steps?: number;
  activeMinutes?: number;
  distance?: string;
  calories?: number;
  activities?: { name: string; duration: string }[];
}

export interface JournalBook {
  id: string;
  uid: string;
  name: string;
  coverColor: string;
  coverIcon: string;
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  uid: string;
  date: string; // ISO 8601 date string
  type?: 'gratitude' | 'prompts' | 'moments' | 'dump' | 'dreams' | 'note' | 'journal';
  content?: string;
  gratitude?: string[];
  promptId?: string;
  promptResponse?: string;
  goodMoments?: string[];
  createdAt?: string;
  journalId?: string;
  prompt?: string;
}

export interface PasswordEntry {
  id: string;
  uid: string;
  service: string;
  username?: string;
  password: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Prompt {
  id: string;
  text: string;
  category: string;
}

export interface CycleEntry {
  id: string;
  uid: string;
  date: string;
  flow: 'none' | 'light' | 'medium' | 'heavy';
  symptoms: string[];
  mood?: string;
  moods?: string[];
  emotions?: string[];
  activities?: string[];
  updatedAt?: string;
}

export interface BudgetSettings {
  id: string;
  uid: string;
  totalBudget: number; // monthly budget, in the user's currency
  updatedAt?: string;
}

export interface Transaction {
  id: string;
  uid: string;
  title: string;
  amount: number; // always a positive magnitude; `type` decides the direction
  type: 'expense' | 'income';
  category: string;
  date: string; // ISO 8601 date string
  createdAt?: string;
}

export interface Goal {
  id: string;
  uid: string;
  title: string;
  progress?: number;
  steps?: { id: string; title: string; completed: boolean }[];
  createdAt?: string;
}

/** One confirmed (or refused) change made through a section assistant. */
export interface AiActionRecord {
  id: string;
  action: string;
  summary: string;
  status: 'applied' | 'failed';
  message: string;
  createdAt: string;
  uid: string;
}

export interface MoodEntry {
  id: string;
  uid: string;
  date: string; // ISO 8601 date string
  moodId: string;
  moodIds?: string[];
  moodLabels?: Record<string, string>;
  intensity: number; // 1-10
  factors: string[];
  factorLabels?: Record<string, string>;
  note?: string;
  createdAt: string;
  energy?: number; // 1-10 energy rating
}
