'use client';

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  AuthError,
  requestPasswordReset,
  resetPassword,
  type CodeChallenge,
} from '@/app/(auth)/authClient';
import {
  emptyDigits,
  focusFirstOtpBox,
  OtpDigits,
  OTP_DIGITS,
} from '@/app/(auth)/OtpDigits';
import { evaluatePassword } from '@/app/(auth)/passwordRules';
import { PasswordChecklist } from '@/app/(auth)/PasswordChecklist';
import {

  isTurnstileConfigured,
  Turnstile,
  type TurnstileHandle,
} from '@/components/auth/Turnstile';

const REDIRECT_DELAY_MS = 2200;

import { useLanguage } from '@/components/providers/LanguageProvider';
import { PasswordInput } from '@/components/auth/PasswordInput';

function ForgotPasswordForm() {
  const { t } = useLanguage();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<TurnstileHandle>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { failing, ready: passwordReady } = evaluatePassword(password);
  const code = digits.join('');
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

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

  useEffect(
    () => () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    },
    []
  );

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !emailValid) return;

    setBusy(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email.trim().toLowerCase(), turnstileToken);
      setTurnstileToken('');
      setChallenge(result);
      setDigits(emptyDigits());
      setCooldown(result.resendAfterSeconds);
      focusFirstOtpBox();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not send a reset code.');
    } finally {
      turnstileRef.current?.reset();
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email.trim().toLowerCase(), turnstileToken);
      setChallenge(result);
      setDigits(emptyDigits());
      setCooldown(result.resendAfterSeconds);
      focusFirstOtpBox();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not send another code.');
    } finally {
      turnstileRef.current?.reset();
      setBusy(false);
    }
  };

  const submitReset = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy || !challenge) return;

      if (code.length !== OTP_DIGITS) {
        setError(`Enter the ${OTP_DIGITS}-digit code from your email.`);
        return;
      }
      if (!passwordReady) {
        setError('Choose a password that meets every rule below.');
        return;
      }
      if (password !== confirm) {
        setError('Those passwords do not match.');
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const message = await resetPassword({
          email: challenge.email,
          code,
          newPassword: password,
        });
        setDone(message);
        redirectTimer.current = setTimeout(() => router.replace('/login'), REDIRECT_DELAY_MS);
      } catch (err) {
        setError(err instanceof AuthError ? err.message : 'Could not reset your password.');
        setDigits(emptyDigits());
        focusFirstOtpBox();
        setBusy(false);
      }
    },
    [busy, challenge, code, password, confirm, passwordReady, router]
  );

  if (done) {
    return (
      <div className="auth__card">
        <span className="auth__brand">FRIGAT</span>
        <h1 className="auth__title">{t('auth.pwUpdatedTitle')}</h1>
        <p className="auth__notice" role="status">
          {done}
        </p>
        <p className="auth__alt">
          {t('auth.takingYouTo')} <Link href="/login">{t('auth.signInWord')}</Link>…
        </p>
      </div>
    );
  }

  if (challenge) {
    return (
      <div className="auth__card">
        <span className="auth__brand">FRIGAT</span>
        <h1 className="auth__title">{t('auth.choosePwTitle')}</h1>
        <p className="auth__sub">
          {t('auth.choosePwSubHead')} <strong>{challenge.email}</strong>{' '}
          {t('auth.choosePwSubTail', { digits: OTP_DIGITS })}
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

        <form onSubmit={submitReset} noValidate>
          <OtpDigits
            idPrefix="reset"
            digits={digits}
            onDigitsChange={setDigits}
            onComplete={() => document.getElementById('reset-password')?.focus()}
            disabled={busy}
            label={t('auth.resetCodeLabel')}
          />

          <div className="auth__field">
            <label className="auth__label" htmlFor="reset-password">
              {t('auth.newPassword')}
            </label>
            <PasswordInput
              id="reset-password"
              className="auth__input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
              disabled={busy}
              aria-describedby="reset-password-hint"
              aria-invalid={password.length > 0 && !passwordReady ? true : undefined}
            />
            <PasswordChecklist
              password={password}
              failing={failing}
              id="reset-password-hint"
            />
          </div>

          <div className="auth__field">
            <label className="auth__label" htmlFor="reset-confirm">
              {t('auth.confirmNewPassword')}
            </label>
            <PasswordInput
              id="reset-confirm"
              className="auth__input"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
              disabled={busy}
            />
          </div>

          <button
            type="submit"
            className="auth__submit"
            disabled={busy || code.length !== OTP_DIGITS || !passwordReady}
          >
            {busy ? t('auth.resetting') : t('auth.resetPasswordAction')}
          </button>
        </form>

        <Turnstile
          ref={turnstileRef}
          onToken={setTurnstileToken}
          action="password-reset-resend"
        />

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
            onClick={() => {
              setChallenge(null);
              setDigits(emptyDigits());
              setPassword('');
              setConfirm('');
              setError(null);
              setCooldown(0);
            }}
          >
            {t('auth.useDifferentEmail')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth__card">
      <span className="auth__brand">FRIGAT</span>
      <h1 className="auth__title">{t('auth.resetPasswordTitle')}</h1>
      <p className="auth__sub">
        {t('auth.resetPasswordSub', { digits: OTP_DIGITS })}
      </p>

      {error && (
        <p className="auth__error" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={requestCode} noValidate>
        <div className="auth__field">
          <label className="auth__label" htmlFor="reset-email">
            {t('auth.email')}
          </label>
          <input
            id="reset-email"
            className="auth__input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            disabled={busy}
          />
        </div>

        <Turnstile
          ref={turnstileRef}
          onToken={setTurnstileToken}
          action="password-reset"
        />

        <button
          type="submit"
          className="auth__submit"
          disabled={
            busy || !emailValid || cooldown > 0 || (isTurnstileConfigured() && !turnstileToken)
          }
        >
          {busy
            ? t('auth.sending')
            : cooldown > 0
              ? t('auth.resendIn', { seconds: cooldown })
              : t('auth.sendResetCode')}
        </button>
      </form>

      <p className="auth__alt">
        {t('auth.rememberedIt')} <Link href="/login">{t('auth.backToSignIn')}</Link>
      </p>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="auth__card" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
