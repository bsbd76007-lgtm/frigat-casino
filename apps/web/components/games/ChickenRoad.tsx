'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import { loadKeyedSprite, type KeyedSprite } from '@/lib/spriteMask';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { gameErrorKey, useGameRound } from '@/hooks/useGameRound';
import { compareDecimal, formatDecimalString } from '@/lib/decimal';

import {
  COLOR_LEVELS,
  DEFAULT_MODE,
  FOLLOW_GAP,
  GAME_CONFIG,
  HOP_MS,
  PIXEL_SIZE,
  LAYOUT,
  SEED_GEOMETRY,
  TRAFFIC_MODES,
  crossingChanceAt,
  cumulativeChanceAt,
  formatChance,
  formatMultiplier,
  gateFraction,
  laneDirection,
  lastLane,
  money,
  unlockLane,
  multiplierAt,
  randomBetween,
  type Geometry,
  type Phase,
  type TrafficMode,
} from './chickenRoad/config';
import {
  CAR_UNITS,
  CHICKEN_RENDERER,
  CHICKEN_SPRITE_SRC,
  CHICKEN_UNITS,
  drawAtmosphere,
  drawBarrier,
  drawBarrierShadow,
  drawCar3D,
  drawCarShadow,
  drawChickenShadow,
  drawChickenSmooth,
  drawCover,
  drawCoverLabels,
  drawOverpass,
  drawRoad,
  overpassClipY,
  randomCarColour,
  type CarColour,
  type CoverState,
} from './chickenRoad/draw';
import { DEPTH_STRETCH, makeView } from './chickenRoad/view';
import { CSS, STYLE_ID } from './chickenRoad/styles';

export {
  GAME_CONFIG,
  TRAFFIC_MODES,
  multiplierAt,
  crossingChanceAt,
  cumulativeChanceAt,
} from './chickenRoad/config';

interface ChickenResult {
  bust?: boolean;
  auto?: boolean;
  lane?: number;
  multiplier?: number;
  payout?: string;
}
export type { Phase, TrafficMode } from './chickenRoad/config';
export type { CarColour } from './chickenRoad/draw';


interface Car {
  t: number;
  speed: number;
  fleeing: boolean;
  doomed: boolean;
  colour: CarColour;
}

interface LaneTraffic {
  dir: 1 | -1;
  cars: Car[];
  nextSpawnAt: number;
}


const QUICK_BETS = [1, 5, 10, 25, 100] as const;

