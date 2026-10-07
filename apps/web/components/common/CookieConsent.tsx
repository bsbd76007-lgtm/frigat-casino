'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { readConsent, writeConsent } from '@/lib/consent';
import { ANALYTICS_ENABLED } from '@/lib/analytics';

export function CookieConsent() {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return;
    if (readConsent() === null) setVisible(true);
  }, []);

  if (!visible) return null;

  const choose = (choice: 'accepted' | 'rejected') => {
    writeConsent(choice);
    setVisible(false);
  };

  return (
    <section
      className="cc"
      role="dialog"
      aria-label={t('consent.aria')}
      aria-describedby="cc-body"
    >
      <div className="cc__inner">
        <div className="cc__text">
          <h2 className="cc__title">{t('consent.title')}</h2>
          <p className="cc__body" id="cc-body">
            {t('consent.body')}{' '}
            <Link className="cc__link" href="/privacy">
              {t('consent.learnMore')}
            </Link>
          </p>
        </div>

        <div className="cc__actions">
          <button type="button" className="cc__btn" onClick={() => choose('rejected')}>
            {t('consent.reject')}
          </button>
          <button
            type="button"
            className="cc__btn cc__btn--accept"
            onClick={() => choose('accepted')}
          >
            {t('consent.accept')}
          </button>
        </div>
      </div>
    </section>
  );
}
