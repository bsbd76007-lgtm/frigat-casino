'use client';

/**
 * /bonuses — the deposit-bonus ladder.
 *
 * Everything here is read from GET /api/bonuses/me. The bonus is credited by
 * the server when a deposit confirms (payment.service); this page only shows
 * which steps are used, what the next deposit earns, and how much is left to
 * wager before a withdrawal unlocks.
 */

import { useCallback, useEffect, useState } from 'react';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { apiJson } from '@/lib/api';
import { openPanel } from '@/lib/appPanels';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import { consumedAsSessionExpiry } from '@/lib/sessionExpiry';

interface BonusStatus {
  ladder: Array<{ deposit: number; rate: number; claimed: boolean; amount: string | null }>;
  cap: string;
  wagerMultiplier: number;
  nextRate: number | null;
  wageringRemaining: string;
  minWithdrawal: string;
}

const STYLE_ID = 'fg-bonuses-styles';

const CSS = `
.bon { display: flex; flex-direction: column; gap: 20px; max-width: 980px; margin: 0 auto; }
.bon__head h1 { margin: 0 0 6px; }
.bon__head p { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--fg-muted); }
.bon__ladder { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 760px) { .bon__ladder { grid-template-columns: 1fr; } }
.bon__card { display: flex; flex-direction: column; gap: 8px; padding: 20px; border-radius: 20px;
  background: var(--neu-surface); box-shadow: var(--neu-raised); }
.bon__card--next { outline: 2px solid var(--fg-accent); outline-offset: -2px; }
.bon__card--done { box-shadow: var(--neu-pressed); }
.bon__step { font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
  color: var(--fg-dim); }
.bon__rate { font-family: var(--fg-display); font-size: 34px; font-weight: 800; line-height: 1.1;
  color: var(--fg-gold); }
.bon__what { font-size: 13px; color: var(--fg-muted); }
.bon__state { align-self: flex-start; padding: 2px 10px; font-size: 11px; font-weight: 800;
  border-radius: var(--fg-r-pill); color: var(--fg-muted); box-shadow: var(--neu-pressed); }
.bon__state--next { color: var(--fg-on-accent); background: var(--fg-accent-deep); box-shadow: none; }
.bon__state--done { color: var(--fg-pos-soft); }
.bon__panel { display: flex; flex-direction: column; gap: 12px; padding: 20px; border-radius: 20px;
  background: var(--neu-surface); box-shadow: var(--neu-raised); }
.bon__panel h2 { margin: 0; font-size: 16px; }
.bon__rules { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px;
  font-size: 13px; line-height: 1.55; color: var(--fg-muted); }
.bon__wager { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px; border-radius: 12px; box-shadow: var(--neu-pressed); font-size: 13px; }
.bon__wager b { font-family: var(--fg-num); color: var(--fg-gold); }
.bon__cta { align-self: flex-start; height: 48px; padding: 0 24px; font: inherit; font-size: 15px;
  font-weight: 800; color: var(--fg-on-accent); background: var(--fg-accent-deep); border: 0;
  border-radius: 12px; cursor: pointer; box-shadow: var(--neu-raised-sm); }
.bon__cta:hover { background: var(--fg-accent-mid); }
.bon__cta:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.bon__err { color: var(--fg-red); font-size: 13px; }
`;

const ORDINAL_KEYS = ['bonuses.first', 'bonuses.second', 'bonuses.third'] as const;

export default function BonusesPage() {
  useInjectedStyles(STYLE_ID, CSS);
  const { t } = useLanguage();
  const [status, setStatus] = useState<BonusStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await apiJson<BonusStatus>('api/bonuses/me'));
      setFailed(false);
    } catch (err) {
      if (consumedAsSessionExpiry(err)) return;
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nextIndex = status ? status.ladder.findIndex((s) => !s.claimed) : -1;
  const wagerLeft = status ? Number(status.wageringRemaining) : 0;

  return (
    <div className="bon">
      <header className="bon__head">
        <h1>{t('bonuses.title')}</h1>
        <p>{t('bonuses.subtitle')}</p>
      </header>

      {failed && <p className="bon__err">{t('bonuses.loadError')}</p>}

      {status && (
        <>
          <div className="bon__ladder">
            {status.ladder.map((step, i) => {
              const state = step.claimed ? 'done' : i === nextIndex ? 'next' : 'locked';
              return (
                <div key={step.deposit} className={`bon__card bon__card--${state}`}>
                  <span className="bon__step">{t(ORDINAL_KEYS[i] ?? 'bonuses.first')}</span>
                  <span className="bon__rate">+{Math.round(step.rate * 100)}%</span>
                  <span className="bon__what">
                    {t('bonuses.ofDeposit', { cap: `$${status.cap}` })}
                  </span>
                  <span className={`bon__state bon__state--${state}`}>
                    {state === 'done'
                      ? step.amount
                        ? t('bonuses.received', { amount: `$${step.amount}` })
                        : t('bonuses.used')
                      : state === 'next'
                        ? t('bonuses.next')
                        : t('bonuses.locked')}
                  </span>
                </div>
              );
            })}
          </div>

          <section className="bon__panel">
            {wagerLeft > 0 && (
              <div className="bon__wager" role="status">
                <span>{t('bonuses.wagerLeft')}</span>
                <b>${status.wageringRemaining}</b>
              </div>
            )}
            <h2>{t('bonuses.rulesTitle')}</h2>
            <ul className="bon__rules">
              <li>{t('bonuses.ruleCredit')}</li>
              <li>{t('bonuses.ruleCap', { cap: `$${status.cap}` })}</li>
              <li>{t('bonuses.ruleWager', { times: status.wagerMultiplier })}</li>
              <li>{t('bonuses.ruleMin', { amount: `$${status.minWithdrawal}` })}</li>
              <li>{t('bonuses.ruleAbuse')}</li>
            </ul>
            {status.nextRate !== null && (
              <button type="button" className="bon__cta" onClick={() => openPanel('deposit')}>
                {t('bonuses.depositCta', { percent: `${Math.round(status.nextRate * 100)}%` })}
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
