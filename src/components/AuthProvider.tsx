import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  LocalAccount,
  PublicUser,
  Unlocked,
  clearSession,
  createAccount,
  deleteAccount as deleteLocalAccount,
  listAccounts,
  renameAccount,
  restoreSession,
  signIn as localSignIn,
  toPublicUser,
} from '../lib/account';
import { storage } from '../lib/storage';
import { ensureCreditAccount } from '../lib/aiCredits';
import {
  AuthConfig,
  ServerAuthError,
  ServerUser,
  deriveServerAuthSecret,
  serverAuthConfig,
  serverLogin,
  serverLoginLegacy,
  serverLogout,
  serverMe,
  serverRegister,
  serverRegisterLegacy,
  serverRename,
} from '../lib/serverAuth';

interface PendingVault {
  email: string;
  server: ServerUser;
}

interface AuthContextType {
  user: PublicUser | null;
  loading: boolean;
  hasAccounts: boolean;
  provider: AuthConfig['provider'];
  pendingVault: PendingVault | null;
  signUp: (
    name: string,
    email: string,
    password: string,
    acceptedTerms: boolean,
  ) => Promise<{ verificationRequired: boolean; email?: string }>;
  signIn: (email: string, password: string) => Promise<void>;
  unlockPendingVault: (password: string) => Promise<void>;
  cancelPendingVault: () => void;
  signOut: () => Promise<void>;
  rename: (name: string) => void;
  removeAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const onboardedKey = (uid: string) => `serene.onboarded.${uid}`;
const normaliseEmail = (email: string) => email.trim().toLowerCase();

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasAccounts, setHasAccounts] = useState(false);
  const [provider, setProvider] = useState<AuthConfig['provider']>('password');
  const [pendingVault, setPendingVault] = useState<PendingVault | null>(null);

  const finish = useCallback(
    async (account: LocalAccount, key: CryptoKey, server: ServerUser) => {
      await storage.unlock(account.id, key);
      // The local account id was the old onboarding key. Carry the completed
      // welcome flow across the identity migration so existing users do not see
      // it again.
      try {
        const oldKey = onboardedKey(account.id);
        const newKey = onboardedKey(server.id);
        const oldValue = localStorage.getItem(oldKey);
        if (oldValue === 'true' && !localStorage.getItem(newKey)) {
          localStorage.setItem(newKey, 'true');
        }
      } catch {
        // A blocked localStorage only repeats the welcome flow.
      }
      setUser(toPublicUser(account, server));
      setHasAccounts(listAccounts().length > 0);
      setPendingVault(null);
      // The wallet is created on the server only after a verified session.
      // During the Supabase transition this helper may report that the AI
      // ledger is not ready yet; it deliberately does not create another wallet.
      void ensureCreditAccount(account.id);
    },
    [],
  );

  // A reload keeps the local vault key in sessionStorage. The server session
  // lives in an encrypted HttpOnly cookie. Both must be present for the app to
  // open; if the account is valid on another device, the journal still has to
  // be unlocked with its own password here.
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      setHasAccounts(listAccounts().length > 0);
      try {
        const config = await serverAuthConfig();
        if (!cancelled) setProvider(config.provider);
        const session = await restoreSession();
        if (!session) return;
        const server = await serverMe();
        if (!server) {
          // The server session expired or the account store is unavailable.
          // Keep the encrypted data, but require a fresh sign-in.
          clearSession();
          storage.lock();
          return;
        }
        if (!cancelled) await finish(session.account, session.key, server);
      } catch (error) {
        console.error('Could not reopen this account:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [finish]);

  const signUp = useCallback(
    async (name: string, email: string, password: string, acceptedTerms: boolean) => {
      if (provider === 'supabase') {
        const result = await serverRegister(name, email, password, acceptedTerms);
        if (!('user' in result)) {
          try {
            localStorage.setItem('serene.pending.email', normaliseEmail(email));
          } catch {
            // Prefill is optional.
          }
          return { verificationRequired: true, email: result.email };
        }

        const { account, key } = await createAccount(name, email, password);
        await finish(account, key, result.user);
        return { verificationRequired: false, email: normaliseEmail(email) };
      }

      const authSecret = await deriveServerAuthSecret(email, password);
      const server = await serverRegisterLegacy(name, email, authSecret);
      const { account, key } = await createAccount(name, email, password);
      await finish(account, key, server);
      return { verificationRequired: false, email: normaliseEmail(email) };
    },
    [finish, provider],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (provider === 'supabase') {
        const server = await serverLogin(email, password);
        const localAccount = listAccounts().find(
          (account) => account.email === normaliseEmail(email),
        );

        let local: Unlocked;
        if (localAccount) {
          try {
            local = await localSignIn(email, password);
          } catch {
            // The Supabase password was changed, but this device's journal is
            // still encrypted with the password it had before. Never replace or
            // delete that vault: ask for the old journal password explicitly.
            setPendingVault({ email: normaliseEmail(email), server });
            throw new ServerAuthError(
              'Your account password is correct, but this device’s journal is still locked with your previous journal password. Enter that password to unlock it.',
              'vault_unlock_required',
              401,
            );
          }
        } else {
          // A verified account on a new device has no local vault yet. Create an
          // empty encrypted vault with the account password; cloud data is not
          // silently imported or overwritten.
          local = await createAccount(server.name, email, password);
        }
        await finish(local.account, local.key, server);
        return;
      }

      let local: Unlocked | null = null;
      let localError: unknown;
      try {
        local = await localSignIn(email, password);
      } catch (error) {
        localError = error;
      }

      const authSecret = await deriveServerAuthSecret(email, password);
      let server: ServerUser;
      try {
        server = await serverLoginLegacy(email, authSecret);
      } catch (error) {
        const invalid =
          error instanceof ServerAuthError &&
          (error.status === 401 || error.code === 'invalid_credentials');
        if (!invalid) throw error;
        if (!local) throw localError;
        // Existing local accounts were created before server identity existed.
        // The first successful sign-in claims the same email on the server.
        try {
          server = await serverRegisterLegacy(local.account.name, email, authSecret);
        } catch (registerError) {
          if (
            registerError instanceof ServerAuthError &&
            registerError.code === 'email_in_use'
          ) {
            throw new Error(
              'This email already has a server account with a different password. Use that password, then unlock this local vault with its own password.',
            );
          }
          throw registerError;
        }
      }

      if (!local) {
        local = await createAccount(server.name, email, password);
      }
      await finish(local.account, local.key, server);
    },
    [finish, provider],
  );

  const unlockPendingVault = useCallback(
    async (password: string) => {
      if (!pendingVault) return;
      const local = await localSignIn(pendingVault.email, password);
      await finish(local.account, local.key, pendingVault.server);
    },
    [finish, pendingVault],
  );

  const cancelPendingVault = useCallback(() => setPendingVault(null), []);

  const signOut = useCallback(async () => {
    await serverLogout();
    storage.lock();
    clearSession();
    setUser(null);
    setPendingVault(null);
  }, []);

  const rename = useCallback(
    (name: string) => {
      if (!user) return;
      const updated = renameAccount(user.vaultId, name);
      const clean = name.trim();
      if (clean) {
        void serverRename(clean).catch(() => undefined);
      }
      if (updated) {
        setUser({
          ...user,
          displayName: clean || updated.name,
        });
      }
    },
    [user],
  );

  const removeAccount = useCallback(async () => {
    if (!user) return;
    // This removes the encrypted vault from this device. The server account is
    // kept so the same verified identity can sign in again on a new device.
    deleteLocalAccount(user.vaultId);
    await serverLogout();
    storage.lock();
    setUser(null);
    setHasAccounts(listAccounts().length > 0);
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        hasAccounts,
        provider,
        pendingVault,
        signUp,
        signIn,
        unlockPendingVault,
        cancelPendingVault,
        signOut,
        rename,
        removeAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
