import { Link } from 'react-router-dom';
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Lock, Mail, User, CheckCircle2, ArrowRight, Shield, RefreshCw, Smartphone, ShieldCheck } from './icons';
import { useAuth } from './AuthProvider';
import { ServerAuthError, serverForgotPassword, serverResendVerification } from '../lib/serverAuth';
import { cn } from '../lib/utils';

interface OnboardingProps {
  onComplete: () => void;
}

type Step = 'intro' | 'auth' | 'verify' | 'forgot' | 'vault' | 'success';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const {
    signUp,
    signIn,
    user,
    hasAccounts,
    provider,
    pendingVault,
    unlockPendingVault,
    cancelPendingVault,
  } = useAuth();
  // A phone that already holds an account goes straight to the lock screen.
  const [step, setStep] = useState<Step>(hasAccounts ? 'auth' : 'intro');
  const [isSignUp, setIsSignUp] = useState(!hasAccounts);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [notice, setNotice] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('serene.pending.email') || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [vaultPassword, setVaultPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const openAuth = (createNew: boolean) => {
    setIsSignUp(createNew);
    setErrorText('');
    setNotice('');
    setForgotSent(false);
    setStep('auth');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorText('');

    if (step === 'vault') {
      if (!vaultPassword) {
        setErrorText('Enter the password that unlocks this device’s journal.');
        return;
      }
      setLoading(true);
      try {
        await unlockPendingVault(vaultPassword);
        setStep('success');
      } catch (error: any) {
        setErrorText(error?.message || 'That password does not unlock this journal.');
      } finally {
        setLoading(false);
        setVaultPassword('');
      }
      return;
    }

    if (step === 'forgot') {
      if (!EMAIL_PATTERN.test(email.trim())) {
        setErrorText('Please enter a valid email address.');
        return;
      }
      setLoading(true);
      try {
        const message = await serverForgotPassword(email);
        setNotice(message);
        setForgotSent(true);
      } catch (error: any) {
        setErrorText(error?.message || 'The reset email could not be sent. Try again shortly.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (isSignUp && !name.trim()) {
      setErrorText('Please enter your name.');
      return;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setErrorText('Please enter a valid email address.');
      return;
    }
    if (isSignUp && password.length < 8) {
      setErrorText('Use a password of at least 8 characters.');
      return;
    }
    if (isSignUp && password !== confirm) {
      setErrorText('Those two passwords do not match.');
      return;
    }
    if (isSignUp && provider === 'supabase' && !acceptedTerms) {
      setErrorText('Accept the terms and privacy policy to create an account.');
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        const result = await signUp(name, email, password, acceptedTerms);
        if (result.verificationRequired) {
          setEmail(result.email || email);
          setNotice(
            `We sent a verification link to ${result.email || email}. Open it, then come back here to sign in.`,
          );
          setStep('verify');
          return;
        }
      } else {
        await signIn(email, password);
      }
      setStep('success');
    } catch (error: any) {
      const code = error instanceof ServerAuthError ? error.code : error?.code;
      if (code === 'email_verification_required') {
        setNotice(
          'Your account exists but your email is not verified yet. Check your inbox, then sign in.',
        );
        setStep('verify');
      } else if (code === 'vault_unlock_required') {
        setStep('vault');
        setErrorText(error?.message || '');
      } else {
        setErrorText(error?.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
      setPassword('');
      setConfirm('');
    }
  };

  const resendVerification = async () => {
    setErrorText('');
    setNotice('');
    setLoading(true);
    try {
      const message = await serverResendVerification(email);
      setNotice(message);
    } catch (error: any) {
      setErrorText(error?.message || 'The verification email could not be sent.');
    } finally {
      setLoading(false);
    }
  };

  const backToSignIn = () => {
    setIsSignUp(false);
    setErrorText('');
    setNotice('');
    setForgotSent(false);
    setStep('auth');
  };

  return (
    <div className="fixed inset-0 z-[999] bg-background  flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-sm min-h-[560px] max-h-[92vh] md:max-h-none flex flex-col justify-between bg-card  border border-amber-950/10  rounded-sm p-6 md:p-8 relative overflow-hidden">

        <div className="flex-1 flex flex-col justify-center">
          <div>

            {step === 'intro' && (
              <motion.div
                key="intro"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="text-center space-y-6 my-auto"
              >
                <div className="inline-flex p-4 rounded-sm bg-primary/5  border border-amber-950/10  mx-auto text-primary">
                  <Lock className="w-8 h-8 text-primary animate-pulse" />
                </div>

                <div className="space-y-2">
                  <h1 className="text-2xl font-black tracking-tight text-amber-950  uppercase">
                    Serene Structure
                  </h1>
                  <p className="text-xs font-bold uppercase tracking-widest text-[#8A7355]">
                    Your life, kept on your phone.
                  </p>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed px-2 font-serif">
                  A peaceful space to plan routines, track your health, write reflections and keep
                  what matters. Your journal is locked with your own password and never leaves this
                  device.
                </p>

                <div className="p-3 rounded-2xl bg-card/70  border border-amber-950/10  flex items-start gap-3 text-left">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Your journal never leaves this device. A verified account protects your AI
                    credits and limits abuse; your journal stays encrypted here. If you forget your
                    journal password, the entries cannot be recovered.
                  </p>
                </div>

                <div className="pt-4 space-y-3">
                  <button
                    onClick={() => openAuth(true)}
                    className="w-full py-4 bg-primary  text-primary-foreground rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    Create my space <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openAuth(false)}
                    className="w-full py-3 bg-transparent text-muted-foreground hover:text-foreground text-xs font-bold uppercase tracking-widest transition-all cursor-pointer"
                  >
                    I already have an account
                  </button>
                </div>
              </motion.div>
            )}

            {step === 'auth' && (
              <motion.div
                key="auth"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="space-y-5 my-auto"
              >
                <div className="text-center space-y-1">
                  {isSignUp ? (
                    <User className="w-8 h-8 text-amber-800  mx-auto" />
                  ) : (
                    <Lock className="w-8 h-8 text-amber-800  mx-auto" />
                  )}
                  <h3 className="text-sm font-black uppercase tracking-widest text-[#8A7355]">
                    {isSignUp ? 'New account' : 'Welcome back'}
                  </h3>
                  <h4 className="text-base font-bold text-amber-950 ">
                    {isSignUp ? 'Create your account' : 'Unlock your space'}
                  </h4>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                  {isSignUp && (
                    <div className="space-y-1">
                      <label htmlFor="signup-name" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Your name</label>
                      <div className="relative">
                        <User className="absolute left-3.5 top-3 w-4 h-4 text-muted-foreground/50" />
                        <input
                          id="signup-name"
                          type="text"
                          required
                          autoComplete="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Elizabeth Bennett"
                          className="w-full pl-10 pr-4 py-3 bg-card  text-xs rounded-xl border border-amber-950/10  focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label htmlFor="login-email" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-3 w-4 h-4 text-muted-foreground/50" />
                      <input
                        id="login-email"
                        type="email"
                        required
                        autoComplete="username"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="elizabeth@example.com"
                        className="w-full pl-10 pr-4 py-3 bg-card  text-xs rounded-xl border border-amber-950/10  focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="login-password" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                      {isSignUp ? 'Account password' : 'Password'}
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-3 w-4 h-4 text-muted-foreground/50" />
                      <input
                        id="login-password"
                        type="password"
                        required
                        autoComplete={isSignUp ? 'new-password' : 'current-password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={isSignUp ? 'At least 8 characters' : 'Your password'}
                        className="w-full pl-10 pr-4 py-3 bg-card  text-xs rounded-xl border border-amber-950/10  focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>

                  {isSignUp && (
                    <div className="space-y-1">
                      <label htmlFor="signup-confirm" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Repeat password</label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-3 w-4 h-4 text-muted-foreground/50" />
                        <input
                          id="signup-confirm"
                          type="password"
                          required
                          autoComplete="new-password"
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          placeholder="Type it once more"
                          className="w-full pl-10 pr-4 py-3 bg-card  text-xs rounded-xl border border-amber-950/10  focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>
                  )}

                  {isSignUp && (
                    <label className="flex items-start gap-2 text-[9px] leading-relaxed text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(event) => setAcceptedTerms(event.target.checked)}
                        className="mt-0.5 w-3.5 h-3.5 accent-primary"
                      />
                      <span>
                        I agree to the{' '}
                        <Link to="/terms" className="text-primary underline underline-offset-2">terms</Link>{' '}
                        and{' '}
                        <Link to="/privacy" className="text-primary underline underline-offset-2">privacy policy</Link>.
                      </span>
                    </label>
                  )}

                  {errorText && (
                    <p className="text-[10px] text-rose-500 font-bold leading-relaxed">{errorText}</p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className={cn(
                      'w-full py-3.5 bg-primary   text-primary-foreground rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 cursor-pointer mt-2',
                      loading && 'opacity-60'
                    )}
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Working…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" /> {isSignUp ? 'Create account' : 'Sign in'}
                      </>
                    )}
                  </button>
                </form>

                <div className="text-center pt-1 space-y-2">
                  {!isSignUp && provider === 'supabase' && (
                    <button
                      type="button"
                      onClick={() => {
                        setErrorText('');
                        setNotice('');
                        setForgotSent(false);
                        setStep('forgot');
                      }}
                      className="block w-full text-[10px] text-muted-foreground font-bold underline underline-offset-4 cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setIsSignUp(!isSignUp);
                      setErrorText('');
                      setNotice('');
                    }}
                    className="text-xs text-primary font-bold tracking-tight hover:underline cursor-pointer"
                  >
                    {isSignUp ? 'Already have an account? Sign in' : "New here? Create an account"}
                  </button>
                  <p className="text-[9px] text-muted-foreground/70 leading-relaxed px-2">
                    Your account verifies AI access. Your journal stays encrypted in this browser
                    with its own password.
                  </p>
                </div>
              </motion.div>
            )}

            {step === 'verify' && (
              <motion.div
                key="verify"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="space-y-5 my-auto text-center"
              >
                <div className="inline-flex p-4 rounded-full bg-primary/10 text-primary mx-auto">
                  <Mail className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-black uppercase tracking-widest text-[#8A7355]">Check your inbox</h3>
                  <h4 className="text-base font-bold text-amber-950">Verify {email}</h4>
                  <p className="text-[11px] text-muted-foreground font-serif leading-relaxed px-2">
                    Open the verification link in the email. If you opened it on another device,
                    come back here and sign in after it confirms.
                  </p>
                </div>

                {notice && (
                  <p className="text-[10px] text-emerald-700 font-bold leading-relaxed px-2">{notice}</p>
                )}
                {errorText && (
                  <p className="text-[10px] text-rose-500 font-bold leading-relaxed px-2">{errorText}</p>
                )}

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => void resendVerification()}
                    disabled={loading}
                    className="w-full py-3 bg-secondary text-foreground rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                  >
                    {loading ? 'Sending…' : 'Resend verification email'}
                  </button>
                  <button
                    type="button"
                    onClick={backToSignIn}
                    className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-[10px] font-black uppercase tracking-widest"
                  >
                    I’ve verified — sign in
                  </button>
                </div>
              </motion.div>
            )}

            {step === 'forgot' && (
              <motion.div
                key="forgot"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="space-y-5 my-auto"
              >
                <div className="text-center space-y-1">
                  <Mail className="w-8 h-8 text-amber-800 mx-auto" />
                  <h3 className="text-sm font-black uppercase tracking-widest text-[#8A7355]">Password reset</h3>
                  <h4 className="text-base font-bold text-amber-950">
                    {forgotSent ? 'Check your inbox' : 'Find your account'}
                  </h4>
                </div>

                {forgotSent ? (
                  <>
                    <p className="text-[11px] leading-relaxed text-muted-foreground text-center">
                      {notice}
                    </p>
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-left">
                      <p className="text-[10px] leading-relaxed text-amber-900">
                        Resetting this account password does not change the password that encrypts
                        the journal already stored on this device. If you reset it, you may still
                        need your old journal password to unlock those entries.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={backToSignIn}
                      className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-[10px] font-black uppercase tracking-widest"
                    >
                      Back to sign in
                    </button>
                  </>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <div className="space-y-1">
                      <label htmlFor="forgot-email" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Email</label>
                      <input
                        id="forgot-email"
                        type="email"
                        required
                        autoComplete="username"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="you@example.com"
                        className="w-full px-4 py-3 bg-card text-xs rounded-xl border border-amber-950/10 focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    {errorText && (
                      <p className="text-[10px] text-rose-500 font-bold leading-relaxed">{errorText}</p>
                    )}
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-60"
                    >
                      {loading ? 'Sending…' : 'Send reset link'}
                    </button>
                    <button
                      type="button"
                      onClick={backToSignIn}
                      className="w-full text-[10px] text-muted-foreground font-bold underline underline-offset-4"
                    >
                      Back to sign in
                    </button>
                  </form>
                )}
              </motion.div>
            )}

            {step === 'vault' && (
              <motion.div
                key="vault"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="space-y-5 my-auto text-center"
              >
                <div className="inline-flex p-4 rounded-full bg-amber-500/10 text-amber-700 mx-auto">
                  <Lock className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-black uppercase tracking-widest text-[#8A7355]">One more unlock</h3>
                  <h4 className="text-base font-bold text-amber-950">Unlock this device’s journal</h4>
                  <p className="text-[11px] text-muted-foreground font-serif leading-relaxed px-2">
                    Your account password is correct. This browser’s encrypted journal still uses
                    the password it had before. Enter that journal password to open it. We never
                    replace or delete the encrypted entries.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3 text-left">
                  <div className="space-y-1">
                    <label htmlFor="vault-password" className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                      Previous journal password
                    </label>
                    <input
                      id="vault-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={vaultPassword}
                      onChange={(event) => setVaultPassword(event.target.value)}
                      placeholder="The password used before the reset"
                      className="w-full px-4 py-3 bg-card text-xs rounded-xl border border-amber-950/10 focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  {errorText && (
                    <p className="text-[10px] text-rose-500 font-bold leading-relaxed">{errorText}</p>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-60"
                  >
                    {loading ? 'Unlocking…' : 'Unlock journal'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      cancelPendingVault();
                      backToSignIn();
                    }}
                    className="w-full text-[10px] text-muted-foreground font-bold underline underline-offset-4"
                  >
                    Use a different account
                  </button>
                </form>

                {pendingVault && (
                  <p className="text-[9px] text-muted-foreground/70">
                    Signed in as {pendingVault.email}
                  </p>
                )}
              </motion.div>
            )}

            {step === 'success' && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-6 my-auto text-center"
              >
                <div className="inline-flex p-4 rounded-full bg-emerald-500/10 text-emerald-600 mx-auto">
                  <Shield className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-black uppercase tracking-widest text-[#8A7355]">Account verified</h3>
                  <h4 className="text-lg font-bold text-amber-950 ">
                    {user?.displayName || 'Your space'} is ready
                  </h4>
                  <p className="text-[11px] text-muted-foreground font-serif leading-relaxed px-3">
                    Your account is verified for AI access. Everything you write is still encrypted
                    with your journal password and stays on this phone. When you close the app it
                    locks itself again.
                  </p>
                </div>
                <div className="flex items-center gap-2 justify-center text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                  <Smartphone className="w-3.5 h-3.5" /> {user?.email}
                </div>
                <button
                  onClick={onComplete}
                  className="w-full py-4 bg-primary  text-primary-foreground rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  Enter my space <ArrowRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

          </div>
        </div>

        <p className="text-center text-[9px] text-muted-foreground/50 pt-4">
          Serene Structure · your journal is stored on this device
        </p>
        <nav aria-label="Policies" className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-1">
          <Link to="/privacy" className="text-[10px] font-bold uppercase tracking-widest text-primary underline underline-offset-4">Privacy</Link>
          <Link to="/terms" className="text-[10px] font-bold uppercase tracking-widest text-primary underline underline-offset-4">Terms</Link>
          <Link to="/cookies" className="text-[10px] font-bold uppercase tracking-widest text-primary underline underline-offset-4">Cookies</Link>
        </nav>
      </div>
    </div>
  );
};
