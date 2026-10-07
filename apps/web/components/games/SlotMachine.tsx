'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import {
  BET_LIMITS,
  SLOTS_PAYLINES,
  SLOTS_PAYLINE_NAMES,
  SLOTS_PAYTABLE,
  SLOTS_REELS,
  SLOTS_ROWS,
  SLOTS_SYMBOLS,
} from '@frigat/shared';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { openPanel } from '@/lib/appPanels';
import { ApiError, apiJson } from '@/lib/api';
import { consumedAsSessionExpiry } from '@/lib/sessionExpiry';
import {
  clampDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimalString,
  isDecimalString,
  multiplyDecimal,
  safeDecimal,
  sanitizeDecimalInput,
  toFixedDecimal,
} from '@/lib/decimal';
import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import { useLanguage } from '@/components/providers/LanguageProvider';

import {
  SETTLE_TRAVEL,
  SILENT,
  STRIP_LENGTH,
  TIMING,
  useDefaultSounds,
  type Reel,
  type ReelPhase,
  type SlotSounds,
  type SlotSpinResponse,
} from './slotMachine/choreography';
import {
  NEON,
  SYMBOL_COLOURS,
  drawSymbol,
  easeOutBack,
  makeStrip,
  roundRect,
} from './slotMachine/symbols';
import { CSS, STYLE_ID } from './slotMachine/styles';

export type { SlotSounds, SlotSpinResponse } from './slotMachine/choreography';


type Phase = 'IDLE' | 'SPINNING' | 'RESULT';

const INSUFFICIENT = 'Not enough balance for this bet';

export interface SlotMachineProps {
  sounds?: Partial<SlotSounds>;
}

