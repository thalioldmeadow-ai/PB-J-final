import { Task, Routine, Challenge, ActiveChallenge, Meal, Workout, SleepLog, ActivityLog, JournalEntry, UserSettings } from '../types';
import { encryptText, decryptText } from './account';

/**
 * Everything the app saves lives on this phone, inside the browser, encrypted
 * with a key derived from the owner's password. There is no server copy, no
 * sync and no shared account: another person holding the phone sees ciphertext
 * until they know the password.
 *
 * Reads are served from the in-memory copy that was decrypted at sign-in, so
 * screens stay synchronous. Writes update that copy and re-encrypt in the
 * background.
 */

const VAULT_PREFIX = 'serene.vault.v1.';

const STORAGE_KEYS = {
  TASKS: 'serene_tasks',
  ROUTINES: 'serene_routines',
  CHALLENGES: 'serene_challenges',
  ACTIVE_CHALLENGES: 'serene_active_challenges',
  MEALS: 'serene_meals',
  WORKOUTS: 'serene_workouts',
  SLEEP_LOGS: 'serene_sleep_logs',
  ACTIVITY_LOGS: 'serene_activity_logs',
  JOURNAL_ENTRIES: 'serene_journal_entries',
  JOURNALS: 'serene_journals',
  PASSWORDS: 'serene_passwords',
  SETTINGS: 'serene_settings',
  RECIPES: 'serene_recipes',
  LISTS: 'serene_lists',
  CYCLE_ENTRIES: 'serene_cycle_entries',
  MOOD_ENTRIES: 'serene_mood_entries',
  TRANSACTIONS: 'serene_transactions',
  BUDGET: 'serene_budget',
  AI_MESSAGES: 'serene_ai_messages',
  AI_CONVERSATIONS: 'serene_ai_conversations',
  AI_MEMORY: 'serene_ai_memory',
  AI_CREDITS: 'serene_ai_credits',
  GOALS: 'serene_goals',
  AI_ACTIONS: 'serene_ai_actions',
};

class StorageService {
  private cache = new Map<string, any[]>();
  private cryptoKey: CryptoKey | null = null;
  private accountId: string | null = null;
  private writes = new Map<string, Promise<void>>();

  get isUnlocked(): boolean {
    return this.cryptoKey !== null && this.accountId !== null;
  }

  private vaultKey(key: string): string {
    return `${VAULT_PREFIX}${this.accountId}.${key}`;
  }

