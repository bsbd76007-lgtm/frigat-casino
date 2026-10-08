'use client';

import type { CSSProperties, ReactNode } from 'react';

import { useLanguage } from '@/components/providers/LanguageProvider';
import {
  CrownIcon,
  FlameIcon,
  SparklesIcon,
  TrendingDownIcon,
} from '@/components/icons/ui';
import { formatDecimalString, isDecimalString } from '@/lib/decimal';
import { useInjectedStyles } from '@/lib/useInjectedStyles';

export interface RoundResultProps {
  win: boolean;
  payout?: string | null;
  currency?: string;
  multiplier?: number | null;
  detail?: ReactNode;
  badge?: ReactNode;
  title?: string;
  bust?: boolean;
}

const BIG_WIN = 10;

const SPARKS: Array<[number, number]> = [
  [-34, -26], [-14, -38], [12, -40], [34, -24],
  [40, 2], [30, 26], [-30, 28], [-42, 4],
];

const STYLE_ID = 'fg-round-result-styles';
const CSS = `
.rres { position: relative; display: flex; align-items: center; gap: 12px; width: 100%;
  max-width: 400px; margin: 12px auto 0; padding: 12px 16px; box-sizing: border-box;
  text-align: left; border: 1px solid; border-radius: var(--fg-r-lg);
  animation: rres-pop .42s var(--fg-ease) both; }
.rres--win { background: color-mix(in srgb, var(--fg-gold) 14%, var(--fg-panel));
  border-color: var(--fg-gold);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--fg-gold) 16%, transparent),
    0 14px 30px -14px color-mix(in srgb, var(--fg-gold) 70%, transparent); }
.rres--lose { background: color-mix(in srgb, var(--fg-red) 12%, var(--fg-panel));
  border-color: color-mix(in srgb, var(--fg-red) 55%, transparent);
  animation: rres-pop .42s var(--fg-ease) both, rres-shake .42s .12s ease-in-out both; }

.rres__icon { position: relative; flex: none; display: grid; place-items: center;
  width: 48px; height: 48px; border-radius: var(--fg-r-pill); }
.rres--win .rres__icon { color: #2a1a03; background: var(--fg-gold);
  animation: rres-glow 1.6s .4s ease-in-out 2; }
.rres--lose .rres__icon { color: #fff; background: var(--fg-red); }

.rres__ball { display: grid; place-items: center; width: 48px; height: 48px;
  font-family: var(--fg-num); font-size: 18px; font-weight: 800; color: #fff;
  font-variant-numeric: tabular-nums; border-radius: var(--fg-r-pill);
  border: 3px solid rgba(255,255,255,.85); box-sizing: border-box; }
.rres__ball--RED { background: #c8384a; }
.rres__ball--BLACK { background: #1c1f26; }
.rres__ball--GREEN { background: var(--fg-pos); }
.rres__icon:has(.rres__ball) { background: transparent; }

.rres__spark { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px;
  margin: -3px 0 0 -3px; border-radius: var(--fg-r-pill); background: var(--fg-gold);
  opacity: 0; pointer-events: none;
  animation: rres-spark .8s calc(.18s + var(--i) * .03s) cubic-bezier(.2,.7,.3,1) both; }
.rres__spark:nth-child(even) { background: var(--fg-accent); width: 4px; height: 4px;
  margin: -2px 0 0 -2px; }

.rres__body { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
.rres__title { font-family: var(--fg-display); font-size: 17px; font-weight: 700;
  line-height: 1.2; letter-spacing: -.01em; }
.rres--win .rres__title { color: var(--fg-gold); }
.rres--lose .rres__title { color: var(--fg-red); }
.rres__amount { font-family: var(--fg-num); font-size: 24px; font-weight: 800; line-height: 1.15;
  font-variant-numeric: tabular-nums; color: var(--fg-text); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.rres__amount small { margin-left: 4px; font-size: 12px; font-weight: 700; color: var(--fg-muted); }
.rres__detail { font-size: 12.5px; line-height: 1.4; color: var(--fg-muted); }

.rres__mult { flex: none; padding: 4px 10px; font-family: var(--fg-num); font-size: 15px;
  font-weight: 800; font-variant-numeric: tabular-nums; border-radius: var(--fg-r-pill); }
.rres--win .rres__mult { color: #2a1a03; background: var(--fg-gold); }
.rres--lose .rres__mult { color: var(--fg-red);
  background: color-mix(in srgb, var(--fg-red) 16%, transparent); }

.rres--big .rres__title { font-size: 20px; }
.rres--big .rres__amount { font-size: 28px; }

@keyframes rres-pop {
  0% { opacity: 0; transform: translateY(8px) scale(.92); }
  60% { opacity: 1; transform: translateY(0) scale(1.03); }
  100% { opacity: 1; transform: none; }
}
@keyframes rres-shake {
  0%, 100% { translate: 0; }
  20% { translate: -6px 0; }
  40% { translate: 5px 0; }
  60% { translate: -3px 0; }
  80% { translate: 2px 0; }
}
@keyframes rres-spark {
  0% { opacity: 0; transform: translate(0, 0) scale(.4); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1); }
}
@keyframes rres-glow {
  50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--fg-gold) 22%, transparent); }
}
@media (max-width: 480px) {
  .rres { gap: 10px; padding: 10px 12px; }
  .rres__amount { font-size: 20px; }
  .rres--big .rres__amount { font-size: 24px; }
}
@media (prefers-reduced-motion: reduce) {
  .rres, .rres--lose, .rres__icon, .rres--win .rres__icon { animation: none; }
  .rres__spark { display: none; }
}
`;

function formatMultiplier(value: number): string {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return value.toFixed(2);
}

export function RouletteBall({ pocket, color }: { pocket: number; color: string }) {
  return <span className={`rres__ball rres__ball--${color}`}>{pocket}</span>;
}

export function RoundResult({
  win,
  payout = null,
  currency,
  multiplier = null,
  detail,
  badge,
  title,
  bust = false,
}: RoundResultProps) {
  const { t } = useLanguage();
  useInjectedStyles(STYLE_ID, CSS);

  const big = win && multiplier !== null && multiplier >= BIG_WIN;
  const heading =
    title ??
    (win ? (big ? t('result.bigWin') : t('result.win')) : bust ? t('result.bust') : t('result.lose'));
  const amount = win && payout && isDecimalString(payout) ? formatDecimalString(payout, 2) : null;

  const Icon = win ? (big ? CrownIcon : SparklesIcon) : bust ? FlameIcon : TrendingDownIcon;

  const classes = ['rres', win ? 'rres--win' : 'rres--lose', big ? 'rres--big' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role="status">
      <span className="rres__icon" aria-hidden="true">
        {badge ?? <Icon size={24} />}
        {win &&
          SPARKS.map(([dx, dy], i) => (
            <span
              key={i}
              className="rres__spark"
              style={{ '--dx': `${dx}px`, '--dy': `${dy}px`, '--i': i } as CSSProperties}
            />
          ))}
      </span>

      <span className="rres__body">
        <span className="rres__title">{heading}</span>
        {amount && (
          <span className="rres__amount">
            +{amount}
            {currency && <small>{currency}</small>}
          </span>
        )}
        {detail && <span className="rres__detail">{detail}</span>}
      </span>

      {multiplier !== null && (
        <span className="rres__mult">{formatMultiplier(multiplier)}×</span>
      )}
    </div>
  );
}

export default RoundResult;
