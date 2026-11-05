import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Lock, Mail, RefreshCw, ShieldCheck } from '../components/icons';
import { serverResendVerification, serverResetPassword } from '../lib/serverAuth';

const cardClass =
  'w-full max-w-sm bg-card border border-amber-950/10 rounded-sm p-6 md:p-8 space-y-5';

const emailFromStorage = (): string => {
  try {
    return localStorage.getItem('serene.pending.email') || '';
  } catch {
    return '';
  }
};

export const EmailVerified: React.FC = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const status = params.get('status');
  const reason = params.get('reason');
  const [email, setEmail] = useState(emailFromStorage);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const resend = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      setNotice(await serverResendVerification(email));
    } catch (caught: any) {
      setError(caught?.message || 'The verification email could not be sent.');
    } finally {
      setLoading(false);
    }
  };

  const successful = status === 'success';
  const already = status === 'error' && reason === 'already_verified';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className={cardClass}>
        <div className="text-center space-y-3">
          <div className={`inline-flex p-4 rounded-full mx-auto ${successful ? 'bg-emerald-500/10 text-emerald-600' : 'bg-primary/10 text-primary'}`}>
            {successful ? <ShieldCheck className="w-8 h-8" /> : <Mail className="w-8 h-8" />}
          </div>
          <h1 className="text-lg font-black tracking-tight text-amber-950">
            {successful ? 'Email verified' : already ? 'Already verified' : 'Verification link'}
          </h1>
          <p className="text-[11px] leading-relaxed text-muted-foreground font-serif">
            {successful
              ? 'Your email is confirmed. Sign in to unlock your journal on this device.'
              : already
                ? 'This email is already confirmed. Sign in with your account password.'
                : 'That link is invalid or has expired. Enter your email below to request a new one.'}
          </p>
        </div>

        {!successful && (
          <form onSubmit={resend} className="space-y-2">
            <label htmlFor="verify-email" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              Email
            </label>
            <input
              id="verify-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-3 bg-card text-xs rounded-xl border border-amber-950/10 focus:ring-1 focus:ring-primary"
            />
            {notice && <p className="text-[10px] text-emerald-700 font-bold leading-relaxed">{notice}</p>}
            {error && <p className="text-[10px] text-rose-500 font-bold leading-relaxed">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-secondary text-foreground rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Resend verification email'}
            </button>
          </form>
        )}

        <Link
          to="/"
          className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2"
        >
          Continue to sign in <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
};

export const ResetPassword: React.FC = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const status = params.get('status');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const ready = status === 'ready';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Use a password of at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Those two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      setNotice(await serverResetPassword(password, confirm));
      setDone(true);
      setPassword('');
      setConfirm('');
    } catch (caught: any) {
      setError(caught?.message || 'That reset link is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className={cardClass}>
        <div className="text-center space-y-3">
          <div className={`inline-flex p-4 rounded-full mx-auto ${done ? 'bg-emerald-500/10 text-emerald-600' : 'bg-primary/10 text-primary'}`}>
            {done ? <CheckCircle2 className="w-8 h-8" /> : <Lock className="w-8 h-8" />}
          </div>
          <h1 className="text-lg font-black tracking-tight text-amber-950">
            {done ? 'Password updated' : ready ? 'Choose a new password' : 'Reset link'}
          </h1>
          <p className="text-[11px] leading-relaxed text-muted-foreground font-serif">
            {done
              ? notice
              : ready
                ? 'This changes your account password only. Your encrypted journal is a separate lock.'
                : 'That reset link is invalid or has expired. Request a new one from the sign-in screen.'}
          </p>
        </div>

        {done ? (
          <>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-[10px] leading-relaxed text-amber-900">
                If this device already has an encrypted journal, unlock it with the password it used
                before this reset. The new account password does not re-encrypt existing entries.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                window.location.hash = '#/';
                window.location.reload();
              }}
              className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2"
            >
              Return to sign in <ArrowRight className="w-4 h-4" />
            </button>
          </>
        ) : ready ? (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="new-password" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                New account password
              </label>
              <input
                id="new-password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                className="w-full px-4 py-3 bg-card text-xs rounded-xl border border-amber-950/10 focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="confirm-password" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                Repeat new password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Type it once more"
                className="w-full px-4 py-3 bg-card text-xs rounded-xl border border-amber-950/10 focus:ring-1 focus:ring-primary"
              />
            </div>
            {error && <p className="text-[10px] text-rose-500 font-bold leading-relaxed">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</> : 'Save new password'}
            </button>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-[10px] leading-relaxed text-amber-900">
                Your journal password is separate. If you previously used a different password to
                encrypt entries on this device, you will need it again to unlock them.
              </p>
            </div>
          </form>
        ) : (
          <Link
            to="/"
            className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2"
          >
            Back to sign in <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>
    </div>
  );
};
