'use client';

import Link from 'next/link';

import { useStoredToken } from '@/hooks/useStoredToken';
import { useLanguage } from '@/components/providers/LanguageProvider';

interface Promo {
  id: string;
  name: string;
  tag: string;
  blurb: string;
  detail: string;
  action: { label: string; href?: string; onClick?: () => void };
}

export default function PromotionsPage() {
  const { t } = useLanguage();
  const token = useStoredToken();

  const promos: Promo[] = [
    {
      id: 'rakeback',
      name: t('promos.rakebackName'),
      tag: t('promos.rakebackTag'),
      blurb: t('promos.rakebackBlurb'),
      detail: t('promos.rakebackDetail'),
      action: { label: t('promos.rakebackAction'), href: '/vip' },
    },
    {
      id: 'partner',
      name: t('promos.partnerName'),
      tag: t('promos.partnerTag'),
      blurb: t('promos.partnerBlurb'),
      detail: t('promos.partnerDetail'),
      action: { label: t('promos.partnerAction'), href: '/partner-program' },
    },
  ];

  return (
    <>
      <h1 className="info__title">{t('promos.title')}</h1>
      <p className="info__lede">
        {t('promos.lede')}
      </p>

      {!token && (
        <p className="info__note">
          <b>{t('promos.signedOut')}</b>
          <span>
            {t('promos.signedOutBody')}{' '}
            <Link href="/login">{t('promos.signIn')}</Link> {t('promos.or')}{' '}
            <Link href="/register">{t('promos.createAccount')}</Link> {t('promos.toClaim')}
          </span>
        </p>
      )}

      <div className="info__grid">
        {promos.map((promo) => (
          <article className="info__card" key={promo.id}>
            <span className="info__tag">{promo.tag}</span>
            <h3>{promo.name}</h3>
            <p>{promo.blurb}</p>
            <p style={{ fontSize: 12.5, opacity: 0.85 }}>{promo.detail}</p>
            <div className="info__card-foot">
              {promo.action.href ? (
                <Link className="info__cta" href={promo.action.href}>
                  {promo.action.label}
                </Link>
              ) : (
                <button
                  type="button"
                  className="info__cta"
                  onClick={promo.action.onClick}
                  disabled={!token}
                >
                  {promo.action.label}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      <section className="info__section" style={{ marginTop: 22 }}>
        <h2>{t('promos.howTitle')}</h2>
        <ul className="info__list">
          <li>
            <b>{t('promos.howServerLead')}</b> {t('promos.howServerBody')}
          </li>
          <li>
            <b>{t('promos.howOnceLead')}</b> {t('promos.howOnceBody')}
          </li>
          <li>
            <b>{t('promos.howCreditLead')}</b> {t('promos.howCreditBody')}
          </li>
          <li>
            <b>{t('promos.howAbuseLead')}</b> {t('promos.howAbuseBody')}{' '}
            <Link href="/rules#aml">{t('promos.amlLink')}</Link>.
          </li>
        </ul>
      </section>

      <p className="info__lede" style={{ marginTop: 22 }}>
        {t('promos.toppingUp')}{' '}
        <Link className="info__cta info__cta--ghost" href="/">
          {t('promos.goToCasino')}
        </Link>
      </p>
    </>
  );
}
