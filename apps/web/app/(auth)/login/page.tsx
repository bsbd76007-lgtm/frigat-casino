'use client';

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import {
  ADMIN_DESTINATION,
  AuthError,
  safeDestination,
  signInWithGoogle,
  submitPassword,
  TotpRequiredError,
  verifyLoginCode,
  verifyTotp,
  type AuthedUser,
  type CodeChallenge,
} from '@/app/(auth)/authClient';
import {
  emptyDigits,
  focusFirstOtpBox,
  OtpDigits,
  OTP_DIGITS,
} from '@/app/(auth)/OtpDigits';
import {

  isTurnstileConfigured,
  Turnstile,
  type TurnstileHandle,
} from '@/components/auth/Turnstile';

const REDIRECT_COPY: Record<string, string> = {
  required: 'Sign in to continue.',
  invalid: 'That session has expired. Sign in again.',
  forbidden: 'That account is not an administrator.',
  misconfigured:
    'The server is missing JWT_SECRET, so sessions cannot be verified. Admin access is disabled until it is set.',
};

import { useLanguage } from '@/components/providers/LanguageProvider';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { showToast } from '@/lib/toast';

function LoginForm() {
  const { t } = useLanguage();
  const params = useSearchParams();
  const redirectReason = params.get('error');
  const next = params.get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [cooldown, setCooldown] = useState(0);

  const [totpChallenge, setTotpChallenge] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<TurnstileHandle>(null);
  const resetTurnstile = () => turnstileRef.current?.reset();

  const destinationFor = (user: AuthedUser): string => {
    const wantsAdmin = next?.startsWith('/admin') ?? false;
    const useNext = next !== null && (!wantsAdmin || user.role === 'ADMIN');
    return useNext
      ? safeDestination(next)
      : user.role === 'ADMIN'
        ? ADMIN_DESTINATION
        : safeDestination(null);
  };

  useEffect(() => {
    if (cooldown <= 0) return;
    const deadline = Date.now() + cooldown * 1000;
    const timer = setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      setCooldown(left > 0 ? left : 0);
      if (left <= 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooldown === 0]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const result = await submitPassword({
        email: email.trim(),
        password,
        turnstileToken,
      });

      if (!result.requiresOtp) {
        window.location.replace(destinationFor(result.user));
        return;
      }

      setTurnstileToken('');
      setChallenge(result.challenge);
      setDigits(emptyDigits());
      setCooldown(result.challenge.resendAfterSeconds);
      focusFirstOtpBox();
    } catch (err) {
      if (err instanceof TotpRequiredError) setTotpChallenge(err.challenge);
      else setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
    } finally {
      resetTurnstile();
      setBusy(false);
    }
  };

  const submitCode = useCallback(
    async (code: string) => {
      if (busy || !challenge || code.length !== OTP_DIGITS) return;

      setBusy(true);
      setError(null);
      try {
        const user = await verifyLoginCode(challenge.email, code);
        window.location.replace(destinationFor(user));
      } catch (err) {
        if (err instanceof TotpRequiredError) {
          setChallenge(null);
          setTotpChallenge(err.challenge);
          setBusy(false);
          return;
        }
        setError(err instanceof AuthError ? err.message : 'Could not verify that code.');
        setDigits(emptyDigits());
        focusFirstOtpBox();
        setBusy(false);
      } finally {
        resetTurnstile();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, challenge]
  );

  const resendCode = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitPassword({
        email: email.trim(),
        password,
        turnstileToken,
      });

      if (!result.requiresOtp) {
        window.location.replace(destinationFor(result.user));
        return;
      }

      setChallenge(result.challenge);
      setDigits(emptyDigits());
      setCooldown(result.challenge.resendAfterSeconds);
      focusFirstOtpBox();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not send another code.');
    } finally {
      resetTurnstile();
      setBusy(false);
    }
  };

  const reportGoogleError = (message: string) => {
    setError(message);
    showToast(message, 'error', 8000);
  };

  const submitGoogle = async (code: string, redirectUri: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = await signInWithGoogle(code, redirectUri);
      window.location.replace(destinationFor(user));
    } catch (err) {
      if (err instanceof TotpRequiredError) setTotpChallenge(err.challenge);
      else reportGoogleError(err instanceof AuthError ? err.message : t('auth.googleFailed'));
      setBusy(false);
    }
  };

  const submitTotp = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !totpChallenge || !totpCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const user = await verifyTotp(totpChallenge, totpCode.trim());
      window.location.replace(destinationFor(user));
    } catch (err) {
      setError(err instanceof AuthError ? err.message : t('security.totpInvalid'));
      setTotpCode('');
      setBusy(false);
    }
  };

  const restart = () => {
    setTotpChallenge(null);
    setTotpCode('');
    setChallenge(null);
    setDigits(emptyDigits());
    setPassword('');
    setError(null);
    setCooldown(0);
  };

  const banner = error ?? (redirectReason ? REDIRECT_COPY[redirectReason] : null);

  if (totpChallenge) {
    return (
      <div className="auth__card">
        <span className="auth__brand">FRIGAT</span>
        <h1 className="auth__title">{t('security.signInTitle')}</h1>
        <p className="auth__sub">{t('security.signInSub')}</p>

        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={submitTotp} noValidate>
          <div className="auth__field">
            <label className="auth__label" htmlFor="login-totp">
              {t('security.codeLabel')}
            </label>
            <input
              id="login-totp"
              className="auth__input"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              maxLength={12}
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value)}
              placeholder="123456"
              disabled={busy}
            />
          </div>
          <button type="submit" className="auth__submit" disabled={busy || !totpCode.trim()}>
            {busy ? t('security.verifying') : t('security.verifySignIn')}
          </button>
          <p className="auth__hint">{t('security.backupHint')}</p>
        </form>

        <div className="auth__otp-foot">
          <button type="button" className="auth__link-btn" disabled={busy} onClick={restart}>
            {t('auth.backToSignIn')}
          </button>
        </div>
      </div>
    );
  }

  if (challenge) {
    return (
      <div className="auth__card">
        <span className="auth__brand">FRIGAT</span>
        <h1 className="auth__title">{t('auth.checkEmailTitle')}</h1>
        <p className="auth__sub">
          {t('auth.checkEmailSub', { digits: OTP_DIGITS })}{' '}
          <strong>{challenge.email}</strong> {t('auth.checkEmailSubTail')}
        </p>

        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}
        {!error && challenge.devCode && (
          <p className="auth__notice" role="status">
            {t('auth.devMode', { code: challenge.devCode })}
          </p>
        )}

        <OtpDigits
          idPrefix="login-2fa"
          digits={digits}
          onDigitsChange={setDigits}
          onComplete={(code) => void submitCode(code)}
          disabled={busy}
        />

        <button
          type="button"
          className="auth__submit"
          disabled={busy || digits.join('').length !== OTP_DIGITS}
          onClick={() => void submitCode(digits.join(''))}
        >
          {busy ? t('auth.verifying') : t('auth.verifyAndSignIn')}
        </button>

        <Turnstile ref={turnstileRef} onToken={setTurnstileToken} action="login-resend" />

        <div className="auth__otp-foot">
          <button
            type="button"
            className="auth__link-btn"
            disabled={
              busy || cooldown > 0 || (isTurnstileConfigured() && !turnstileToken)
            }
            onClick={() => void resendCode()}
          >
            {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resendCode')}
          </button>
          <button
            type="button"
            className="auth__link-btn"
            disabled={busy}
            onClick={restart}
          >
            {t('auth.backToSignIn')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth__card">
      <span className="auth__brand">FRIGAT</span>
      <h1 className="auth__title">{t('auth.signInTitle')}</h1>
      <p className="auth__sub">{t('auth.signInSub')}</p>

      {banner && (
        <p className="auth__error" role="alert">
          {banner}
        </p>
      )}


      <form onSubmit={submit} noValidate>
        <div className="auth__field">
          <label className="auth__label" htmlFor="login-email">
            {t('auth.email')}
          </label>
          <input
            id="login-email"
            className="auth__input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            disabled={busy}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <div className="auth__field">
          <div className="auth__label-row">
            <label className="auth__label" htmlFor="login-password">
              {t('auth.password')}
            </label>
            <Link className="auth__label-link" href="/forgot-password">
              {t('auth.forgotPassword')}
            </Link>
          </div>
          <PasswordInput
            id="login-password"
            className="auth__input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
            disabled={busy}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <Turnstile ref={turnstileRef} onToken={setTurnstileToken} action="login" />

        <button
          type="submit"
          className="auth__submit"
          disabled={busy || (isTurnstileConfigured() && !turnstileToken)}
        >
          {busy ? t('auth.checking') : t('auth.continue')}
        </button>
        <p className="auth__hint">
          {t('auth.codeHint', { digits: OTP_DIGITS })}
        </p>
      </form>

      <GoogleSignInButton
        text="signin_with"
        disabled={busy}
        onCode={(code, redirectUri) => void submitGoogle(code, redirectUri)}
        onError={(message) => reportGoogleError(message ?? t('auth.googleFailed'))}
      />

      <p className="auth__alt">
        {t('auth.newHere')} <Link href="/register">{t('auth.createAnAccount')}</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth__card" />}>
      <LoginForm />
    </Suspense>
  );
}
