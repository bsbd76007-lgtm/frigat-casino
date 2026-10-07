'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { gameErrorKey, useGameRound } from '@/hooks/useGameRound';
import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import {
  compareDecimal,
  formatDecimalString,
  fromUnits,
  isDecimalString,
  safeDecimal,
  sanitizeDecimalInput,
  toFixedDecimal,
  toUnits,
} from '@/lib/decimal';
import { aviaLandingChance, aviaSafeLandingMaxStake } from '@/lib/verify';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { AVIA, BET_LIMITS, type AviaMode, type AviaSpotId } from '@frigat/shared/constants';

import {
  GAME_CONFIG,
  ON_DECK,
  PICKUPS,
  SPEEDS,
  altitudeAt,
  formatMetres,
  formatMultiplier,
  paceFor,
  payoutFor,
  planFlight,
  specFor,
  type FlightPlan,
  type Phase,
  type ServerEvent,
} from './aviaMasters/config';
import {
  drawBomb,
  drawCarrier,
  drawFinishMarker,
  drawIsland,
  drawPickup,
  drawPlane,
  drawRig,
  drawSpotTag,
} from './aviaMasters/draw';
import { CSS, STYLE_ID } from './aviaMasters/styles';

export { GAME_CONFIG, PICKUPS, payoutFor } from './aviaMasters/config';
export type { Phase, PickupSpec } from './aviaMasters/config';


interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
  kind: 'spark' | 'smoke';
}

interface Floater {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  text: string;
  sub: string;
  good: boolean;
}

interface Settlement {
  landed: boolean;
  multiplier: number;
  payout: string;
  spot: AviaSpotId | null;
}

const SAFE_FEE = AVIA.safeLanding.fee.toFixed(2);


