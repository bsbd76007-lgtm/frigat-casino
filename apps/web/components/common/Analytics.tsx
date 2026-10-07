'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';

import {
  ANALYTICS_DOMAIN,
  ANALYTICS_ENABLED,
  ANALYTICS_ID,
  ANALYTICS_SRC,
} from '@/lib/analytics';
import { CONSENT_EVENT, readConsent, type ConsentChoice } from '@/lib/consent';

export function Analytics() {
  const [choice, setChoice] = useState<ConsentChoice | null>(null);

  useEffect(() => {
    setChoice(readConsent());

    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<ConsentChoice>).detail;
      setChoice(detail ?? readConsent());
    };
    window.addEventListener(CONSENT_EVENT, onChange);

    const onStorage = () => setChoice(readConsent());
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener(CONSENT_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  if (!ANALYTICS_ENABLED || choice !== 'accepted') return null;

  return (
    <Script
      src={ANALYTICS_SRC}
      strategy="afterInteractive"
      data-domain={ANALYTICS_DOMAIN}
      data-website-id={ANALYTICS_ID}
    />
  );
}
