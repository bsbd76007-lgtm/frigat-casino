'use client';

import Link from 'next/link';

import { useLanguage } from '@/components/providers/LanguageProvider';

export default function NotFound() {
  const { t } = useLanguage();

  return (
    <main className="nf">
      <p className="nf__code" aria-hidden="true">
        {t('notFound.code')}
      </p>
      <h1 className="nf__title">{t('notFound.title')}</h1>
      <p className="nf__body">{t('notFound.body')}</p>

      <div className="nf__actions">
        <Link className="nf__cta" href="/">
          {t('notFound.home')}
        </Link>
        <Link className="nf__link" href="/rules">
          {t('notFound.rules')}
        </Link>
        <Link className="nf__link" href="/terms">
          {t('notFound.support')}
        </Link>
      </div>
    </main>
  );
}