export default function AviaMasters() {
  const { t } = useLanguage();
  useInjectedStyles(STYLE_ID, CSS);

  const { balance } = useGameSocket();

  const [phase, setPhase] = useState<Phase>('IDLE');
  const [bet, setBet] = useState('10.00');
  const [mode, setMode] = useState<AviaMode>('fast');
  const [safe, setSafe] = useState(false);
  const modeRef = useRef<AviaMode>('fast');
  modeRef.current = mode;
  const tRef = useRef(t);
  tRef.current = t;
  const [settled, setSettled] = useState<Settlement | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [launchBalance, setLaunchBalance] = useState<string | null>(null);

  const [hud, setHud] = useState({ altitude: 0, distance: 0, multiplier: 1 });

  const phaseRef = useRef<Phase>('IDLE');
  const planRef = useRef<FlightPlan | null>(null);
  const resultRef = useRef<Settlement | null>(null);
  const flightClockRef = useRef(0);
  const altitudeRef = useRef<number>(ON_DECK);
  const distanceRef = useRef(0);
  const multiplierRef = useRef(1);
  const nextEventRef = useRef(0);
  const eventAgeRef = useRef<number[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const landingStartedRef = useRef<number | null>(null);
  const shakeRef = useRef(0);
  const hudClockRef = useRef(0);
  const propellerRef = useRef(0);
  const waveRef = useRef(0);
  const settleRoundRef = useRef<() => void>(() => {});

  const flashRef = useRef(0);
  const smokeRef = useRef(0);
  const floatersRef = useRef<Floater[]>([]);

  const pitchRef = useRef(0);

  const isAirborne = phase === 'WAITING' || phase === 'FLYING' || phase === 'LANDING';
  const isOver = phase === 'LANDED' || phase === 'CRASHED';

  const minBet = safe ? BET_LIMITS.min : GAME_CONFIG.minBet;
  const safeBet = useMemo(() => safeDecimal(bet, minBet), [bet, minBet]);
  const safeCap = useMemo(() => toFixedDecimal(String(aviaSafeLandingMaxStake(mode)), 2), [mode]);
  const charged = useMemo(
    () => (safe ? fromUnits(toUnits(safeBet) + toUnits(SAFE_FEE)) : safeBet),
    [safe, safeBet]
  );

  const betError = useMemo(() => {
    if (!isDecimalString(bet.trim())) return t('gameUi.aviaInvalidAmount');
    if (compareDecimal(safeBet, minBet) < 0) {
      return t('gameUi.aviaMinBet', { amount: `$${formatDecimalString(minBet, 2)}` });
    }
    if (compareDecimal(safeBet, GAME_CONFIG.maxBet) > 0) {
      return t('gameUi.aviaMaxBet', { amount: `$${formatDecimalString(GAME_CONFIG.maxBet, 2)}` });
    }
    if (safe && compareDecimal(safeBet, safeCap) > 0) {
      return t('gameUi.aviaSafeCap', { amount: `$${safeCap}` });
    }
    if (balance.hasSynced && balance.balance && compareDecimal(charged, balance.balance) > 0) {
      return t('gameUi.aviaNoBalance');
    }
    return null;
  }, [bet, safeBet, minBet, safe, safeCap, charged, balance.hasSynced, balance.balance, t]);

  const payout = useMemo(
    () => (phase === 'CRASHED' ? '0' : payoutFor(safeBet, hud.multiplier)),
    [phase, safeBet, hud.multiplier]
  );

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const burst = useCallback((x: number, y: number, count: number, hue: number) => {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 180;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.4 + Math.random() * 0.5,
        hue: hue + Math.random() * 30 - 15,
        size: 2 + Math.random() * 4,
        kind: 'spark',
      });
    }
  }, []);

  const emitSmoke = useCallback((x: number, y: number) => {
    particlesRef.current.push({
      x: x - 4 + Math.random() * 6,
      y: y + Math.random() * 6 - 3,
      vx: -70 - Math.random() * 60,
      vy: -14 - Math.random() * 22,
      life: 0,
      maxLife: 0.75 + Math.random() * 0.6,
      hue: 0,
      size: 3 + Math.random() * 4,
      kind: 'smoke',
    });
  }, []);

  const registerHit = useCallback(
    (screenX: number, screenY: number, multiplierLost: number) => {
      flashRef.current = 0.32;
      shakeRef.current = 0.5;
      smokeRef.current = 2.4;
      burst(screenX, screenY, 26, 25);
      floatersRef.current.push({
        x: screenX,
        y: screenY - 26,
        life: 0,
        maxLife: 1.15,
        text: tRef.current('gameUi.aviaCallBomb'),
        sub: `−${multiplierLost.toFixed(2)}x`,
        good: false,
      });
    },
    [burst]
  );

  const { busy, settle: releaseControls, bet: placeBet } = useGameRound('AVIA', {
    autoSettle: false,
    onResult: ({ raw }) => {
      if (phaseRef.current !== 'WAITING') return;
      const data = (raw.resultData ?? {}) as {
        landed?: boolean;
        events?: ServerEvent[];
        spot?: AviaSpotId | null;
      };
      const plan = planFlight(data.events ?? [], Boolean(data.landed), data.spot ?? null);
      planRef.current = plan;
      resultRef.current = {
        landed: plan.landed,
        multiplier: typeof raw.multiplier === 'number' ? raw.multiplier : 0,
        payout: typeof raw.payout === 'string' ? raw.payout : '0',
        spot: plan.spot?.id ?? null,
      };
      eventAgeRef.current = plan.events.map(() => -1);
      flightClockRef.current = 0;
      setPhaseBoth('FLYING');
    },
    onError: ({ code }) => {
      if (phaseRef.current === 'WAITING') setPhaseBoth('IDLE');
      setLaunchBalance(null);
      setServerError(t(gameErrorKey(code)));
    },
  });

  const settleRound = useCallback(() => {
    const result = resultRef.current;
    if (!result) return;
    setSettled(result);
    setPhaseBoth(result.landed ? 'LANDED' : 'CRASHED');
    setLaunchBalance(null);
    releaseControls();
  }, [releaseControls, setPhaseBoth]);
  settleRoundRef.current = settleRound;

  const launch = useCallback(() => {
    if (betError || busy) return;
    if (phaseRef.current !== 'IDLE' && phaseRef.current !== 'LANDED' && phaseRef.current !== 'CRASHED') {
      return;
    }
    planRef.current = null;
    resultRef.current = null;
    altitudeRef.current = ON_DECK;
    distanceRef.current = 0;
    multiplierRef.current = 1;
    nextEventRef.current = 0;
    eventAgeRef.current = [];
    particlesRef.current = [];
    landingStartedRef.current = null;
    pitchRef.current = 0;
    shakeRef.current = 0;
    flashRef.current = 0;
    smokeRef.current = 0;
    floatersRef.current = [];
    setSettled(null);
    setServerError(null);
    setLaunchBalance(balance.balance);
    setHud({ altitude: ON_DECK, distance: 0, multiplier: 1 });
    setPhaseBoth('WAITING');
    placeBet('BET', {
      amount: toFixedDecimal(safeBet, 2),
      currency: balance.currency,
      params: { mode, safe },
    });
  }, [betError, busy, balance.balance, balance.currency, placeBet, safeBet, mode, safe, setPhaseBoth]);

  const onCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      launch();
    },
    [launch]
  );

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|BUTTON|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      if (!event.repeat) launch();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [launch]);

  const draw = useCallback(
    ({ ctx, width, height, delta }: CanvasFrame) => {
      const dt = Math.min(delta, 50) / 1000;
      const now = performance.now();

      const seaY = height * 0.84;
      const skyTop = height * 0.1;
      const scale = Math.max(4, Math.min(9, height / 52));
      const planeX = width * 0.3;
      const pxPerMetre = width / 620;

      const altToY = (alt: number) =>
        seaY - (alt / GAME_CONFIG.maxAltitude) * (seaY - skyTop);
      const deckY = altToY(GAME_CONFIG.deckAltitude);

      const plan = planRef.current;
      const phaseNow = phaseRef.current;
      const flying = phaseNow === 'FLYING' && plan !== null;
      const landing = phaseNow === 'LANDING' && plan !== null;
      waveRef.current += dt;

      if (flying) {
        flightClockRef.current += dt;
        const launchT = Math.min(1, flightClockRef.current / GAME_CONFIG.catapultSeconds);
        const speed = GAME_CONFIG.cruiseSpeed * paceFor(modeRef.current) * (0.35 + 0.65 * launchT);
        const before = distanceRef.current;
        distanceRef.current = Math.min(plan.endX, before + speed * dt);
        altitudeRef.current = altitudeAt(plan, distanceRef.current);

        while (
          nextEventRef.current < plan.events.length &&
          distanceRef.current >= plan.events[nextEventRef.current].x
        ) {
          const i = nextEventRef.current;
          const event = plan.events[i];
          const spec = specFor(event.kind);
          const previous = multiplierRef.current;
          multiplierRef.current = event.multiplier;
          eventAgeRef.current[i] = 0;
          const y = altToY(event.alt);
          if (spec.hazard) {
            registerHit(planeX, y, Math.max(0, previous - event.multiplier));
          } else {
            burst(planeX, y, 12, 130);
            floatersRef.current.push({
              x: planeX,
              y: y - 30,
              life: 0,
              maxLife: 0.9,
              text: spec.label,
              sub: formatMultiplier(event.multiplier),
              good: true,
            });
          }
          nextEventRef.current += 1;
        }

        if (distanceRef.current >= plan.endX) {
          if (plan.landed) {
            landingStartedRef.current = now;
            burst(planeX, deckY, 14, 130);
            const bonus = plan.spot && plan.spot.mul !== 1 ? ` ×${plan.spot.mul}` : '';
            floatersRef.current.push({
              x: planeX,
              y: deckY - 46,
              life: 0,
              maxLife: 1.4,
              text: tRef.current('gameUi.aviaCallTouchdown'),
              sub: tRef.current('gameUi.aviaCallBanked', {
                multiplier: `${formatMultiplier(multiplierRef.current)}${bonus}`,
              }),
              good: true,
            });
            setPhaseBoth('LANDING');
          } else {
            altitudeRef.current = 0;
            burst(planeX, seaY, 34, 200);
            burst(planeX, seaY, 20, 40);
            flashRef.current = 0.4;
            shakeRef.current = 0.7;
            floatersRef.current.push({
              x: planeX,
              y: seaY - 42,
              life: 0,
              maxLife: 1.3,
              text: tRef.current('gameUi.aviaCallSplash'),
              sub: tRef.current('gameUi.aviaCallShort'),
              good: false,
            });
            settleRoundRef.current();
          }
        }
      }

      if (landing && landingStartedRef.current !== null) {
        const t = Math.min(1, (now - landingStartedRef.current) / GAME_CONFIG.landingMs);
        const eased = 1 - Math.pow(1 - t, 3);
        const rollout = (plan.spot?.length ?? GAME_CONFIG.carrierLength) * 0.4;
        distanceRef.current = plan.endX + rollout * eased;
        altitudeRef.current = ON_DECK;
        if (t >= 1) settleRoundRef.current();
      }

      const distance = distanceRef.current;

      for (const [i, age] of eventAgeRef.current.entries()) {
        if (age >= 0) eventAgeRef.current[i] = age + dt;
      }

      if (smokeRef.current > 0) {
        smokeRef.current = Math.max(0, smokeRef.current - dt);
        if (flying) emitSmoke(planeX - 6, altToY(altitudeRef.current));
      }

      for (const particle of particlesRef.current) {
        particle.life += dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        if (particle.kind === 'spark') particle.vy += 260 * dt;
        else {
          particle.vx *= 1 - 0.9 * dt;
          particle.vy -= 8 * dt;
        }
      }
      particlesRef.current = particlesRef.current.filter((p) => p.life < p.maxLife);

      for (const floater of floatersRef.current) floater.life += dt;
      floatersRef.current = floatersRef.current.filter((f) => f.life < f.maxLife);

      if (flashRef.current > 0) flashRef.current = Math.max(0, flashRef.current - dt);

      hudClockRef.current += dt;
      if (hudClockRef.current > 0.08) {
        hudClockRef.current = 0;
        setHud({
          altitude: altitudeRef.current,
          distance: distanceRef.current,
          multiplier: multiplierRef.current,
        });
      }

      ctx.save();
      if (shakeRef.current > 0) {
        shakeRef.current = Math.max(0, shakeRef.current - dt);
        const power = shakeRef.current * 14;
        ctx.translate((Math.random() - 0.5) * power, (Math.random() - 0.5) * power);
      }

      ctx.fillStyle = '#1d4e89';
      ctx.fillRect(-20, -20, width + 40, seaY + 20);

      ctx.fillStyle = 'rgba(255,255,255,.10)';
      for (let i = 0; i < 7; i += 1) {
        const seedX = ((i * 613) % 1000) / 1000;
        const cloudX =
          ((seedX * width * 2 - distance * pxPerMetre * 0.22) % (width * 1.6) + width * 1.6) %
            (width * 1.6) -
          width * 0.3;
        const cloudY = skyTop + ((i * 137) % 100) / 100 * (seaY - skyTop) * 0.55;
        const r = 18 + ((i * 71) % 40);
        ctx.beginPath();
        ctx.ellipse(cloudX, cloudY, r * 1.9, r * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#0e4a6b';
      ctx.fillRect(-20, seaY, width + 40, height - seaY + 20);

      ctx.strokeStyle = 'rgba(148,197,231,.22)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i += 1) {
        const y = seaY + 8 + i * ((height - seaY) / 5);
        const offset = (distance * pxPerMetre * (0.4 + i * 0.12)) % 60;
        ctx.beginPath();
        for (let x = -60; x < width + 60; x += 30) {
          ctx.moveTo(x - offset, y);
          ctx.quadraticCurveTo(x - offset + 9, y - 3, x - offset + 18, y);
        }
        ctx.stroke();
      }

      const toScreenX = (x: number) => planeX + (x - distance) * pxPerMetre;
      const carrierPx = GAME_CONFIG.carrierLength * pxPerMetre;

      const launchX = toScreenX(-GAME_CONFIG.carrierLength * 0.85);
      if (launchX + carrierPx > -40) {
        drawCarrier(ctx, launchX, deckY, seaY, carrierPx, '#e0b055');
      }

      if (plan) {
        for (const spot of plan.spots) {
          const left = toScreenX(spot.left);
          const spotPx = spot.length * pxPerMetre;
          if (left > width + 40 || left + spotPx < -40) continue;
          const accent = spot.id === 'rig' ? '#f0b54a' : spot.id === 'island' ? '#86efac' : '#22c55e';
          if (spot.id === 'carrier') drawCarrier(ctx, left, deckY, seaY, spotPx, accent);
          else if (spot.id === 'island') drawIsland(ctx, left, deckY, seaY, spotPx, accent);
          else drawRig(ctx, left, deckY, seaY, spotPx, accent);
          drawSpotTag(ctx, left + spotPx / 2, deckY, scale, `×${spot.mul}`, accent);
          if (plan.spot === spot) {
            drawFinishMarker(ctx, left + spotPx * 0.9, deckY, scale, waveRef.current);
          }
        }
      }

      if (plan) {
        for (const [i, event] of plan.events.entries()) {
          const x = toScreenX(event.x);
          if (x < -60 || x > width + 60) continue;
          const age = eventAgeRef.current[i] ?? -1;
          const spec = specFor(event.kind);
          if (spec.hazard) {
            if (age < 0) drawBomb(ctx, x, altToY(event.alt), scale, waveRef.current + i);
          } else {
            drawPickup(ctx, x, altToY(event.alt), scale * 2.1, spec, Math.max(0, age));
          }
        }
      }

      if (phaseNow !== 'CRASHED' || particlesRef.current.length > 0) {
        let targetPitch = 0;
        if (plan && flying) {
          const rise = altToY(altitudeAt(plan, distance)) - altToY(altitudeAt(plan, distance + 25));
          const slope = Math.atan2(rise, 25 * pxPerMetre);
          targetPitch = Math.max(-GAME_CONFIG.maxPitchUp, Math.min(GAME_CONFIG.maxPitchDown, -slope));
        } else if (landing) {
          targetPitch = -0.05;
        }
        pitchRef.current += (targetPitch - pitchRef.current) * Math.min(1, dt * 9);
        const climbing = pitchRef.current;
        propellerRef.current += dt * 34;
        drawPlane(
          ctx,
          planeX,
          altToY(altitudeRef.current),
          scale,
          phaseNow === 'CRASHED' ? 0.9 : climbing,
          propellerRef.current
        );
      }

      for (const particle of particlesRef.current) {
        const t = particle.life / particle.maxLife;
        if (particle.kind === 'smoke') {
          ctx.fillStyle = `rgba(120,132,148,${(1 - t) * 0.5})`;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * (1 + t * 2.4), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = `hsla(${particle.hue}, 95%, ${60 - t * 25}%, ${1 - t})`;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (const floater of floatersRef.current) {
        const t = floater.life / floater.maxLife;
        const rise = t * 34;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t * t);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, scale * 0.5);
        ctx.strokeStyle = 'rgba(8,17,27,.85)';
        ctx.font = `900 ${scale * 2.1}px ui-sans-serif, system-ui, sans-serif`;
        ctx.strokeText(floater.text, floater.x, floater.y - rise);
        ctx.fillStyle = floater.good ? '#4ade80' : '#ef4444';
        ctx.fillText(floater.text, floater.x, floater.y - rise);

        ctx.font = `800 ${scale * 1.5}px ui-sans-serif, system-ui, sans-serif`;
        ctx.strokeText(floater.sub, floater.x, floater.y - rise + scale * 2);
        ctx.fillStyle = floater.good ? '#bbf7d0' : '#d69199';
        ctx.fillText(floater.sub, floater.x, floater.y - rise + scale * 2);
        ctx.restore();
      }

      ctx.restore();

      if (flashRef.current > 0) {
        ctx.fillStyle = `rgba(239,68,68,${(flashRef.current / 0.32) * 0.3})`;
        ctx.fillRect(0, 0, width, height);
      }
    },
    [burst, emitSmoke, registerHit, setPhaseBoth]
  );

  const canvasRef = useCanvasRenderer(draw, { maxPixelRatio: 3 });

  const scaleBet = (factor: number) => {
    setBet((current) => {
      const value = Number(current || '0') * factor;
      return value.toFixed(2);
    });
  };

  const maxStake = () => {
    const ceiling =
      balance.hasSynced && balance.balance && compareDecimal(balance.balance, GAME_CONFIG.maxBet) < 0
        ? balance.balance
        : GAME_CONFIG.maxBet;
    setBet(toFixedDecimal(ceiling, 2));
  };

  const shownBalance = isAirborne && launchBalance !== null ? launchBalance : balance.balance;

  return (
    <div className="avia neu">
      <div className="avia__stage">
        <canvas
          ref={canvasRef}
          className="avia__canvas"
          onPointerDown={onCanvasPointerDown}
          role="application"
          aria-label={t('gameUi.aviaFlightAria')}
        />

        <div className="avia__hud" aria-live="off">
          <div className="avia__tile">
            <span className="avia__tile-label">{t('gameUi.aviaAltitude')}</span>
            <span className="avia__tile-value">{formatMetres(hud.altitude)}</span>
          </div>
          <div className="avia__tile">
            <span className="avia__tile-label">{t('gameUi.aviaDistance')}</span>
            <span className="avia__tile-value">{formatMetres(hud.distance)}</span>
          </div>
          <div className="avia__tile avia__tile--mult">
            <span className="avia__tile-label">{t('gameUi.aviaMultiplier')}</span>
            <span className="avia__tile-value">{formatMultiplier(hud.multiplier)}</span>
          </div>
          <div className="avia__tile avia__tile--payout">
            <span className="avia__tile-label">{t('gameUi.aviaPayout')}</span>
            <span className="avia__tile-value">${formatDecimalString(payout, 2)}</span>
          </div>
        </div>

        {isOver && settled && (
          <div
            className={`avia__banner ${
              settled.landed ? 'avia__banner--won' : 'avia__banner--lost'
            }`}
            role="status"
          >
            {settled.landed ? (
              <>
                {t('gameUi.aviaLanded', { multiplier: formatMultiplier(settled.multiplier) })}
                {settled.spot && <small>{t(`gameUi.aviaSpot_${settled.spot}`)}</small>}
                <small>+${formatDecimalString(settled.payout, 2)}</small>
              </>
            ) : (
              <>
                {t('gameUi.aviaDitched')}
                <small>{t('gameUi.aviaStakeLost')}</small>
              </>
            )}
          </div>
        )}

        <p className="avia__hint">
          {isAirborne ? t('gameUi.aviaHintFlying') : t('gameUi.aviaHintIdle')}
        </p>
      </div>

      <div className="avia__panel">
        <div>
          <div className="avia__label">
            <span>{t('gameUi.betAmount')}</span>
            <b>
              {balance.hasSynced && shownBalance
                ? `${formatDecimalString(shownBalance, 2)} ${balance.currency}`
                : '—'}
            </b>
          </div>
          <div className="avia__inputs">
            <input
              className="avia__input"
              inputMode="decimal"
              value={bet}
              disabled={isAirborne}
              aria-invalid={betError !== null}
              aria-label={t('gameUi.betAmount')}
              onChange={(event) => setBet(sanitizeDecimalInput(event.target.value))}
            />
            <button
              type="button"
              className="avia__mod"
              disabled={isAirborne}
              aria-label={t('gameUi.halveBet')}
              onClick={() => scaleBet(0.5)}
            >
              ½
            </button>
            <button
              type="button"
              className="avia__mod"
              disabled={isAirborne}
              aria-label={t('gameUi.doubleBet')}
              onClick={() => scaleBet(2)}
            >
              2x
            </button>
            <button
              type="button"
              className="avia__mod"
              disabled={isAirborne}
              aria-label={t('gameUi.maxBet')}
              onClick={maxStake}
            >
              {t('gameUi.max')}
            </button>
          </div>
        </div>

        <div>
          <div className="avia__label">
            <span>{t('gameUi.aviaSpeed')}</span>
            <b>
              {t('gameUi.aviaLandChance', {
                percent: `${(aviaLandingChance(mode) * 100).toFixed(1)}%`,
              })}
            </b>
          </div>
          <div className="avia__speeds">
            {SPEEDS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`avia__speed${s.id === mode ? ' avia__speed--on' : ''}`}
                aria-pressed={s.id === mode}
                disabled={isAirborne}
                onClick={() => {
                  setMode(s.id);
                  if (safe) {
                    const cap = toFixedDecimal(String(aviaSafeLandingMaxStake(s.id)), 2);
                    if (compareDecimal(safeBet, cap) > 0) setBet(cap);
                  }
                }}
              >
                <span>{t(`gameUi.aviaSpeed_${s.id}`)}</span>
                <small>{(aviaLandingChance(s.id) * 100).toFixed(1)}%</small>
              </button>
            ))}
          </div>
        </div>

        <label className={`avia__safe${safe ? ' avia__safe--on' : ''}`}>
          <input
            type="checkbox"
            checked={safe}
            disabled={isAirborne}
            onChange={(event) => {
              const on = event.target.checked;
              setSafe(on);
              if (on && compareDecimal(safeBet, safeCap) > 0) setBet(safeCap);
            }}
          />
          <span className="avia__safe-text">
            <b>{t('gameUi.aviaSafeTitle', { fee: `$${SAFE_FEE}` })}</b>
            <small>{t('gameUi.aviaSafeBody', { amount: `$${safeCap}` })}</small>
          </span>
        </label>

        <div className="avia__spots" aria-label={t('gameUi.aviaSpotsLabel')}>
          {AVIA.spots.map((spot) => (
            <span key={spot.id} className={`avia__spot avia__spot--${spot.id}`}>
              {t(`gameUi.aviaSpot_${spot.id}`)} <b>×{spot.mul}</b>
            </span>
          ))}
        </div>

        <div className="avia__legend" aria-hidden="true">
          {PICKUPS.map((spec) => (
            <span
              key={spec.kind}
              className={`avia__chip${spec.hazard ? ' avia__chip--bad' : ''}`}
            >
              {spec.label}
            </span>
          ))}
        </div>

        {!isAirborne && (betError || serverError) && (
          <p className="avia__error" role="alert">
            {betError ?? serverError}
          </p>
        )}

        {isAirborne ? (
          <div className="avia__standing" role="status">
            <span>
              {phase === 'WAITING'
                ? t('gameUi.aviaWaiting')
                : phase === 'LANDING'
                  ? t('gameUi.aviaTouchdown')
                  : t('gameUi.aviaInFlight')}
            </span>
            <b>
              {formatMultiplier(hud.multiplier)} · ${formatDecimalString(payout, 2)}
            </b>
            <small>
              {phase === 'LANDING' ? t('gameUi.aviaAutoCashout') : t('gameUi.aviaLandToBank')}
            </small>
          </div>
        ) : (
          <button
            type="button"
            className="avia__action"
            onClick={launch}
            disabled={betError !== null || busy}
          >
            {isOver ? t('gameUi.aviaFlyAgain') : t('gameUi.aviaFly')}
            {safe && (
              <small className="avia__action-sub">
                {t('gameUi.aviaChargeNote', { amount: `$${formatDecimalString(charged, 2)}` })}
              </small>
            )}
          </button>
        )}

        <p className="avia__note">{t('gameUi.aviaNote')}</p>
      </div>
    </div>
  );
}