export default function ChickenRoad() {
  const { t } = useLanguage();
  useInjectedStyles(STYLE_ID, CSS);

  const [phase, setPhase] = useState<Phase>('IDLE');
  const [lane, setLane] = useState(0);
  const [bet, setBet] = useState(10);
  const [mode, setMode] = useState<TrafficMode>(DEFAULT_MODE);
  const [hopping, setHopping] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [lastWin, setLastWin] = useState<string | null>(null);

  const phaseRef = useRef<Phase>('IDLE');
  const laneRef = useRef(0);
  const modeRef = useRef<TrafficMode>(DEFAULT_MODE);
  const lanesRef = useRef<Map<number, LaneTraffic>>(new Map());
  const geomRef = useRef<Geometry>({ ...SEED_GEOMETRY });
  const stageRef = useRef<HTMLDivElement>(null);
  const chickenSpriteRef = useRef<KeyedSprite | null>(null);
  const gateClosedAtRef = useRef<Map<number, number>>(new Map());
  const reducedMotionRef = useRef(false);
  const cameraRef = useRef(0);
  const visualLaneRef = useRef(0);
  const hopRef = useRef<{ from: number; to: number; startedAt: number } | null>(null);
  const doomedRef = useRef<{ lane: number; at: number } | null>(null);
  const crashAtRef = useRef<number | null>(null);
  const landingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepPendingRef = useRef(false);

  const { balance, send, socket } = useGameSocket();

  const isPlaying = phase === 'PLAYING';
  const isOver = phase === 'WON' || phase === 'LOST';
  const multiplier = multiplierAt(lane, mode);
  const payout = Number((bet * multiplier).toFixed(2));

  const stake = Number.isFinite(bet) ? bet.toFixed(2) : '';

  const betError = useMemo(() => {
    if (!Number.isFinite(bet) || bet < GAME_CONFIG.minBet) {
      return `Minimum bet is ${money(GAME_CONFIG.minBet)}`;
    }
    if (bet > GAME_CONFIG.maxBet) return `Maximum bet is ${money(GAME_CONFIG.maxBet)}`;
    if (balance.balance !== null && compareDecimal(stake, balance.balance) > 0) {
      return t('gameUi.chickenInsufficient');
    }
    return null;
  }, [bet, stake, balance.balance, t]);

  const maxBet = GAME_CONFIG.maxBet;

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const setLaneBoth = useCallback((next: number) => {
    laneRef.current = next;
    setLane(next);
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = query.matches;
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (CHICKEN_RENDERER !== 'image') return;

    let cancelled = false;
    void loadKeyedSprite(CHICKEN_SPRITE_SRC).then((sprite) => {
      if (!cancelled) chickenSpriteRef.current = sprite;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
    },
    []
  );

  const spawnPoint = useCallback((dir: 1 | -1): number => {
    const clearance = geomRef.current.carHalf + 0.04;
    return dir > 0 ? -clearance : 1 + clearance;
  }, []);

  const makeCar = useCallback(
    (dir: 1 | -1, overrides: Partial<Car> = {}): Car => ({
      t: spawnPoint(dir),
      speed: randomBetween(modeRef.current.speed),
      fleeing: false,
      doomed: false,
      colour: randomCarColour(),
      ...overrides,
    }),
    [spawnPoint]
  );

  const ensureLane = useCallback(
    (l: number, now: number): LaneTraffic => {
      let traffic = lanesRef.current.get(l);
      if (!traffic) {
        const dir = laneDirection(l);
        traffic = {
          dir,
          cars: [],
          nextSpawnAt: now + randomBetween(modeRef.current.gap) * 1000 * Math.random(),
        };
        if (Math.random() < 0.6) {
          traffic.cars.push(makeCar(dir, { t: 0.2 + Math.random() * 0.6 }));
        }
        lanesRef.current.set(l, traffic);
      }
      return traffic;
    },
    [makeCar]
  );

  const stepTraffic = useCallback(
    (now: number, dt: number, first: number, last: number) => {
      const settled = laneRef.current;
      const { carLen, carHalf } = geomRef.current;

      for (const key of Array.from(lanesRef.current.keys())) {
        if (key < first - 2) lanesRef.current.delete(key);
      }

      for (let l = first; l <= last; l += 1) {
        const traffic = ensureLane(l, now);
        const closed = l <= settled;
        const dir = traffic.dir;
        const ahead = (a: number, b: number) => (dir > 0 ? a > b : a < b);
        const stopLine = gateFraction(l) - dir * (carHalf + 0.008);

        traffic.cars.sort((a, b) => (dir > 0 ? b.t - a.t : a.t - b.t));

        if (closed) {
          traffic.nextSpawnAt = now + randomBetween(modeRef.current.gap) * 1000;
        } else if (now >= traffic.nextSpawnAt) {
          const entry = spawnPoint(dir);
          const last_ = traffic.cars[traffic.cars.length - 1];
          if (!last_ || ahead(last_.t, entry + dir * (carLen + FOLLOW_GAP))) {
            traffic.cars.push(makeCar(dir));
            traffic.nextSpawnAt = now + randomBetween(modeRef.current.gap) * 1000;
          } else {
            traffic.nextSpawnAt = now + 120;
          }
        }

        let limit: number | null = null;
        for (const car of traffic.cars) {
          const speed = car.speed * (car.fleeing ? 3.2 : 1);
          let next = car.t + dir * speed * dt;

          const holdAtGate =
            closed && !car.doomed && !car.fleeing && !ahead(car.t, stopLine);
          const bound = holdAtGate
            ? limit === null
              ? stopLine
              : ahead(stopLine, limit)
                ? limit
                : stopLine
            : limit;

          if (bound !== null && ahead(next, bound)) {
            next = ahead(bound, car.t) ? bound : car.t;
          }

          car.t = next;
          limit = car.t - dir * (carLen + FOLLOW_GAP);
        }

        const exit = 1 + carHalf + 0.05;
        const entry = -(carHalf + 0.05);
        traffic.cars = traffic.cars.filter((car) => car.t > entry - 0.1 && car.t < exit);
      }
    },
    [ensureLane, makeCar, spawnPoint]
  );

  const resetTraffic = useCallback(() => {
    lanesRef.current.clear();
    gateClosedAtRef.current.clear();
    cameraRef.current = 0;
  }, []);

  const crash = useCallback(() => {
    if (phaseRef.current !== 'PLAYING') return;
    if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
    landingTimerRef.current = null;
    doomedRef.current = null;
    hopRef.current = null;
    crashAtRef.current = performance.now();
    gateClosedAtRef.current.clear();
    setHopping(false);
    setPhaseBoth('LOST');
    visualLaneRef.current = 0;
    setLaneBoth(0);
  }, [setPhaseBoth, setLaneBoth]);

  const resetBoard = useCallback(() => {
    if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
    landingTimerRef.current = null;
    resetTraffic();
    setLaneBoth(0);
    setHopping(false);
    visualLaneRef.current = 0;
    hopRef.current = null;
    doomedRef.current = null;
    crashAtRef.current = null;
    stepPendingRef.current = false;
  }, [resetTraffic, setLaneBoth]);

  const playHop = useCallback(
    (survived: boolean, onLanded?: () => void) => {
      if (phaseRef.current !== 'PLAYING') return;

      const from = laneRef.current;
      const to = from + 1;
      const now = performance.now();
      hopRef.current = { from, to, startedAt: now };
      setHopping(true);

      const traffic = ensureLane(to, now);

      if (!survived) {
        const speed = randomBetween(modeRef.current.speed);
        const travel = speed * (HOP_MS / 1000);
        const { carHalf, chickenHalf } = geomRef.current;
        traffic.cars.push({
          t: LAYOUT.chickenY - traffic.dir * (travel + carHalf + chickenHalf),
          speed,
          fleeing: false,
          doomed: true,
          colour: randomCarColour(),
        });
        doomedRef.current = { lane: to, at: now + HOP_MS };
        return;
      }

      landingTimerRef.current = setTimeout(() => {
        landingTimerRef.current = null;
        if (phaseRef.current !== 'PLAYING') return;
        hopRef.current = null;
        visualLaneRef.current = to;
        setHopping(false);
        const gate = gateFraction(to);
        const escaping = traffic.cars.filter((car) =>
          traffic.dir > 0 ? car.t >= gate : car.t <= gate
        );
        for (const car of escaping) car.fleeing = true;
        traffic.cars = escaping;
        gateClosedAtRef.current.set(to, performance.now());
        setLaneBoth(to);
        onLanded?.();
      }, HOP_MS);
    },
    [ensureLane, setLaneBoth]
  );

  const { busy, begin, settle, bet: placeBet } = useGameRound<ChickenResult>('CHICKEN', {
    on: {
      BET_ACCEPTED: (data) => {
        resetBoard();
        setLastWin(null);
        if (data.resumed) {
          const resumedMode = TRAFFIC_MODES.find((m) => m.id === data.mode);
          if (resumedMode) {
            modeRef.current = resumedMode;
            setMode(resumedMode);
          }
          if (typeof data.amount === 'string') setBet(Number(data.amount));
          const at = typeof data.lane === 'number' ? data.lane : 0;
          visualLaneRef.current = at;
          cameraRef.current = Math.max(0, at - 1.4);
          for (let l = 1; l <= at; l += 1) gateClosedAtRef.current.set(l, 0);
          setLaneBoth(at);
        }
        setPhaseBoth('PLAYING');
        settle();
      },
      STATE_UPDATE: () => {
        stepPendingRef.current = false;
        settle();
        playHop(true);
      },
    },
    onResult: ({ raw }) => {
      stepPendingRef.current = false;
      const settled = typeof raw.payout === 'string' ? raw.payout : null;
      if (raw.bust) {
        playHop(false);
        return;
      }
      const finish = () => {
        setLastWin(settled);
        setPhaseBoth('WON');
      };
      if (raw.auto) playHop(true, finish);
      else finish();
    },
    onError: ({ code }) => {
      stepPendingRef.current = false;
      setServerError(t(gameErrorKey(code)));
    },
  });

  useEffect(() => {
    if (!socket.isOpen) return;
    send('RESUME', 'CHICKEN');
  }, [socket.isOpen, send]);

  const startRound = useCallback(() => {
    if (betError || busy) return;
    resetBoard();
    setLastWin(null);
    setServerError(null);
    placeBet('BET', {
      amount: stake,
      currency: balance.currency,
      params: { mode: modeRef.current.id },
    });
  }, [betError, busy, resetBoard, placeBet, stake, balance.currency]);

  const cashOut = useCallback(() => {
    if (phaseRef.current !== 'PLAYING') return;
    if (laneRef.current === 0 || hopRef.current || doomedRef.current) return;
    if (stepPendingRef.current || busy) return;
    begin();
    send('CASHOUT', 'CHICKEN');
  }, [busy, begin, send]);

  const advance = useCallback(() => {
    if (phaseRef.current !== 'PLAYING') return;
    if (hopRef.current || doomedRef.current || stepPendingRef.current) return;
    stepPendingRef.current = true;
    setServerError(null);
    begin();
    send('STEP', 'CHICKEN');
  }, [begin, send]);

  useEffect(() => {
    if (!isPlaying) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowRight' ||
        event.key === 'd' ||
        event.key === 'D' ||
        event.key === 'w' ||
        event.key === 'W'
      ) {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, advance]);

  const viewRef = useRef<ReturnType<typeof makeView> | null>(null);
  const coverLabelsRef = useRef<
    Array<{ u: number; state: CoverState; multiplier: string; chance: string; locked: boolean }>
  >([]);
  const coverRadiusRef = useRef(0);

  const draw = useCallback(
    ({ ctx, width, height, delta }: CanvasFrame) => {
      const now = performance.now();
      const dt = Math.min(delta, 50) / 1000;

      const laneW = width / GAME_CONFIG.visibleLanes;
      const depthPx = height * DEPTH_STRETCH;

      const carScale = Math.max(4, Math.min(8, height / 58));
      const chickenScale = Math.max(3, Math.min(6, height / 100));
      const carLenPx = CAR_UNITS.len * carScale;
      const carWidthPx = CAR_UNITS.width * carScale;

      const chickenSprite = chickenSpriteRef.current;
      const spriteAspect = chickenSprite
        ? chickenSprite.width / chickenSprite.height
        : CHICKEN_UNITS.w / CHICKEN_UNITS.h;
      const chickenDrawH = Math.min(chickenScale * 11, (laneW * 0.82) / spriteAspect);
      const chickenDrawW = chickenDrawH * spriteAspect;
      const chickenBoxW = chickenDrawW * 0.6;
      const chickenBoxH = chickenDrawH * 0.6;
      geomRef.current = {
        carLen: carLenPx / depthPx,
        carHalf: carLenPx / depthPx / 2,
        chickenHalf: chickenBoxH / depthPx / 2,
      };

      const hop = hopRef.current;
      if (hop) {
        const t = Math.min(1, (now - hop.startedAt) / HOP_MS);
        const smooth = t * t * (3 - 2 * t);
        visualLaneRef.current = hop.from + (hop.to - hop.from) * smooth;
        if (t >= 1 && !doomedRef.current) hopRef.current = null;
      }
      const target = Math.max(0, visualLaneRef.current - 1.4);
      cameraRef.current += (target - cameraRef.current) * Math.min(1, dt * 7);
      const camera = cameraRef.current;
      const view = makeView(width, height, laneW, camera);
      viewRef.current = view;

      const laneCentre = (l: number) => (l + 0.5 - camera) * laneW;

      const farScale = view.scale(0);
      const uMin = view.vanishX - view.vanishX / farScale;
      const uMax = view.vanishX + (width - view.vanishX) / farScale;
      const roadEnd = lastLane(modeRef.current);
      const firstLane = Math.max(1, Math.floor(uMin / laneW + camera) - 1);
      const lastVisible = Math.min(roadEnd, Math.ceil(uMax / laneW + camera) + 1);

      stepTraffic(now, dt, firstLane, lastVisible);

      drawRoad(ctx, view, { firstLane: 1, lastLane: roadEnd });
      drawOverpass(ctx, view, LAYOUT.tunnelY, 'mouth');

      const settled = laneRef.current;
      const playing = phaseRef.current === 'PLAYING';
      const mode = modeRef.current;
      const coverR = Math.min(laneW * 0.34, 40);
      coverRadiusRef.current = coverR;
      coverLabelsRef.current = [];
      for (let l = firstLane; l <= lastVisible; l += 1) {
        const state: CoverState =
          l < settled ? 'cleared' : l === settled ? 'stand' : playing && l === settled + 1 ? 'next' : 'ahead';
        const multiplier = `${formatMultiplier(multiplierAt(l, mode))}x`;
        const chance = formatChance(cumulativeChanceAt(l, mode));
        const locked = l < unlockLane(mode);
        drawCover(
          ctx,
          view,
          laneCentre(l),
          LAYOUT.chickenY,
          coverR,
          state,
          multiplier,
          chance,
          reducedMotionRef.current ? 0 : now / 1000,
          locked
        );
        coverLabelsRef.current.push({ u: laneCentre(l), state, multiplier, chance, locked });
      }

      const closedOf = (l: number) => {
        const at = gateClosedAtRef.current.get(l);
        if (at === undefined) return 0;
        if (reducedMotionRef.current) return 1;
        const k = Math.min(1, (now - at) / 380);
        const c1 = 1.7;
        return 1 + (c1 + 1) * (k - 1) ** 3 + c1 * (k - 1) ** 2;
      };

      const hopAge = hop ? now - hop.startedAt : Infinity;
      const lift = hopAge < HOP_MS ? Math.sin((hopAge / HOP_MS) * Math.PI) * 18 : 0;
      const chickenU = laneCentre(visualLaneRef.current);
      const feet = view.project(chickenU, LAYOUT.chickenY);
      const chickenX = feet.x;
      const chickenY = feet.y - chickenDrawH * 0.45 - lift;

      const stage = stageRef.current;
      if (stage) {
        stage.style.setProperty('--chr-chick-x', `${chickenX.toFixed(1)}px`);
        stage.style.setProperty('--chr-chick-y', `${chickenY.toFixed(1)}px`);
      }

      const gateT = (l: number) => gateFraction(l);
      const lastBarrier = Math.min(lastVisible, settled + 1);
      for (let l = firstLane; l <= lastBarrier; l += 1) {
        drawBarrierShadow(ctx, view, l, gateT(l), closedOf(l));
      }
      const standing: Array<{ t: number; paint: () => void }> = [];
      const roadClipY = view.project(0, LAYOUT.tunnelY).y;
      const carClipY = overpassClipY(view, LAYOUT.tunnelY);
      const clipped = (fromY: number, paint: () => void) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-width, fromY, width * 3, height * 2);
        ctx.clip();
        paint();
        ctx.restore();
      };
      for (let l = firstLane - 1; l <= lastVisible + 1; l += 1) {
        const traffic = lanesRef.current.get(l);
        if (!traffic) continue;
        const cu = laneCentre(l);
        for (const car of traffic.cars) {
          clipped(roadClipY, () => drawCarShadow(ctx, view, cu, car.t, carScale));
          standing.push({
            t: car.t,
            paint: () => clipped(carClipY, () => drawCar3D(ctx, view, cu, car.t, carScale, car.colour)),
          });
        }
      }
      standing.push({ t: LAYOUT.tunnelY, paint: () => drawOverpass(ctx, view, LAYOUT.tunnelY, 'deck') });
      drawChickenShadow(ctx, view, chickenU, LAYOUT.chickenY, chickenDrawH, lift);

      for (let l = firstLane; l <= lastBarrier; l += 1) {
        standing.push({ t: gateT(l), paint: () => drawBarrier(ctx, view, l, gateT(l), closedOf(l)) });
      }
      standing.push({
        t: LAYOUT.chickenY,
        paint: () => drawChickenSmooth(ctx, chickenX, chickenY, chickenDrawH, now / 1000),
      });
      standing.sort((a, b) => a.t - b.t);
      for (const item of standing) item.paint();

      drawAtmosphere(ctx, view);

      const doomed = doomedRef.current;
      if (phaseRef.current === 'PLAYING' && doomed) {
        const traffic = lanesRef.current.get(doomed.lane);
        const car = traffic?.cars.find((c) => c.doomed);
        if (car && traffic) {
          const overlaps =
            Math.abs(laneCentre(doomed.lane) - chickenU) < (carWidthPx + chickenBoxW) / 2 &&
            Math.abs(car.t - LAYOUT.chickenY) * depthPx < (carLenPx + chickenBoxH) / 2;
          if (overlaps) crash();
        } else if (now > doomed.at + 500) {
          crash();
        }
      }

      if (crashAtRef.current !== null) {
        const age = now - crashAtRef.current;
        if (age < 700) {
          const t = age / 700;
          ctx.fillStyle = `rgba(239,68,68,${0.35 * (1 - t)})`;
          ctx.fillRect(0, 0, width, height);
          const at = view.project(laneCentre(0), LAYOUT.chickenY);
          ctx.beginPath();
          ctx.arc(at.x, at.y - chickenDrawH * 0.4, 12 + t * 70, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,220,180,${0.9 * (1 - t)})`;
          ctx.lineWidth = 5 * (1 - t) + 1;
          ctx.stroke();
        } else {
          crashAtRef.current = null;
        }
      }
    },
    [crash, stepTraffic]
  );

  const overlay = useCallback(({ ctx }: CanvasFrame) => {
    const view = viewRef.current;
    if (!view) return;
    for (const label of coverLabelsRef.current) {
      drawCoverLabels(
        ctx,
        view,
        label.u,
        LAYOUT.chickenY,
        coverRadiusRef.current,
        label.state,
        label.multiplier,
        label.chance,
        label.locked
      );
    }
  }, []);

  const canvasRef = useCanvasRenderer(draw, {
    maxPixelRatio: 2,
    pixelSize: PIXEL_SIZE,
    colorLevels: COLOR_LEVELS,
    overlay,
  });

  const canStep = isPlaying && !hopping && !busy;
  const unlockAt = unlockLane(mode);
  const cashLocked = lane < unlockAt;
  const canCash = isPlaying && !cashLocked && !hopping && !busy;
  const nextLane = lane < lastLane(mode) ? lane + 1 : 0;

  return (
    <div className="chr neu">
      <div
        className={`chr__stage${canStep ? ' chr__stage--tappable' : ''}`}
        ref={stageRef}
        onPointerUp={(event) => {
          if (event.pointerType !== 'mouse') advance();
        }}
      >
        <canvas ref={canvasRef} className="chr__canvas" />

        <div className="chr__hud">
          <span className="chr__chip">
            <i>{t('gameUi.chickenHudMultiplier')}</i>
            <b>{formatMultiplier(multiplier)}x</b>
          </span>
          <span className="chr__chip chr__chip--profit">
            <i>{t('gameUi.chickenHudProfit')}</i>
            <b>{money(lane === 0 ? 0 : payout - bet)}</b>
          </span>
        </div>

        <button
          type="button"
          className="chr__chick"
          onClick={advance}
          disabled={!canStep}
          aria-label={t('gameUi.chickenAria')}
        />
      </div>

      <div className="chr__panel">
        <div>
          <div className="chr__label">
            <span>{t('gameUi.chickenDifficulty')}</span>
            <b>{t('gameUi.chickenRiskOf', { name: t(`gameUi.chickenMode_${mode.id}`), percent: mode.label })}</b>
          </div>
          <div className="chr__modes" role="radiogroup" aria-label={t('gameUi.chickenDifficulty')}>
            {TRAFFIC_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                className={`chr__mode${m.id === mode.id ? ' chr__mode--on' : ''}`}
                disabled={isPlaying}
                aria-checked={m.id === mode.id}
                onClick={() => setMode(m)}
                title={t('gameUi.chickenRiskOf', { name: t(`gameUi.chickenMode_${m.id}`), percent: m.label })}
              >
                <span className="chr__mode-name">{t(`gameUi.chickenMode_${m.id}`)}</span>
                <span className="chr__mode-max">×{(1 / (1 - m.difficulty)).toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="chr__label" htmlFor="chr-bet">
            <span>{t('gameUi.betAmount')}</span>
            <b>{money(payout)}</b>
          </label>
          <div className="chr__bet">
            <div className="chr__field">
              <span className="chr__cur" aria-hidden="true">$</span>
              <input
                id="chr-bet"
                className="chr__input"
                type="number"
                inputMode="decimal"
                min={GAME_CONFIG.minBet}
                max={GAME_CONFIG.maxBet}
                step={1}
                value={Number.isFinite(bet) ? bet : ''}
                disabled={isPlaying}
                aria-invalid={betError !== null}
                onChange={(e) => setBet(Number(e.target.value))}
              />
            </div>
            <button
              type="button"
              className="chr__mod"
              disabled={isPlaying}
              aria-label={t('gameUi.halveBet')}
              onClick={() =>
                setBet((b) => Math.max(GAME_CONFIG.minBet, Number((b / 2).toFixed(2))))
              }
            >
              ½
            </button>
            <button
              type="button"
              className="chr__mod"
              disabled={isPlaying}
              aria-label={t('gameUi.doubleBet')}
              onClick={() => setBet((b) => Math.min(maxBet, Number((b * 2).toFixed(2))))}
            >
              2×
            </button>
          </div>
          <div className="chr__quick">
            {QUICK_BETS.map((amount) => (
              <button
                key={amount}
                type="button"
                disabled={isPlaying}
                aria-pressed={bet === amount}
                onClick={() => setBet(amount)}
              >
                {amount}
              </button>
            ))}
          </div>
        </div>

        <div className="chr__stats">
          <div className="chr__stat">
            <i>{t('gameUi.chickenNextLane')}</i>
            <b>{nextLane > 0 ? `×${formatMultiplier(multiplierAt(nextLane, mode))}` : '—'}</b>
            <small>
              {nextLane > 0
                ? t('gameUi.chickenSafe', { percent: formatChance(crossingChanceAt(nextLane, mode)) })
                : t('gameUi.chickenRoadEnd')}
            </small>
          </div>
          <div className="chr__stat chr__stat--gold">
            <i>{isPlaying && !cashLocked ? t('gameUi.chickenCashNow') : t('gameUi.chickenCashFrom')}</i>
            <b>
              {isPlaying && !cashLocked
                ? money(payout)
                : `×${formatMultiplier(multiplierAt(unlockAt, mode))}`}
            </b>
            <small>
              {isPlaying && !cashLocked
                ? `×${formatMultiplier(multiplier)}`
                : t('gameUi.chickenLaneN', { lane: unlockAt })}
            </small>
          </div>
        </div>

        {(serverError || (!isPlaying && betError)) && (
          <p className="chr__error" role="alert">
            {serverError ?? betError}
          </p>
        )}

        {phase === 'LOST' && (
          <div className="chr__banner chr__banner--lost" role="status">
            {t('gameUi.chickenHit')}
          </div>
        )}
        {phase === 'WON' && (
          <div className="chr__banner chr__banner--won" role="status">
            {t('gameUi.chickenCashedOut', {
              amount: `${GAME_CONFIG.currency}${formatDecimalString(lastWin ?? '0')}`,
            })}
          </div>
        )}

        {isPlaying ? (
          <div className="chr__actions">
            <button
              type="button"
              className="chr__action chr__action--go"
              onClick={advance}
              disabled={!canStep}
            >
              {t('gameUi.chickenGo')}
              <small>
                {nextLane > 0 ? `×${formatMultiplier(multiplierAt(nextLane, mode))}` : ''}
              </small>
            </button>
            <button
              type="button"
              className="chr__action chr__action--cash"
              onClick={cashOut}
              disabled={!canCash}
            >
              {cashLocked ? t('gameUi.chickenCashOutShort') : money(payout)}
              <small>
                {cashLocked
                  ? t('gameUi.chickenCashLocked', {
                      multiplier: `${formatMultiplier(multiplierAt(unlockAt, mode))}x`,
                    })
                  : t('gameUi.chickenCashOutShort')}
              </small>
            </button>
          </div>
        ) : (
          <div className="chr__actions">
            <button
              type="button"
              className="chr__action"
              onClick={startRound}
              disabled={betError !== null || busy}
            >
              {isOver ? t('gameUi.chickenPlayAgain') : t('gameUi.chickenStartRound')}
            </button>
          </div>
        )}

        <p className="chr__hint">
          {isPlaying ? t('gameUi.chickenHintPlaying') : t('gameUi.chickenHintIdle')}
        </p>
      </div>
    </div>
  );
}

