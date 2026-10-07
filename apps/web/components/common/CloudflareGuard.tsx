'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isTurnstileConfigured,
  Turnstile,
  type TurnstileHandle,
} from '@/components/auth/Turnstile';
import { RadarLoader } from '@/components/common/RadarLoader';
import { useInjectedStyles } from '@/lib/useInjectedStyles';

const SESSION_KEY = 'frigat.security.verified';

const DEV_PASS_MS = 2000;

const STYLE_ID = 'fg-security-guard-styles';

const CSS = `
.sec { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center;
  justify-content: center; width: 100%; min-height: 100vh; min-height: 100dvh;
  padding: 16px; box-sizing: border-box;
  background: var(--fg-bg, var(--fg-bg)); }
.sec__box { width: 100%; max-width: 460px; text-align: center;
  color: var(--fg-text, #fff);
  font-family: var(--fg-font, ui-sans-serif, system-ui, sans-serif); }

.sec__brand { font-size: 24px; font-weight: 900; letter-spacing: .18em;
  color: var(--fg-accent, #3b7cff); }
.sec__title { margin: 14px 0 6px; font-size: 17px; font-weight: 700; }
.sec__sub { margin: 0; font-size: 13px; line-height: 1.6;
  color: var(--fg-muted, var(--fg-muted)); }

.sec__radar { display: flex; justify-content: center; margin: 24px 0 8px; }

.sec__status { margin: 10px 0 0; font-size: 13px; font-weight: 700;
  color: var(--fg-text, #fff); }
.sec__widget { display: flex; justify-content: center; margin-top: 16px; min-height: 68px; }

.sec__foot { margin-top: 24px; padding-top: 16px;
  border-top: 1px solid var(--fg-line, #2a3547); }
.sec__meta { margin: 0; font-size: 11px; line-height: 1.7;
  color: var(--fg-dim, var(--fg-dim)); }
.sec__meta b { font-family: var(--fg-mono, ui-monospace, monospace); font-weight: 600;
  color: var(--fg-muted, var(--fg-muted)); }

`;

function makeReference(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface CloudflareGuardProps {
  children: React.ReactNode;
}

import { useLanguage } from '@/components/providers/LanguageProvider';

export function CloudflareGuard({ children }: CloudflareGuardProps) {
  const { t } = useLanguage();
  useInjectedStyles(STYLE_ID, CSS);

  const [checked, setChecked] = useState<boolean | null>(null);
  const [reference] = useState(makeReference);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    try {
      window.sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
    }
    setChecked(true);
  }, []);

  useEffect(() => {
    let cleared = false;
    try {
      cleared = window.sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
    }
    if (cleared) {
      setChecked(true);
      return;
    }
    setChecked(false);

    if (!isTurnstileConfigured()) {
      timer.current = setTimeout(() => clear(), DEV_PASS_MS);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [clear]);

  if (checked === null || checked) return <>{children}</>;

  const live = isTurnstileConfigured();

  return (
    <>
      <div className="sec" role="status" aria-live="polite">
        <div className="sec__box">
          <div className="sec__brand">FRIGAT</div>
          <h1 className="sec__title">{t('common.securityTitle')}</h1>
          <p className="sec__sub">
            Checking your browser before you continue. This takes a few seconds
            and happens once per session.
          </p>

          <div className="sec__radar">
            <RadarLoader size={110} label="Performing security verification" />
          </div>
          <p className="sec__status">{t('common.securityVerifying')}</p>

          <div className="sec__widget">
            {live ? (
              <Turnstile
                ref={turnstileRef}
                onToken={(token) => {
                  if (token) clear();
                }}
                action="security-gate"
              />
            ) : null}
          </div>

          <div className="sec__foot">
            <p className="sec__meta">
              {live ? (
                <>{t('common.securityFooter')}</>
              ) : (
                <>
                  Verification is not configured on this deployment — continuing
                  without a challenge.
                </>
              )}
              <br />
              FRIGAT reference: <b>{reference}</b>
            </p>
          </div>
        </div>
      </div>

      <div aria-hidden="true" style={{ display: 'none' }}>
        {children}
      </div>
    </>
  );
}

export default CloudflareGuard;
