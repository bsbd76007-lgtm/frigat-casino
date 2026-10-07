'use client';

import { useEffect, useRef, useState } from 'react';

import { GoogleMark } from '@/components/auth/GoogleMark';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { startGoogleSignIn, takeGoogleRedirectResult } from '@/lib/googleOAuth';

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

const LABELS: Record<'signin_with' | 'signup_with', string> = {
  signin_with: 'Sign in with Google',
  signup_with: 'Sign up with Google',
};

interface Props {
  text: 'signin_with' | 'signup_with';
  disabled?: boolean;
  onCode: (code: string, redirectUri: string) => void;
  onError: (message?: string) => void;
}

export function GoogleSignInButton({ text, disabled = false, onCode, onError }: Props) {
  const { t } = useLanguage();
  const [leaving, setLeaving] = useState(false);
  const onCodeRef = useRef(onCode);
  const onErrorRef = useRef(onError);
  onCodeRef.current = onCode;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const result = takeGoogleRedirectResult();
    if (result?.code && result.redirectUri) {
      console.log('[google] returned from Google with an authorization code', {
        codeLength: result.code.length,
        redirectUri: result.redirectUri,
      });
      onCodeRef.current(result.code, result.redirectUri);
      return;
    }
    if (result?.error) {
      console.error('[google] returned from Google with an error', result.error);
      onErrorRef.current(result.error);
      return;
    }

    const url = new URL(window.location.href);
    if (url.searchParams.get('google_error')) {
      console.error('[google] sign-in could not start', url.searchParams.get('google_error'));
      url.searchParams.delete('google_error');
      window.history.replaceState(null, '', url.toString());
      onErrorRef.current('Google sign-in is not available right now.');
    }
  }, []);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div className="auth__google">
      <div className="auth__divider" role="separator">
        <span>{t('auth.or')}</span>
      </div>
      <button
        type="button"
        className="auth__gbtn"
        disabled={disabled || leaving}
        aria-busy={disabled || leaving || undefined}
        onClick={() => {
          console.log('[google] redirecting to Google', { from: window.location.pathname });
          setLeaving(true);
          startGoogleSignIn();
        }}
      >
        <span className="auth__gbtn-mark" aria-hidden="true">
          <GoogleMark size={16} />
        </span>
        <span>{LABELS[text]}</span>
      </button>
    </div>
  );
}