  private listVaultKeys(): string[] {
    if (!this.accountId) return [];
    const prefix = `${VAULT_PREFIX}${this.accountId}.`;
    const found: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i);
      if (name && name.startsWith(prefix)) found.push(name);
    }
    return found;
  }

  /**
   * Decrypt this account's notes into memory. Called once at sign-in, before
   * any screen is allowed to render.
   */
  async unlock(accountId: string, key: CryptoKey): Promise<void> {
    this.accountId = accountId;
    this.cryptoKey = key;
    this.cache.clear();
    this.writes.clear();

    const prefix = `${VAULT_PREFIX}${accountId}.`;
    for (const name of this.listVaultKeys()) {
      const dataKey = name.slice(prefix.length);
      const raw = localStorage.getItem(name);
      if (!raw) continue;
      try {
        const plain = await decryptText(key, raw);
        const parsed = JSON.parse(plain);
        this.cache.set(dataKey, Array.isArray(parsed) ? parsed : []);
      } catch (error) {
        console.error(`Could not unlock ${dataKey}:`, error);
        this.cache.set(dataKey, []);
      }
    }

    await this.adoptDeviceData();

    for (const dataKey of Object.values(STORAGE_KEYS)) {
      if (!this.cache.has(dataKey)) this.cache.set(dataKey, []);
    }
  }

  lock(): void {
    this.cache.clear();
    this.cryptoKey = null;
    this.accountId = null;
    this.writes.clear();
  }

  /**
   * Data written by older versions of the app sits unencrypted in this
   * browser. The first account created after this point takes ownership of it:
   * the records are encrypted and the plaintext copies removed.
   */
  private async adoptDeviceData(): Promise<void> {
    if (!this.accountId) return;
    const marker = `${VAULT_PREFIX}${this.accountId}.__adopted`;
    if (localStorage.getItem(marker) === '1') return;

    const legacyKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i);
      if (!name || !name.startsWith('serene_') || name.startsWith(VAULT_PREFIX)) continue;
      const raw = localStorage.getItem(name);
      if (!raw || !raw.trim().startsWith('[')) continue;
      legacyKeys.push(name);
    }

    for (const name of legacyKeys) {
      const raw = localStorage.getItem(name);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) continue;
        const existing = this.cache.get(name) || [];
        const merged = [...parsed, ...existing];
        this.cache.set(name, merged);
        await this.write(name, merged);
        localStorage.removeItem(name);
      } catch {
        // Not ours to move; leave it alone.
      }
    }

    localStorage.setItem(marker, '1');
  }

  private read<T>(key: string): T[] {
    const items = this.cache.get(key);
    return Array.isArray(items) ? (items as T[]) : [];
  }

  private notify(key: string, data: any[]): void {
    window.dispatchEvent(new CustomEvent('storage-update', { detail: { key } }));
  }

  private set<T>(key: string, data: T[]): void {
    this.cache.set(key, data);
    void this.write(key, data);
    this.notify(key, data);
  }

  private write(key: string, data: any[]): Promise<void> {
    const keyForVault = this.vaultKey(key);
    const snapshot = JSON.stringify(data);
    const encryptionKey = this.cryptoKey;
    if (!encryptionKey) return Promise.resolve();

    const previous = this.writes.get(key) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          const cipher = await encryptText(encryptionKey, snapshot);
          localStorage.setItem(keyForVault, cipher);
        } catch (error) {
          console.error(`Could not save ${key} on this phone:`, error);
        }
      });

    this.writes.set(key, next);
    return next;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 11) + Math.random().toString(36).substring(2, 11);
  }

  // Generic CRUD
  async getAll<T>(key: string): Promise<T[]> {
    return this.read<T>(key);
  }

  async update(key: string, id: string, updates: any): Promise<void> {
    const items = this.read<any>(key);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return;
    items[index] = { ...items[index], ...updates };
    this.set(key, items);
  }

  async add(key: string, item: any): Promise<string> {
    const id = this.generateId();
    const newItem = { ...item, id };
    const items = this.read<any>(key);
    items.push(newItem);
    this.set(key, items);
    return id;
  }

  async delete(key: string, id: string): Promise<void> {
    const items = this.read<any>(key);
    this.set(key, items.filter((item) => item.id !== id));
  }

  async getById<T extends { id: string }>(key: string, id: string): Promise<T | null> {
    const items = this.read<T>(key);
    return items.find((item) => item.id === id) || null;
  }

  /** Replace a whole collection (used by bulk imports and the capture box). */
  async replaceAll(key: string, items: any[]): Promise<void> {
    this.set(key, items);
  }

  /** Wait for an encrypted write, used before relying on a new credential. */
  async flush(key: string): Promise<void> {
    await (this.writes.get(key) || Promise.resolve());
  }

  // Subscription helpers
  subscribe(key: string, callback: (data: any[]) => void, _uid?: string): () => void {
    callback(this.read(key));

    const localHandler = (event: any) => {
      if (event.detail?.key === key) callback(this.read(key));
    };

    // Another tab of the same account wrote something: decrypt and mirror it.
    const crossTabHandler = async (event: StorageEvent) => {
      if (!event.key || !this.accountId) return;
      if (!event.key.startsWith(`${VAULT_PREFIX}${this.accountId}.`)) return;
      if (event.key === this.vaultKey(key) && event.newValue) {
        try {
          const plain = await decryptText(this.cryptoKey as CryptoKey, event.newValue);
          const parsed = JSON.parse(plain);
          if (Array.isArray(parsed)) {
            this.cache.set(key, parsed);
            callback(parsed);
          }
        } catch (error) {
          console.error(`Could not read ${key} from another tab:`, error);
        }
      }
    };

    window.addEventListener('storage-update', localHandler as EventListener);
    window.addEventListener('storage', crossTabHandler as EventListener);

    return () => {
      window.removeEventListener('storage-update', localHandler as EventListener);
      window.removeEventListener('storage', crossTabHandler as EventListener);
    };
  }

  get key() { return STORAGE_KEYS; }
}

export const storage = new StorageService();
export default storage;
