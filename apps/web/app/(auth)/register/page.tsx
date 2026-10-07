'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { PASSWORD_POLICY, passwordProblems } from '@frigat/shared';

import {
  AuthError,
  confirmRegistration,
  DEFAULT_DESTINATION,
  requestRegistrationCode,
  signInWithGoogle,
  TotpRequiredError,
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
import { evaluatePassword } from '@/app/(auth)/passwordRules';
import { PasswordChecklist } from '@/app/(auth)/PasswordChecklist';

const MIN_PASSWORD = PASSWORD_POLICY.minLength;

import { useLanguage } from '@/components/providers/LanguageProvider';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { showToast } from '@/lib/toast';

function RegisterForm() {
  const { t } = useLanguage();
  const router = useRouter();
  const ref = useSearchParams().get('ref');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [cooldown, setCooldown] = useState(0);

  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<TurnstileHandle>(null);

  const { failing, ready: passwordReady } = evaluatePassword(password);

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

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const weaknesses = passwordProblems(password);
    if (weaknesses.length > 0) {
      setError(
        `Password needs: ${weaknesses.map((w) => w.message.toLowerCase()).join(', ')}.`
      );
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await requestRegistrationCode(
        { email: email.trim(), password, turnstileToken },
        ref
      );
      setTurnstileToken('');
      setChallenge(result);
      setDigits(emptyDigits());
      setCooldown(result.resendAfterSeconds);
      focusFirstOtpBox();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
    } finally {
      turnstileRef.current?.reset();
      setBusy(false);
    }
  };

  const submitCode = useCallback(
    async (code: string) => {
      if (busy || !challenge || code.length !== OTP_DIGITS) return;

      setBusy(true);
      setError(null);
      try {
        await confirmRegistration(challenge.email, code, ref);
        router.replace(DEFAULT_DESTINATION);
        router.refresh();
      } catch (err) {
        setError(err instanceof AuthError ? err.message : 'Could not verify that code.');
        setDigits(emptyDigits());
        focusFirstOtpBox();
        setBusy(false);
      } finally {
        turnstileRef.current?.reset();
      }
    },
    [busy, challenge, ref, router]
  );

  const resendCode = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestRegistrationCode(
        { email: email.trim(), password, turnstileToken },
        ref
      );
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

  const reportGoogleError = (message: string) => {
    setError(message);
    showToast(message, 'error', 8000);
  };

  const submitGoogle = async (code: string, redirectUri: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(code, redirectUri, ref);
      router.replace(DEFAULT_DESTINATION);
      router.refresh();
    } catch (err) {
      if (err instanceof TotpRequiredError) reportGoogleError(t('auth.googleUseSignIn'));
      else reportGoogleError(err instanceof AuthError ? err.message : t('auth.googleFailed'));
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <div className="auth__card">
        <span className="auth__brand">FRIGAT</span>
        <h1 className="auth__title">{t('auth.verifyEmailTitle')}</h1>
        <p className="auth__sub">
          {t('auth.verifyEmailSub', { digits: OTP_DIGITS })}{' '}
          <strong>{challenge.email}</strong>. {t('auth.verifyEmailSubTail')}
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
          idPrefix="register"
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
          {busy ? t('auth.creatingAccount') : t('auth.verifyAndCreate')}
        </button>

        <Turnstile
          ref={turnstileRef}
          onToken={setTurnstileToken}
          action="register-resend"
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
              setError(null);
              setCooldown(0);
            }}
          >
            {t('auth.changeDetails')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth__card">
      <span className="auth__brand">FRIGAT</span>
      <h1 className="auth__title">{t('auth.createAccountTitle')}</h1>
      <p className="auth__sub">
        {t('auth.createAccountSub')}
      </p>

      {ref && (
        <p className="auth__sub" style={{ color: 'var(--fg-accent)' }}>
          {t('auth.invited')}
        </p>
      )}

      {error && (
        <p className="auth__error" role="alert">
          {error}
        </p>
      )}


      <form onSubmit={requestCode} noValidate>
        <div className="auth__field">
          <label className="auth__label" htmlFor="register-email">
            {t('auth.email')}
          </label>
          <input
            id="register-email"
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
          <span className="auth__hint">
            {t('auth.emailCodeHint', { digits: OTP_DIGITS })}
          </span>
        </div>

        <div className="auth__field">
          <label className="auth__label" htmlFor="register-password">
            {t('auth.password')}
          </label>
          <PasswordInput
            id="register-password"
            className="auth__input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
            disabled={busy}
            aria-describedby="register-password-hint"
            aria-invalid={password.length > 0 && !passwordReady ? true : undefined}
          />
          <PasswordChecklist
            password={password}
            failing={failing}
            id="register-password-hint"
          />
        </div>

        <div className="auth__field">
          <label className="auth__label" htmlFor="register-confirm">
            {t('auth.confirmPassword')}
          </label>
          <PasswordInput
            id="register-confirm"
            className="auth__input"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            disabled={busy}
          />
        </div>

        <Turnstile ref={turnstileRef} onToken={setTurnstileToken} action="register" />

        <button
          type="submit"
          className="auth__submit"
          disabled={busy || (isTurnstileConfigured() && !turnstileToken)}
        >
          {busy ? t('auth.sendingCode') : t('auth.verifyEmailAction')}
        </button>
      </form>

      <GoogleSignInButton
        text="signup_with"
        disabled={busy}
        onCode={(code, redirectUri) => void submitGoogle(code, redirectUri)}
        onError={(message) => reportGoogleError(message ?? t('auth.googleFailed'))}
      />

      <p className="auth__alt">
        {t('auth.haveAccount')} <Link href="/login">{t('auth.signInLink')}</Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="auth__card" />}>
      <RegisterForm />
    </Suspense>
  );
}
