import { storage } from './storage';
import type { AiCreditHistoryEntry, AiCreditSummary } from '../types';

/**
 * Browser side of the AI credit wallet.
 *
 * The server now owns the identity. This file never sends a user id or a
 * credit token: the HttpOnly account session does that. The only legacy value
 * kept in the vault is the old wallet token, used once to move an existing
 * balance onto the verified account.
 */

interface CreditTokenRecord {
  id: string;
  token: string;
  createdAt: string;
}

const TOKEN_RECORD_ID = 'vault-credit-token';
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** The old browser-hash id, retained only for the one-time claim. */
export const creditUserId = async (user?: string): Promise<string | undefined> => {
  if (!user) return undefined;
  try {
    const bytes = new TextEncoder().encode(`serene-ai-quota:${user}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 40);
  } catch {
    return undefined;
  }
};

const storedLegacyToken = async (): Promise<string | undefined> => {
  if (!storage.isUnlocked) return undefined;
  const records = await storage.getAll<CreditTokenRecord>(storage.key.AI_CREDITS);
  const record = records.find((entry) => entry.id === TOKEN_RECORD_ID);
  return record && TOKEN_PATTERN.test(record.token) ? record.token : undefined;
};

export const legacyCreditIdentity = async (
  localAccountId: string,
): Promise<{ userId: string; token: string } | undefined> => {
  const userId = await creditUserId(localAccountId);
  const token = await storedLegacyToken();
  return userId && token ? { userId, token } : undefined;
};

const hasCreditAccount = async (): Promise<boolean> => {
  try {
    const response = await fetch('/api/ai/credits', { credentials: 'same-origin' });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Ensure the signed-in server account has exactly one wallet. Existing users
 * present their old wallet token once; the server moves the balance, history
 * and subscription to the verified account and invalidates the old token.
 */
export const ensureCreditAccount = async (localAccountId?: string): Promise<boolean> => {
  if (!localAccountId) return false;
  if (await hasCreditAccount()) return true;

  const legacy = await legacyCreditIdentity(localAccountId);
  if (legacy) {
    try {
      const claim = await fetch('/api/ai/wallet/claim', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legacyUserId: legacy.userId,
          legacyToken: legacy.token,
        }),
      });
      if (claim.ok || claim.status === 409) return true;
      // A rejected claim means the legacy token is wrong or the store is
      // unavailable. Creating a second wallet here would strand the old
      // balance, so stop and let the user retry.
      if (claim.status !== 404) return false;
    } catch {
      return false;
    }
  }

  try {
    const created = await fetch('/api/ai/wallet', {
      method: 'POST',
      credentials: 'same-origin',
    });
    return created.ok;
  } catch {
    return false;
  }
};

/** Kept as a compatibility shim: identity now comes from the session cookie. */
export const creditHeaders = async (_user?: string): Promise<Record<string, string>> => ({});

export const notifyCreditChange = (): void => {
  try {
    window.dispatchEvent(new CustomEvent('ai-credits-update'));
  } catch {
    // A non-browser test environment has no window, and no UI to refresh.
  }
};

const parseCreditResponse = async (response: Response): Promise<Response> => {
  if (response.ok) return response;
  let message = 'Your AI credits could not be loaded.';
  try {
    const body = await response.json();
    if (typeof body?.error === 'string') message = body.error;
  } catch {
    // Keep the generic message.
  }
  throw new Error(message);
};

const loadSummary = async (): Promise<Response> =>
  fetch('/api/ai/credits', { credentials: 'same-origin' });

export const fetchCreditSummary = async (user?: string): Promise<AiCreditSummary | null> => {
  try {
    let response = await loadSummary();
    if (response.status === 404 && user) {
      const ready = await ensureCreditAccount(user);
      if (ready) response = await loadSummary();
    }
    await parseCreditResponse(response);
    const body = await response.json();
    return (body?.credits || null) as AiCreditSummary | null;
  } catch {
    return null;
  }
};

export const fetchCreditHistory = async (
  user?: string,
): Promise<AiCreditHistoryEntry[]> => {
  try {
    let response = await fetch('/api/ai/credits/history', {
      credentials: 'same-origin',
    });
    if (response.status === 404 && user) {
      const ready = await ensureCreditAccount(user);
      if (ready) {
        response = await fetch('/api/ai/credits/history', {
          credentials: 'same-origin',
        });
      }
    }
    await parseCreditResponse(response);
    const body = await response.json();
    return Array.isArray(body?.history) ? (body.history as AiCreditHistoryEntry[]) : [];
  } catch {
    return [];
  }
};
