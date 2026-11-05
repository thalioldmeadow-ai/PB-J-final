/**
 * Accounts that live only on this phone.
 *
 * There is no server and no cloud copy: an account is an email, a name and a
 * password, and the password never leaves the device. It is stretched with
 * PBKDF2-SHA256 into an AES-GCM key, and everything the app stores is encrypted
 * with that key (see storage.ts). Whoever holds the phone without the password
 * sees only ciphertext.
 */

const ACCOUNTS_KEY = 'serene.accounts.v1';
const SESSION_KEY = 'serene.session.v1';
const CHECK_TEXT = 'serene-vault-check';
/**
 * OWASP's current floor for PBKDF2-HMAC-SHA256 is 600,000 iterations. Accounts
 * created before this change record their own count, so raising the default
 * never locks out an existing vault.
 */
const ITERATIONS = 600_000;
const LEGACY_ITERATIONS = 210_000;

export interface LocalAccount {
  id: string;
  email: string;
  name: string;
  salt: string;
  check: string;
  /** PBKDF2 rounds used for this account. Absent on older accounts. */
  iterations?: number;
  createdAt: string;
}

export interface Unlocked {
  account: LocalAccount;
  key: CryptoKey;
}

export interface PublicUser {
  uid: string;
  /** Local encrypted-vault id. Never sent to the server. */
  vaultId: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  isAnonymous: boolean;
  providerId: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const randomId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return bytesToBase64(bytes).replace(/[^a-zA-Z0-9]/g, '').slice(0, 14);
};

/** Stretch a password into the key that locks this account's data. */
const deriveKey = async (
  password: string,
  salt: Uint8Array,
  iterations: number = ITERATIONS
): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
};

export const encryptText = async (key: CryptoKey, text: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text));
  const payload = new Uint8Array(iv.length + cipher.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(cipher), iv.length);
  return bytesToBase64(payload);
};

export const decryptText = async (key: CryptoKey, payload: string): Promise<string> => {
  const bytes = base64ToBytes(payload);
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return decoder.decode(plain);
};

export const listAccounts = (): LocalAccount[] => {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeAccounts = (accounts: LocalAccount[]) => {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
};

const normaliseEmail = (email: string) => email.trim().toLowerCase();

export const toPublicUser = (
  account: LocalAccount,
  server?: { id: string; name: string }
): PublicUser => ({
  uid: server?.id || account.id,
  vaultId: account.id,
  email: account.email,
  displayName: server?.name || account.name,
  photoURL: null,
  isAnonymous: false,
  providerId: server ? 'server' : 'local',
});

export const createAccount = async (
  name: string,
  email: string,
  password: string
): Promise<Unlocked> => {
  const cleanName = name.trim();
  const cleanEmail = normaliseEmail(email);

  if (!cleanName) throw new Error('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('That email address does not look right.');
  }
  if (password.length < 8) {
    throw new Error('Use a password of at least 8 characters.');
  }
  if (listAccounts().some((account) => account.email === cleanEmail)) {
    throw new Error('An account with that email already exists on this phone. Sign in instead.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const account: LocalAccount = {
    id: randomId(),
    email: cleanEmail,
    name: cleanName,
    salt: bytesToBase64(salt),
    check: await encryptText(key, CHECK_TEXT),
    iterations: ITERATIONS,
    createdAt: new Date().toISOString(),
  };

  writeAccounts([...listAccounts(), account]);
  await saveSession(account, key);
  return { account, key };
};

export const signIn = async (email: string, password: string): Promise<Unlocked> => {
  const account = listAccounts().find((entry) => entry.email === normaliseEmail(email));
  if (!account) {
    throw new Error('No account with that email on this phone.');
  }

  const key = await deriveKey(
    password,
    base64ToBytes(account.salt),
    account.iterations ?? LEGACY_ITERATIONS
  );
  try {
    const check = await decryptText(key, account.check);
    if (check !== CHECK_TEXT) throw new Error('mismatch');
  } catch {
    throw new Error('That password does not unlock this account.');
  }

  await saveSession(account, key);
  return { account, key };
};

/**
 * The unlocked key is kept in sessionStorage: a reload stays signed in, but
 * closing the browser (or opening a new tab) locks the app again and the
 * password has to be typed.
 */
export const saveSession = async (account: LocalAccount, key: CryptoKey): Promise<void> => {
  const raw = await crypto.subtle.exportKey('raw', key);
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ id: account.id, key: bytesToBase64(new Uint8Array(raw)) })
  );
};

export const restoreSession = async (): Promise<Unlocked | null> => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; key?: string };
    if (!parsed?.id || !parsed?.key) return null;

    const account = listAccounts().find((entry) => entry.id === parsed.id);
    if (!account) {
      clearSession();
      return null;
    }

    const key = await crypto.subtle.importKey(
      'raw',
      base64ToBytes(parsed.key),
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    return { account, key };
  } catch {
    clearSession();
    return null;
  }
};

export const clearSession = (): void => {
  sessionStorage.removeItem(SESSION_KEY);
};

/** Rename the account shown on this phone (the data itself is untouched). */
export const renameAccount = (id: string, name: string): LocalAccount | null => {
  const cleanName = name.trim();
  if (!cleanName) return null;
  let updated: LocalAccount | null = null;
  const accounts = listAccounts().map((account) => {
    if (account.id !== id) return account;
    updated = { ...account, name: cleanName };
    return updated;
  });
  writeAccounts(accounts);
  return updated;
};

/** Forget an account and delete its encrypted vault from this phone. */
export const deleteAccount = (id: string): void => {
  writeAccounts(listAccounts().filter((account) => account.id !== id));
  const prefix = `serene.vault.v1.${id}.`;
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) doomed.push(key);
  }
  doomed.forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem(`serene.onboarded.${id}`);
  clearSession();
};