export default function SlotMachine({ sounds }: SlotMachineProps = {}) {
  const { t } = useLanguage();
  useInjectedStyles(STYLE_ID, CSS);

  const { balance: wallet } = useGameSocket();

  const [bet, setBet] = useState<string>('1.00');
  const [phase, setPhase] = useState<Phase>('IDLE');
  const [result, setResult] = useState<SlotSpinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [soundOn, setSoundOn] = useState(false);

  const defaults = useDefaultSounds(soundOn);
  const audio = useMemo<SlotSounds>(
    () => ({ ...SILENT, ...(soundOn ? defaults : SILENT), ...sounds }),
    [defaults, soundOn, sounds]
  );
  const audioRef = useRef(audio);
  audioRef.current = audio;

  const reelsRef = useRef<Reel[]>(
    Array.from({ length: SLOTS_REELS }, () => ({
      strip: makeStrip(),
      offset: 0,
      velocity: 0,
      phase: 'idle' as ReelPhase,
      settleAt: null,
      settleFrom: 0,
      settleTo: 0,
      settleStartedAt: 0,
    }))
  );
  const spinStartedAtRef = useRef(0);
  const winCellsRef = useRef<Array<{ cells: Array<[number, number]>; lineIndex: number }>>([]);
  const resolvedAtRef = useRef<number | null>(null);
  const settledRef = useRef(true);
  const pendingResultRef = useRef<SlotSpinResponse | null>(null);

  const balance = wallet.balance;
  const busy = phase === 'SPINNING';

  const safeBet = useMemo(() => safeDecimal(bet, BET_LIMITS.min), [bet]);

  const betError = useMemo(() => {
    if (!isDecimalString(bet.trim())) return null;
    if (compareDecimal(safeBet, BET_LIMITS.min) < 0) {
      return `Minimum bet is ${formatDecimalString(BET_LIMITS.min, 2)}`;
    }
    if (compareDecimal(safeBet, BET_LIMITS.max) > 0) {
      return `Maximum bet is ${formatDecimalString(BET_LIMITS.max, 2)}`;
    }
    if (balance !== null && compareDecimal(safeBet, balance) > 0) {
      return INSUFFICIENT;
    }
    return null;
  }, [bet, safeBet, balance]);

  const betReady = useMemo(
    () => isDecimalString(bet.trim()) && betError === null,
    [bet, betError]
  );

  const maxBet = useMemo(() => {
    if (balance === null) return BET_LIMITS.max;
    return compareDecimal(balance, BET_LIMITS.max) < 0 ? balance : BET_LIMITS.max;
  }, [balance]);

  const adjust = useCallback((next: string) => {
    const clamped = clampDecimal(next, BET_LIMITS.min, BET_LIMITS.max);
    setBet(toFixedDecimal(clamped, 2));
  }, []);

  const spin = useCallback(async () => {
    if (busy || !betReady) return;

    const now = performance.now();
    setError(null);
    setNeedsFunds(false);
    setResult(null);
    setPhase('SPINNING');
    winCellsRef.current = [];
    resolvedAtRef.current = null;
    settledRef.current = false;
    pendingResultRef.current = null;
    spinStartedAtRef.current = now;

    for (const reel of reelsRef.current) {
      reel.strip = makeStrip();
      reel.phase = 'accelerating';
      reel.settleAt = null;
      reel.velocity = 0;
    }
    audioRef.current.onSpinStart();

    try {
      const response = await apiJson<SlotSpinResponse>('api/games/slots/spin', {
        method: 'POST',
        body: JSON.stringify({ betAmount: toFixedDecimal(safeDecimal(bet, BET_LIMITS.min), 2) }),
      });

      const readyAt = Math.max(
        performance.now(),
        spinStartedAtRef.current + TIMING.minSpinMs
      );
      reelsRef.current.forEach((reel, index) => {
        const landing =
          (Math.floor(reel.offset) + SETTLE_TRAVEL + index * 2) % STRIP_LENGTH;
        const column = response.reelMatrix[index] ?? [];
        for (let row = 0; row < SLOTS_ROWS; row += 1) {
          reel.strip[(landing + row) % STRIP_LENGTH] = column[row];
        }
        reel.settleTo = landing;
        reel.settleAt = readyAt + index * TIMING.stagger;
      });

      pendingResultRef.current = response;
    } catch (err) {
      if (consumedAsSessionExpiry(err)) return;

      const message =
        err instanceof ApiError
          ? err.message
          : 'Could not reach the game server — no bet was placed';
      if (err instanceof ApiError && err.status === 402) setNeedsFunds(true);
      setError(message);
      setPhase('IDLE');
      const stopAt = performance.now();
      reelsRef.current.forEach((reel, index) => {
        reel.settleTo = (Math.floor(reel.offset) + SETTLE_TRAVEL) % STRIP_LENGTH;
        reel.settleAt = stopAt + index * 90;
      });
      settledRef.current = true;
    }
  }, [busy, betError, bet]);

  const draw = useCallback(({ ctx, width, height, delta }: CanvasFrame) => {
    const now = performance.now();
    const dt = Math.min(delta, 50) / 1000;

    const cellW = width / SLOTS_REELS;
    const cellH = height / SLOTS_ROWS;
    const symbolSize = Math.min(cellW, cellH) * 0.78;

    let allStopped = true;
    for (const reel of reelsRef.current) {
      switch (reel.phase) {
        case 'accelerating': {
          const t = Math.min(1, (now - spinStartedAtRef.current) / TIMING.accelerateMs);
          reel.velocity = TIMING.topSpeed * t * t;
          if (t >= 1) reel.phase = 'spinning';
          reel.offset += reel.velocity * dt;
          allStopped = false;
          break;
        }
        case 'spinning': {
          reel.offset += reel.velocity * dt;
          if (reel.settleAt !== null && now >= reel.settleAt) {
            reel.phase = 'settling';
            reel.settleStartedAt = now;
            reel.settleFrom = reel.offset;
            const cycles = Math.ceil(
              (reel.offset + SETTLE_TRAVEL - reel.settleTo) / STRIP_LENGTH
            );
            reel.settleTo += cycles * STRIP_LENGTH;
          }
          allStopped = false;
          break;
        }
        case 'settling': {
          const t = Math.min(1, (now - reel.settleStartedAt) / TIMING.settleMs);
          const eased = easeOutBack(t);
          reel.offset = reel.settleFrom + (reel.settleTo - reel.settleFrom) * eased;
          reel.velocity = ((reel.settleTo - reel.settleFrom) * (1 - t)) / (TIMING.settleMs / 1000);
          if (t >= 1) {
            reel.offset = reel.settleTo;
            reel.velocity = 0;
            reel.phase = 'stopped';
            audioRef.current.onReelStop(reelsRef.current.indexOf(reel));
          } else {
            allStopped = false;
          }
          break;
        }
        default:
          break;
      }
    }

    if (allStopped && !settledRef.current) {
      settledRef.current = true;
      const pending = pendingResultRef.current;
      if (pending) {
        winCellsRef.current = pending.winningLines.map((line) => ({
          cells: line.cells,
          lineIndex: line.lineIndex,
        }));
        resolvedAtRef.current = now;
        setResult(pending);
        setPhase('RESULT');
        if (compareDecimal(pending.totalWin, '0') > 0) audioRef.current.onWin(pending.totalWin);
        else audioRef.current.onLose();
      }
    }

    ctx.fillStyle = '#070b11';
    ctx.fillRect(0, 0, width, height);

    const winning = new Set(
      winCellsRef.current.flatMap((line) => line.cells.map(([r, c]) => `${r}:${c}`))
    );

    for (let reelIndex = 0; reelIndex < SLOTS_REELS; reelIndex += 1) {
      const reel = reelsRef.current[reelIndex];
      const x = reelIndex * cellW;

      ctx.fillStyle = reelIndex % 2 === 0 ? '#0d141c' : '#101922';
      ctx.fillRect(x, 0, cellW, height);

      const fractional = reel.offset - Math.floor(reel.offset);
      const base = Math.floor(reel.offset);
      const blur = Math.min(1, Math.abs(reel.velocity) / TIMING.topSpeed);
      const ghosts = blur > 0.04 ? Math.round(2 + blur * 5) : 1;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, cellW, height);
      ctx.clip();

      for (let row = -1; row <= SLOTS_ROWS; row += 1) {
        const symbol = reel.strip[(base + row + STRIP_LENGTH * 2) % STRIP_LENGTH];
        if (!symbol) continue;
        const cy = (row - fractional + 0.5) * cellH;
        const cx = x + cellW / 2;

        if (ghosts === 1) {
          const lit = reel.phase === 'stopped' && winning.has(`${reelIndex}:${row}`);
          if (lit) {
            ctx.save();
            ctx.shadowColor = SYMBOL_COLOURS[symbol].glow;
            ctx.shadowBlur = symbolSize * 0.45;
            drawSymbol(ctx, symbol, cx, cy, symbolSize);
            ctx.restore();
          } else {
            drawSymbol(ctx, symbol, cx, cy, symbolSize, reel.phase === 'stopped' ? 1 : 0.9);
          }
        } else {
          const spread = cellH * blur * 0.55;
          for (let g = 0; g < ghosts; g += 1) {
            const k = g / (ghosts - 1) - 0.5;
            drawSymbol(ctx, symbol, cx, cy + k * spread, symbolSize, 0.85 / ghosts + 0.08);
          }
        }
      }
      ctx.restore();

      ctx.fillStyle = 'rgba(148,163,184,.14)';
      ctx.fillRect(x + cellW - 1, 0, 1, height);
    }

    if (winCellsRef.current.length && resolvedAtRef.current !== null) {
      const age = now - resolvedAtRef.current;
      const pulse = 0.55 + 0.45 * Math.sin(age / 190);

      winCellsRef.current.forEach((line, i) => {
        const colour = NEON[line.lineIndex % NEON.length];
        const rows = SLOTS_PAYLINES[line.lineIndex];
        if (!rows) return;

        ctx.save();
        ctx.globalAlpha = 0.35 + 0.45 * pulse;
        ctx.strokeStyle = colour;
        ctx.shadowColor = colour;
        ctx.shadowBlur = 18 * pulse;
        ctx.lineWidth = Math.max(3, cellH * 0.055);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.beginPath();
        rows.forEach((row, reelIndex) => {
          const px = reelIndex * cellW + cellW / 2;
          const py = (row + 0.5) * cellH;
          if (reelIndex === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();

        ctx.globalAlpha = 0.8 + 0.2 * pulse;
        ctx.lineWidth = Math.max(2, cellH * 0.03);
        for (const [reelIndex, row] of line.cells) {
          roundRect(
            ctx,
            reelIndex * cellW + cellW * 0.06,
            row * cellH + cellH * 0.06,
            cellW * 0.88,
            cellH * 0.88,
            Math.min(cellW, cellH) * 0.12
          );
          ctx.stroke();
        }

        ctx.globalAlpha = 0.9;
        ctx.shadowBlur = 0;
        ctx.fillStyle = colour;
        ctx.font = `900 ${Math.max(10, cellH * 0.14)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${line.lineIndex + 1}`, cellW * 0.03, (rows[0] + 0.5) * cellH - i * 2);
        ctx.restore();
      });
    }

    ctx.strokeStyle = 'rgba(148,163,184,.1)';
    ctx.lineWidth = 1;
    for (let row = 1; row < SLOTS_ROWS; row += 1) {
      ctx.beginPath();
      ctx.moveTo(0, row * cellH);
      ctx.lineTo(width, row * cellH);
      ctx.stroke();
    }
  }, []);

  const canvasRef = useCanvasRenderer(draw);

  const totalWin = result?.totalWin ?? '0';
  const hasWin = compareDecimal(totalWin, '0') > 0;

  return (
    <div className="slot neu">
      <div className="slot__cabinet">
        <div className="slot__marquee">
          <h2 className="slot__title">{t('gameUi.slotsTitle')}</h2>
          <div className="slot__meta">
            <span className="slot__chip">Bet {formatDecimalString(bet, 2)}</span>
            <span className={`slot__chip${hasWin ? ' slot__chip--win' : ''}`}>
              Win {formatDecimalString(totalWin, 2)}
            </span>
          </div>
        </div>

        <div className="slot__screen">
          <canvas ref={canvasRef} className="slot__canvas" />
          {phase === 'RESULT' && hasWin && (
            <div className="slot__flash" role="status">
              {result!.winningLines.length} line
              {result!.winningLines.length === 1 ? '' : 's'} ·{' '}
              {formatDecimalString(totalWin, 2)} {wallet.currency}
            </div>
          )}
        </div>
      </div>

      <div className="slot__panel">
        <div>
          <label className="slot__label" htmlFor="slot-bet">
            <span>{t('gameUi.betAmount')}</span>
            <b>
              {wallet.hasSynced ? `${wallet.formatted} ${wallet.currency}` : '—'}
            </b>
          </label>
          <div className="slot__inputs">
            <input
              id="slot-bet"
              className="slot__input"
              type="text"
              inputMode="decimal"
              value={bet}
              disabled={busy}
              aria-invalid={betError !== null}
              onChange={(e) => setBet(sanitizeDecimalInput(e.target.value))}
              onBlur={() => adjust(bet === '' ? BET_LIMITS.min : bet)}
            />
          </div>
          <div className="slot__quick">
            <button
              type="button"
              className="slot__mod"
              disabled={busy}
              onClick={() => adjust(BET_LIMITS.min)}
            >
              Min
            </button>
            <button
              type="button"
              className="slot__mod"
              disabled={busy}
              onClick={() => adjust(divideDecimal(bet, 2n))}
            >
              ½
            </button>
            <button
              type="button"
              className="slot__mod"
              disabled={busy}
              onClick={() => adjust(multiplyDecimal(bet, 2n))}
            >
              2x
            </button>
            <button
              type="button"
              className="slot__mod"
              disabled={busy}
              onClick={() => adjust(maxBet)}
            >
              Max
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`slot__spin${busy ? ' slot__spin--busy' : ''}`}
          onClick={spin}
          disabled={busy || !betReady}
        >
          {busy ? 'Spinning…' : 'Spin'}
        </button>

        {betError && !busy && (
          <p className="slot__error">
            {betError}
            {betError === INSUFFICIENT && (
              <button
                type="button"
                className="slot__deposit"
                onClick={() => openPanel('deposit')}
              >
                Deposit
              </button>
            )}
          </p>
        )}
        {error && (
          <p className="slot__error">
            {error}
            {needsFunds && (
              <button
                type="button"
                className="slot__deposit"
                onClick={() => openPanel('deposit')}
              >
                Deposit
              </button>
            )}
          </p>
        )}

        <div className="slot__row">
          <span className="slot__label" style={{ margin: 0 }}>
            Sound
          </span>
          <button
            type="button"
            className="slot__toggle"
            aria-pressed={soundOn}
            onClick={() => setSoundOn((on) => !on)}
          >
            {soundOn ? 'On' : 'Off'}
          </button>
        </div>

        {result && result.winningLines.length > 0 && (
          <ul className="slot__lines">
            {result.winningLines.map((line) => (
              <li className="slot__line" key={line.lineIndex}>
                <span className="slot__line-name">
                  <span
                    className="slot__swatch"
                    style={{ background: NEON[line.lineIndex % NEON.length] }}
                  />
                  {SLOTS_PAYLINE_NAMES[line.lineIndex]} · {line.count}× {line.symbol}
                </span>
                <span className="slot__line-pay">
                  +{formatDecimalString(line.payout, 2)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="slot__paytable">
          <div className="slot__paytable-grid">
            <span className="slot__paytable-head">{t('gameUi.slotsSymbol')}</span>
            <span className="slot__paytable-head slot__paytable-val">3</span>
            <span className="slot__paytable-head slot__paytable-val">4</span>
            <span className="slot__paytable-head slot__paytable-val">5</span>
            {SLOTS_SYMBOLS.map((symbol) => (
              <span key={symbol} style={{ display: 'contents' }}>
                <span className="slot__paytable-sym">
                  <span
                    className="slot__swatch"
                    style={{ background: SYMBOL_COLOURS[symbol].body }}
                  />
                  {symbol}
                </span>
                <span className="slot__paytable-val">{SLOTS_PAYTABLE[symbol][3]}</span>
                <span className="slot__paytable-val">{SLOTS_PAYTABLE[symbol][4]}</span>
                <span className="slot__paytable-val">{SLOTS_PAYTABLE[symbol][5]}</span>
              </span>
            ))}
          </div>
          <p className="slot__foot" style={{ marginTop: 10 }}>
            Awards are multiples of the line stake; the bet is split across all 5
            lines. Wins pay left to right from reel 1, and WILD substitutes for
            every symbol. Every spin is resolved and settled on the server.
          </p>
        </div>
      </div>
    </div>
  );
}

