/**
 * Browser side of the account API.
 *
 * Supabase is the identity provider when the server reports it configured, but
 * the browser never receives a Supabase token. The server sets only an
 * encrypted, HttpOnly session cookie. The legacy verifier path remains for the
 * pre-migration development fallback when Supabase is not configured.
 */

export interface ServerAccountSummary {
  profile: {
    id: string;
    displayName: string;
    createdAt: string;
    updatedAt: string;
  };
  subscription: {
    plan: string;
    status: string;
    environment: string;
    purchasedAt: string | null;
    expiresAt: string | null;
  } | null;
  wallet: {
    plan: string;
    balance: number;
    allocated: number;
    periodCreditsUsed: number;
    periodStart: string;
    periodEnd: string;
    subscriptionStatus: string;
  } | null;
}

export interface ServerUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified?: boolean;
  account?: ServerAccountSummary;
}

export interface AuthConfig {
  provider: 'supabase' | 'password';
  configured: boolean;
  emailVerification: boolean;
  sessionDays: number;
}

export type RegisterResult =
  | { verificationRequired: true; email: string; message?: string }
  | { verificationRequired: false; user: ServerUser };

export class ServerAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ServerAuthError';
  }
}

const parseError = async (response: Response): Promise<ServerAuthError> => {
  let message = 'The account service is not available right now.';
  let code = 'auth_error';
  try {
    const body = await response.json();
    if (typeof body?.error === 'string') message = body.error;
    if (typeof body?.code === 'string') code = body.code;
  } catch {
    // Keep the generic message for a non-JSON failure.
  }
  return new ServerAuthError(message, code, response.status);
};

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
};

export const serverAuthConfig = async (): Promise<AuthConfig> => {
  try {
    const body = await request<Partial<AuthConfig>>('/api/auth/config');
    return {
      provider: body.provider === 'supabase' ? 'supabase' : 'password',
      configured: body.configured !== false,
      emailVerification: body.emailVerification === true,
      sessionDays: Number(body.sessionDays) || 30,
    };
  } catch {
    // If the config route is unavailable, the sign-in request will fail too.
    return { provider: 'password', configured: false, emailVerification: false, sessionDays: 30 };
  }
};

export const deriveServerAuthSecret = async (
  email: string,
  password: string,
): Promise<string> => {
  const salt = new TextEncoder().encode(
    `serene-server-auth-v1:${email.trim().toLowerCase()}`,
  );
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    material,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const serverRegister = async (
  name: string,
  email: string,
  password: string,
  acceptedTerms: boolean,
): Promise<RegisterResult> => {
  const body = await request<{
    user?: ServerUser;
    verificationRequired?: boolean;
    email?: string;
    message?: string;
  }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, acceptedTerms }),
  });
  if (body.verificationRequired) {
    return {
      verificationRequired: true,
      email: body.email || email,
      message: body.message,
    };
  }
  if (!body.user) throw new ServerAuthError('The account was not created.', 'auth_bad_response', 502);
  return { verificationRequired: false, user: body.user };
};

export const serverRegisterLegacy = async (
  name: string,
  email: string,
  authSecret: string,
): Promise<ServerUser> => {
  const body = await request<{ user: ServerUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, authSecret }),
  });
  return body.user;
};

export const serverLogin = async (
  email: string,
  password: string,
): Promise<ServerUser> => {
  const body = await request<{ user: ServerUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return body.user;
};

export const serverLoginLegacy = async (
  email: string,
  authSecret: string,
): Promise<ServerUser> => {
  const body = await request<{ user: ServerUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, authSecret }),
  });
  return body.user;
};

export const serverMe = async (): Promise<ServerUser | null> => {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!response.ok) return null;
    const body = (await response.json()) as { user?: ServerUser };
    return body.user || null;
  } catch {
    return null;
  }
};

export const serverRename = async (name: string): Promise<ServerUser> => {
  const body = await request<{ user: ServerUser }>('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return body.user;
};

export const serverForgotPassword = async (email: string): Promise<string> => {
  const body = await request<{ message?: string }>('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return body.message || 'If that email has an account, a reset link is on its way.';
};

export const serverResendVerification = async (email: string): Promise<string> => {
  const body = await request<{ message?: string }>('/api/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return body.message || 'If that email needs verification, a new link is on its way.';
};

export const serverResetPassword = async (
  password: string,
  confirmPassword: string,
): Promise<string> => {
  const body = await request<{ message?: string }>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ password, confirmPassword }),
  });
  return body.message || 'Your account password was updated. Sign in with it now.';
};

export const serverLogout = async (): Promise<void> => {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // The local vault is locked regardless of whether the network call succeeds.
  }
};
