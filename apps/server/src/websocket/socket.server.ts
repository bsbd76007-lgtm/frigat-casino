import { AsyncLocalStorage } from 'async_hooks';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma';
import {
  INSTANT_ENGINES,
  isInstantGame,
  mines,
  chicken,
  avia,
} from '../engines';
import { AVIA } from '@frigat/shared';
import {
  processBet,
  processWin,
  getBalance,
  settleAffiliateReward,
  transferBetweenUsers,
  InsufficientFundsError,
  AccountFrozenError,
} from '../services/ledger.service';
import { nextSeedContext } from '../services/provableFair.service';
import { capPayout, MaintenanceModeError, BetLimitError } from '../services/riskConfig.service';
import {
  authenticateConnection,
  verifyConnection,
  AuthError,
  type AuthedIdentity,
} from './auth.middleware';
import { gameState, type ChickenState } from './gameState.store';
import { publicHandle } from '../routes/games/bets.routes';
import { CrashRoundManager, type CrashRound } from './crashRound.manager';
import { computeCrashPoint } from '../engines/crash.engine';
import type { ClientMessage, ServerMessage } from '../types/engine.types';

const D = Prisma.Decimal;

const sockets = new Set<WebSocket>();
const connectionMeta = new Map<WebSocket, {
  userId: string;
  username: string;
  role: 'USER' | 'ADMIN';
  rooms: Set<string>;
  alive: boolean;
  verified: boolean;
}>();

const HEARTBEAT_MS = 30_000;

const roomMembers = new Map<string, Set<WebSocket>>();

export function activeSocketCount(): number {
  let open = 0;
  for (const ws of sockets) if (ws.readyState === ws.OPEN) open += 1;
  return open;
}

export function onlinePlayerCount(): number {
  const players = new Set<string>();
  for (const [ws, meta] of connectionMeta) {
    if (ws.readyState === ws.OPEN) players.add(meta.userId);
  }
  return players.size;
}

function releaseSocket(ws: WebSocket) {
  sockets.delete(ws);
  leaveAllRooms(ws);
  connectionMeta.delete(ws);
}

export function pushSupportEvent(
  type: 'SUPPORT_MESSAGE' | 'SUPPORT_TICKET',
  data: Record<string, unknown>,
  ownerUserId?: string | null
) {
  const payload = JSON.stringify({ type, data });
  for (const [ws, meta] of connectionMeta) {
    if (ws.readyState !== ws.OPEN) continue;
    const isOwner = ownerUserId != null && meta.userId === ownerUserId;
    if (isOwner || meta.role === 'ADMIN') ws.send(payload);
  }
}

export function pushBalanceToUser(userId: string, balance: string) {
  const payload = JSON.stringify({ type: 'BALANCE', data: { balance } });
  for (const [ws, meta] of connectionMeta) {
    if (meta.userId === userId && ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function sendToUser(userId: string, msg: ServerMessage) {
  const payload = JSON.stringify(msg);
  for (const [ws, meta] of connectionMeta) {
    if (meta.userId === userId && ws.readyState === ws.OPEN) ws.send(payload);
  }
}
function broadcastAll(type: string, data: Record<string, unknown>) {
  const payload = JSON.stringify({ type, data });
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
function broadcastRoom(room: string, type: string, data: Record<string, unknown>) {
  const members = roomMembers.get(room);
  if (!members) return;
  const payload = JSON.stringify({ type, data });
  for (const ws of members) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
const frameGame = new AsyncLocalStorage<string>();

function fail(ws: WebSocket, message: string, code = 'BAD_REQUEST', gameType = frameGame.getStore()) {
  send(ws, { type: 'ERROR', data: { code, message, ...(gameType ? { gameType } : {}) } });
}

function joinRoom(ws: WebSocket, room: string) {
  room = String(room).toUpperCase();
  if (!roomMembers.has(room)) roomMembers.set(room, new Set());
  roomMembers.get(room)!.add(ws);
  const meta = connectionMeta.get(ws);
  if (meta) meta.rooms.add(room);
}

function leaveAllRooms(ws: WebSocket) {
  const meta = connectionMeta.get(ws);
  if (!meta) return;
  for (const room of meta.rooms) {
    const members = roomMembers.get(room);
    if (members) {
      members.delete(ws);
      if (members.size === 0) roomMembers.delete(room);
    }
  }
  meta.rooms.clear();
}

function chatPayload(data: Record<string, unknown>) {
  return {
    room: String(data.room ?? 'ENG').toUpperCase(),
    text: String(data.text ?? ''),
  };
}

function userLabel(email: string): string {
  const prefix = email.split('@')[0] || email;
  return prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'player';
}

const crashManager = new CrashRoundManager(
  (round) =>
    sendToUser(round.userId, {
      type: 'CRASH_TICK',
      data: { roundId: round.roundId, multiplier: round.currentMultiplier },
    }),
  (round) => settleCrashBust(round)
);

let logError: (obj: Record<string, unknown>, msg: string) => void = () => {};

function accrueAffiliate(input: {
  gameType: string;
  userId: string;
  betId: string;
  stake: string;
  payout?: string;
  currency?: string;
}) {
  void settleAffiliateReward(input).catch((err) => {
    logError(
      { err, userId: input.userId, betId: input.betId },
      'affiliate reward accrual failed'
    );
  });
}

async function payoutOf(
  gameType: string,
  betAmount: string,
  multiplier: number
): Promise<string> {
  const raw = new D(betAmount)
    .mul(new D(multiplier))
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
  const { payout } = await capPayout(gameType, raw);
  return payout.toString();
}

async function broadcastLiveBet(event: {
  userId: string;
  username: string;
  gameType: string;
  betAmount: string;
  multiplier: number;
  payout: string;
}) {
  broadcastAll('LIVE_BET', {
    ...event,
    timestamp: Date.now(),
  });
}

async function handleChat(ws: WebSocket, userId: string, username: string, payload: Record<string, unknown>) {
  const { room, text } = chatPayload(payload);
  if (!text.trim()) return;

  joinRoom(ws, room);

  if (text.startsWith('/tip ')) {
    const match = text.match(/^\/tip\s+@([A-Za-z0-9_-]+)\s+([0-9]*\.?[0-9]+)$/i);
    if (!match) {
      return send(ws, {
        type: 'CHAT_MESSAGE',
        data: {
          room,
          author: 'System',
          text: 'Usage: /tip @username amount',
          timestamp: Date.now(),
        },
      });
    }

    const targetUsername = match[1];
    const amount = match[2];

    const recipient = await prisma.user.findFirst({
      where: {
        email: {
          startsWith: `${targetUsername}@`,
          mode: 'insensitive',
        },
      },
      select: { id: true, email: true },
    });

    if (!recipient) {
      return send(ws, {
        type: 'CHAT_MESSAGE',
        data: {
          room,
          author: 'System',
          text: `User @${targetUsername} not found.`,
          timestamp: Date.now(),
        },
      });
    }

    if (recipient.id === userId) {
      return send(ws, {
        type: 'CHAT_MESSAGE',
        data: {
          room,
          author: 'System',
          text: 'You cannot tip yourself.',
          timestamp: Date.now(),
        },
      });
    }

    try {
      await transferBetweenUsers({
        fromUserId: userId,
        toUserId: recipient.id,
        amount,
      });
    } catch (err) {
      return send(ws, {
        type: 'CHAT_MESSAGE',
        data: {
          room,
          author: 'System',
          text:
            err instanceof InsufficientFundsError
              ? 'Insufficient funds for tip.'
              : 'Could not send tip.',
          timestamp: Date.now(),
        },
      });
    }

    const targetLabel = userLabel(recipient.email);
    const tipText = `${username} tipped @${targetLabel} ${amount}`;
    return broadcastRoom(room, 'CHAT_MESSAGE', {
      room,
      author: 'System',
      text: tipText,
      timestamp: Date.now(),
    });
  }

  broadcastRoom(room, 'CHAT_MESSAGE', {
    room,
    author: username,
    text,
    timestamp: Date.now(),
  });
}

async function handleInstantBet(
  ws: WebSocket,
  userId: string,
  gameType: string,
  payload: Record<string, unknown>
) {
  const amount = String(payload.amount ?? '');
  const currency = String(payload.currency ?? 'USD');
  let params = (payload.params as Record<string, unknown>) ?? payload;

  let charged = amount;

  if (gameType === 'AVIA') {
    const mode = params.mode ?? 'fast';
    if (!avia.isAviaMode(mode)) return fail(ws, `Unknown Avia mode: ${String(mode)}`, 'BAD_REQUEST');
    const safe = params.safe === true;
    if (safe) {
      const cap = avia.safeLandingMaxStake(mode);
      let stake: Prisma.Decimal;
      try {
        stake = new D(amount);
      } catch {
        return fail(ws, 'Invalid bet amount', 'BAD_REQUEST');
      }
      if (stake.gt(cap)) {
        return fail(
          ws,
          `Safe landing covers bets up to $${cap.toFixed(2)} at this speed`,
          'SAFE_LANDING_LIMIT'
        );
      }
      charged = stake.plus(AVIA.safeLanding.fee).toFixed(2);
    }
    params = { mode, safe };
  }

  const bet = await processBet({ userId, amount: charged, gameType, currency });

  const seed = await nextSeedContext(userId);
  const engine = INSTANT_ENGINES[gameType as keyof typeof INSTANT_ENGINES];
  const result = engine(params, seed);

  let balance = bet.balance;
  let payout = '0';
  if (result.multiplier > 0) {
    payout = await payoutOf(gameType, amount, result.multiplier);
    const credited = await processWin({
      userId,
      betId: bet.transactionId,
      payoutAmount: payout,
      currency,
    });
    balance = credited.balance;
  }

  accrueAffiliate({ gameType: gameType, userId, betId: bet.transactionId, stake: charged, payout, currency });

  const session = await prisma.gameSession.create({
    data: {
      userId,
      gameType: gameType as any,
      betAmount: new D(charged),
      payout: new D(payout),
      multiplier: result.multiplier,
      serverSeed: seed.serverSeed,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
      resultData: result.resultData as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  send(ws, {
    type: 'GAME_RESULT',
    data: {
      sessionId: session.id,
      gameType,
      betAmount: charged,
      payout,
      multiplier: result.multiplier,
      win: result.win,
      resultData: result.resultData,
      hashedServerSeed: seed.hashedServerSeed,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
      balance,
    },
  });
  send(ws, { type: 'BALANCE', data: { balance } });

  const meta = [...connectionMeta.values()].find((m) => m.userId === userId);
  await broadcastLiveBet({
    userId,
    username: meta?.username ?? 'player',
    gameType,
    betAmount: charged,
    multiplier: result.multiplier,
    payout,
  });
}

async function handleMinesStart(
  ws: WebSocket,
  userId: string,
  payload: Record<string, unknown>
) {
  if (gameState.getMines(userId)?.active) {
    return fail(ws, 'You already have an active mines game', 'GAME_IN_PROGRESS');
  }

  const amount = String(payload.amount ?? '');
  const currency = String(payload.currency ?? 'USD');
  const minesCount = Number((payload.params as any)?.minesCount ?? payload.minesCount);

  try {
    mines.assertValidMinesCount(minesCount);
  } catch (err) {
    return fail(ws, err instanceof Error ? err.message : 'Invalid mines count', 'BAD_PARAMS');
  }

  const bet = await processBet({ userId, amount, gameType: 'MINES', currency });
  const seed = await nextSeedContext(userId);
  const layout = mines.generateLayout(minesCount, seed);

  gameState.setMines({
    userId,
    betTransactionId: bet.transactionId,
    betAmount: amount,
    currency,
    layout,
    seed,
    revealed: [],
    active: true,
  });

  send(ws, {
    type: 'BET_ACCEPTED',
    data: {
      gameType: 'MINES',
      minesCount,
      gridSize: 25,
      hashedServerSeed: seed.hashedServerSeed,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
      balance: bet.balance,
    },
  });
  send(ws, { type: 'BALANCE', data: { balance: bet.balance } });
}

async function handleMinesReveal(
  ws: WebSocket,
  userId: string,
  payload: Record<string, unknown>
) {
  const state = gameState.getMines(userId);
  if (!state || !state.active) {
    return fail(ws, 'No active mines game', 'NO_ACTIVE_GAME');
  }

  const tile = Number(payload.tile);
  if (state.revealed.includes(tile)) {
    return fail(ws, 'Tile already revealed', 'ALREADY_REVEALED');
  }

  if (mines.isMine(state.layout, tile)) {
    state.active = false;
    gameState.clearMines(userId);

    accrueAffiliate({ gameType: 'MINES',
      userId,
      betId: state.betTransactionId,
      stake: state.betAmount,
      currency: state.currency,
    });

    await prisma.gameSession.create({
      data: {
        userId,
        gameType: 'MINES',
        betAmount: new D(state.betAmount),
        payout: new D(0),
        multiplier: 0,
        serverSeed: state.seed.serverSeed,
        clientSeed: state.seed.clientSeed,
        nonce: state.seed.nonce,
        resultData: {
          bust: true,
          hitTile: tile,
          minePositions: state.layout.minePositions,
        } as Prisma.InputJsonValue,
      },
    });

    const balance = await getBalance(userId, state.currency);
    return send(ws, {
      type: 'GAME_RESULT',
      data: {
        gameType: 'MINES',
        win: false,
        bust: true,
        hitTile: tile,
        minePositions: state.layout.minePositions,
        payout: '0',
        multiplier: 0,
        balance,
      },
    });
  }

  state.revealed.push(tile);
  const multiplier = mines.multiplierAfter(
    state.layout.minesCount,
    state.revealed.length
  );
  const potentialPayout = await payoutOf('MINES', state.betAmount, multiplier);

  send(ws, {
    type: 'STATE_UPDATE',
    data: {
      gameType: 'MINES',
      revealedTile: tile,
      revealedCount: state.revealed.length,
      multiplier,
      potentialPayout,
    },
  });
}

async function handleMinesCashout(
  ws: WebSocket,
  userId: string,
  _payload: Record<string, unknown>
) {
  const state = gameState.getMines(userId);
  if (!state || !state.active) {
    return fail(ws, 'No active mines game', 'NO_ACTIVE_GAME');
  }
  if (state.revealed.length === 0) {
    return fail(ws, 'Reveal at least one tile before cashing out', 'NOTHING_REVEALED');
  }

  const multiplier = mines.multiplierAfter(
    state.layout.minesCount,
    state.revealed.length
  );
  const payout = await payoutOf('MINES', state.betAmount, multiplier);

  const credited = await processWin({
    userId,
    betId: state.betTransactionId,
    payoutAmount: payout,
    currency: state.currency,
  });

  state.active = false;
  gameState.clearMines(userId);

  accrueAffiliate({ gameType: 'MINES',
    userId,
    betId: state.betTransactionId,
    stake: state.betAmount,
    payout,
    currency: state.currency,
  });

  await prisma.gameSession.create({
    data: {
      userId,
      gameType: 'MINES',
      betAmount: new D(state.betAmount),
      payout: new D(payout),
      multiplier,
      serverSeed: state.seed.serverSeed,
      clientSeed: state.seed.clientSeed,
      nonce: state.seed.nonce,
      resultData: {
        cashout: true,
        revealed: state.revealed,
        minePositions: state.layout.minePositions,
      } as Prisma.InputJsonValue,
    },
  });

  send(ws, {
    type: 'GAME_RESULT',
    data: {
      gameType: 'MINES',
      win: true,
      multiplier,
      payout,
      revealed: state.revealed,
      minePositions: state.layout.minePositions,
      balance: credited.balance,
    },
  });
  send(ws, { type: 'BALANCE', data: { balance: credited.balance } });

  const meta = connectionMeta.get(ws);
  await broadcastLiveBet({
    userId: state.userId,
    username: meta?.username ?? 'player',
    gameType: 'MINES',
    betAmount: state.betAmount,
    multiplier,
    payout,
  });
}

async function handleMinesResume(ws: WebSocket, userId: string) {
  const state = gameState.getMines(userId);
  if (!state || !state.active) {
    return send(ws, { type: 'RESUME_NONE', data: { gameType: 'MINES' } });
  }
  const multiplier = mines.multiplierAfter(state.layout.minesCount, state.revealed.length);
  const potentialPayout =
    state.revealed.length > 0 ? await payoutOf('MINES', state.betAmount, multiplier) : null;
  send(ws, {
    type: 'BET_ACCEPTED',
    data: {
      gameType: 'MINES',
      resumed: true,
      amount: state.betAmount,
      minesCount: state.layout.minesCount,
      gridSize: 25,
      revealed: state.revealed,
      multiplier,
      potentialPayout,
      hashedServerSeed: state.seed.hashedServerSeed,
      clientSeed: state.seed.clientSeed,
      nonce: state.seed.nonce,
    },
  });
}

const chickenStartsInFlight = new Set<string>();

async function handleChickenStart(
  ws: WebSocket,
  userId: string,
  payload: Record<string, unknown>
) {
  if (gameState.getChicken(userId)?.active || chickenStartsInFlight.has(userId)) {
    return fail(ws, 'You already have a chicken round running', 'GAME_IN_PROGRESS');
  }

  const amount = String(payload.amount ?? '');
  const currency = String(payload.currency ?? 'USD');
  const params = (payload.params ?? {}) as Record<string, unknown>;
  const mode = params.mode;

  if (!chicken.isChickenMode(mode)) {
    return fail(ws, 'Unknown traffic mode', 'BAD_PARAMS');
  }

  chickenStartsInFlight.add(userId);
  try {
    const bet = await processBet({ userId, amount, gameType: 'CHICKEN', currency });
    const seed = await nextSeedContext(userId);
    const maxLanes = chicken.maxLanes(mode);

    gameState.setChicken({
      userId,
      betTransactionId: bet.transactionId,
      betAmount: amount,
      currency,
      mode,
      seed,
      lane: 0,
      maxLanes,
      bustLane: chicken.bustLane(mode, seed),
      active: true,
    });

    send(ws, {
      type: 'BET_ACCEPTED',
      data: {
        gameType: 'CHICKEN',
        mode,
        maxLanes,
        hashedServerSeed: seed.hashedServerSeed,
        clientSeed: seed.clientSeed,
        nonce: seed.nonce,
        balance: bet.balance,
      },
    });
    send(ws, { type: 'BALANCE', data: { balance: bet.balance } });
  } finally {
    chickenStartsInFlight.delete(userId);
  }
}

async function handleChickenStep(ws: WebSocket, userId: string) {
  const state = gameState.getChicken(userId);
  if (!state || !state.active) {
    return fail(ws, 'No active chicken round', 'NO_ACTIVE_GAME');
  }

  const lane = state.lane + 1;

  if (state.bustLane === lane) {
    state.active = false;
    gameState.clearChicken(userId);

    accrueAffiliate({ gameType: 'CHICKEN',
      userId,
      betId: state.betTransactionId,
      stake: state.betAmount,
      currency: state.currency,
    });

    await prisma.gameSession.create({
      data: {
        userId,
        gameType: 'CHICKEN',
        betAmount: new D(state.betAmount),
        payout: new D(0),
        multiplier: 0,
        serverSeed: state.seed.serverSeed,
        clientSeed: state.seed.clientSeed,
        nonce: state.seed.nonce,
        resultData: {
          bust: true,
          mode: state.mode,
          bustLane: lane,
          lanesCleared: state.lane,
        } as Prisma.InputJsonValue,
      },
    });

    const balance = await getBalance(userId, state.currency);
    return send(ws, {
      type: 'GAME_RESULT',
      data: {
        gameType: 'CHICKEN',
        win: false,
        bust: true,
        lane,
        bustLane: lane,
        payout: '0',
        multiplier: 0,
        balance,
      },
    });
  }

  state.lane = lane;

  if (lane >= state.maxLanes) {
    return settleChickenCashout(ws, state, true);
  }

  const multiplier = chicken.multiplierAt(state.mode, lane);
  const potentialPayout = await payoutOf('CHICKEN', state.betAmount, multiplier);

  send(ws, {
    type: 'STATE_UPDATE',
    data: { gameType: 'CHICKEN', lane, multiplier, potentialPayout },
  });
}

function handleChickenResume(ws: WebSocket, userId: string) {
  const state = gameState.getChicken(userId);
  if (!state || !state.active) {
    return send(ws, { type: 'RESUME_NONE', data: { gameType: 'CHICKEN' } });
  }
  send(ws, {
    type: 'BET_ACCEPTED',
    data: {
      gameType: 'CHICKEN',
      resumed: true,
      amount: state.betAmount,
      mode: state.mode,
      lane: state.lane,
      maxLanes: state.maxLanes,
      multiplier: chicken.multiplierAt(state.mode, state.lane),
      hashedServerSeed: state.seed.hashedServerSeed,
      clientSeed: state.seed.clientSeed,
      nonce: state.seed.nonce,
    },
  });
}

async function handleChickenCashout(ws: WebSocket, userId: string) {
  const state = gameState.getChicken(userId);
  if (!state || !state.active) {
    return fail(ws, 'No active chicken round', 'NO_ACTIVE_GAME');
  }
  const unlocksAt = chicken.minCashoutLane(state.mode);
  if (state.lane < unlocksAt) {
    return fail(
      ws,
      `Cash out unlocks at lane ${unlocksAt} (${chicken.multiplierAt(state.mode, unlocksAt)}x)`,
      'CASHOUT_LOCKED'
    );
  }
  return settleChickenCashout(ws, state, false);
}

async function settleChickenCashout(ws: WebSocket, state: ChickenState, auto: boolean) {
  state.active = false;

  const multiplier = chicken.multiplierAt(state.mode, state.lane);
  let payout: string;
  let credited: { balance: string };
  try {
    payout = await payoutOf('CHICKEN', state.betAmount, multiplier);
    credited = await processWin({
      userId: state.userId,
      betId: state.betTransactionId,
      payoutAmount: payout,
      currency: state.currency,
    });
  } catch (err) {
    state.active = true;
    throw err;
  }
  gameState.clearChicken(state.userId);

  accrueAffiliate({ gameType: 'CHICKEN',
    userId: state.userId,
    betId: state.betTransactionId,
    stake: state.betAmount,
    payout,
    currency: state.currency,
  });

  await prisma.gameSession.create({
    data: {
      userId: state.userId,
      gameType: 'CHICKEN',
      betAmount: new D(state.betAmount),
      payout: new D(payout),
      multiplier,
      serverSeed: state.seed.serverSeed,
      clientSeed: state.seed.clientSeed,
      nonce: state.seed.nonce,
      resultData: {
        cashout: true,
        auto,
        mode: state.mode,
        lanesCleared: state.lane,
        bustLane: state.bustLane,
      } as Prisma.InputJsonValue,
    },
  });

  send(ws, {
    type: 'GAME_RESULT',
    data: {
      gameType: 'CHICKEN',
      win: true,
      auto,
      lane: state.lane,
      bustLane: state.bustLane,
      multiplier,
      payout,
      balance: credited.balance,
    },
  });
  send(ws, { type: 'BALANCE', data: { balance: credited.balance } });

  const meta = connectionMeta.get(ws);
  await broadcastLiveBet({
    userId: state.userId,
    username: meta?.username ?? 'player',
    gameType: 'CHICKEN',
    betAmount: state.betAmount,
    multiplier,
    payout,
  });
}

const crashBetsInFlight = new Set<string>();

async function handleCrashBet(
  ws: WebSocket,
  userId: string,
  payload: Record<string, unknown>
) {
  if (crashBetsInFlight.has(userId)) {
    return fail(ws, 'Your bet is already being placed', 'BET_IN_FLIGHT');
  }
  if (crashManager.isRunning(userId)) {
    return fail(ws, 'Your round is still running', 'ROUND_IN_PROGRESS');
  }
  const previous = gameState.getCrashBet(userId);
  if (previous && !previous.settled) {
    return fail(ws, 'Your last bet is still settling', 'ALREADY_BET');
  }

  const amount = String(payload.amount ?? '');
  const currency = String(payload.currency ?? 'USD');

  crashBetsInFlight.add(userId);
  try {
    const bet = await processBet({ userId, amount, gameType: 'CRASH', currency });

    const seed = await nextSeedContext(userId);
    const crashPoint = computeCrashPoint(seed);

    gameState.addCrashBet({
      userId,
      betTransactionId: bet.transactionId,
      amount,
      currency,
      settled: false,
    });

    const round = crashManager.start(userId, seed, crashPoint);

    send(ws, {
      type: 'BET_ACCEPTED',
      data: {
        gameType: 'CRASH',
        amount,
        balance: bet.balance,
        roundId: round.roundId,
        hashedServerSeed: seed.hashedServerSeed,
        clientSeed: seed.clientSeed,
        nonce: seed.nonce,
      },
    });
    send(ws, { type: 'BALANCE', data: { balance: bet.balance } });

    sendToUser(userId, {
      type: 'CRASH_ROUND_START',
      data: {
        roundId: round.roundId,
        phase: 'RUNNING',
        hashedServerSeed: seed.hashedServerSeed,
        clientSeed: seed.clientSeed,
        nonce: seed.nonce,
      },
    });
  } finally {
    crashBetsInFlight.delete(userId);
  }
}

function handleCrashResume(ws: WebSocket, userId: string) {
  const round = crashManager.get(userId);
  const bet = gameState.getCrashBet(userId);

  if (!round || !bet || bet.settled) {
    return send(ws, { type: 'RESUME_NONE', data: { gameType: 'CRASH' } });
  }

  send(ws, {
    type: 'BET_ACCEPTED',
    data: {
      gameType: 'CRASH',
      amount: bet.amount,
      roundId: round.roundId,
      hashedServerSeed: round.seed.hashedServerSeed,
      clientSeed: round.seed.clientSeed,
      nonce: round.seed.nonce,
      resumed: true,
    },
  });

  send(ws, {
    type: 'CRASH_ROUND_START',
    data: {
      roundId: round.roundId,
      phase: 'RUNNING',
      hashedServerSeed: round.seed.hashedServerSeed,
      clientSeed: round.seed.clientSeed,
      nonce: round.seed.nonce,
      resumed: true,
    },
  });

  send(ws, {
    type: 'CRASH_TICK',
    data: {
      roundId: round.roundId,
      multiplier: crashManager.liveMultiplier(userId),
    },
  });
}

async function handleCrashCashout(ws: WebSocket, userId: string) {
  const bet = gameState.getCrashBet(userId);
  if (!bet || bet.settled) {
    return fail(ws, 'No active crash bet', 'NO_ACTIVE_BET');
  }

  const round = crashManager.get(userId);
  if (!round) {
    return fail(ws, 'Round is not running', 'NOT_RUNNING');
  }

  const multiplier = crashManager.liveMultiplier(userId);
  if (multiplier >= round.crashPoint) {
    return fail(ws, 'Too late — already crashed', 'ALREADY_CRASHED');
  }

  crashManager.end(userId);
  bet.cashedOutAt = multiplier;
  bet.settled = true;

  sendToUser(userId, {
    type: 'CRASH_ROUND_END',
    data: {
      roundId: round.roundId,
      cashedOut: true,
      multiplier,
      crashPoint: round.crashPoint,
    },
  });

  const payout = await payoutOf('CRASH', bet.amount, multiplier);
  const credited = await processWin({
    userId,
    betId: bet.betTransactionId,
    payoutAmount: payout,
    currency: bet.currency,
  });

  gameState.clearCrashBet(userId);

  accrueAffiliate({ gameType: 'CRASH',
    userId,
    betId: bet.betTransactionId,
    stake: bet.amount,
    payout,
    currency: bet.currency,
  });

  await recordCrashSession({
    round,
    betAmount: bet.amount,
    payout,
    multiplier,
    cashout: true,
  });

  send(ws, {
    type: 'GAME_RESULT',
    data: {
      gameType: 'CRASH',
      win: true,
      multiplier,
      payout,
      balance: credited.balance,
    },
  });
  send(ws, { type: 'BALANCE', data: { balance: credited.balance } });

  const meta = connectionMeta.get(ws);
  await broadcastLiveBet({
    userId: userId,
    username: meta?.username ?? 'player',
    gameType: 'CRASH',
    betAmount: bet.amount,
    multiplier,
    payout,
  });
}

async function settleCrashBust(round: CrashRound) {
  const { userId } = round;
  const bet = gameState.getCrashBet(userId);
  if (!bet || bet.settled) return;

  bet.settled = true;
  gameState.clearCrashBet(userId);

  sendToUser(userId, {
    type: 'CRASH_ROUND_END',
    data: {
      roundId: round.roundId,
      cashedOut: false,
      crashPoint: round.crashPoint,
    },
  });

  const balance = await getBalance(userId, bet.currency);
  sendToUser(userId, {
    type: 'GAME_RESULT',
    data: {
      gameType: 'CRASH',
      win: false,
      multiplier: 0,
      crashPoint: round.crashPoint,
      payout: '0',
      balance,
    },
  });

  accrueAffiliate({ gameType: 'CRASH',
    userId,
    betId: bet.betTransactionId,
    stake: bet.amount,
    currency: bet.currency,
  });

  await recordCrashSession({
    round,
    betAmount: bet.amount,
    payout: '0',
    multiplier: round.crashPoint,
    cashout: false,
  });
}

async function recordCrashSession(input: {
  round: CrashRound;
  betAmount: string;
  payout: string;
  multiplier: number;
  cashout: boolean;
}) {
  const { round } = input;
  await prisma.gameSession.create({
    data: {
      userId: round.userId,
      gameType: 'CRASH',
      betAmount: new D(input.betAmount),
      payout: new D(input.payout),
      multiplier: input.multiplier,
      serverSeed: round.seed.serverSeed,
      clientSeed: round.seed.clientSeed,
      nonce: round.seed.nonce,
      resultData: {
        cashout: input.cashout,
        crashPoint: round.crashPoint,
        roundId: round.roundId,
      } as Prisma.InputJsonValue,
    },
  });
}

async function route(ws: WebSocket, userId: string, msg: ClientMessage, username = 'player') {
  const { type, gameType, payload = {} } = msg;
  const actualGameType = typeof gameType === 'string' ? gameType : '';

  switch (type) {
    case 'BET':
    case 'SPIN':
      if (!actualGameType) return fail(ws, `${type} requires a gameType`, 'BAD_REQUEST');
      if (actualGameType === 'MINES') return handleMinesStart(ws, userId, payload);
      if (actualGameType === 'CHICKEN') return handleChickenStart(ws, userId, payload);
      if (actualGameType === 'CRASH') return handleCrashBet(ws, userId, payload);
      if (isInstantGame(actualGameType)) return handleInstantBet(ws, userId, actualGameType, payload);
      return fail(ws, `Unsupported game for ${type}: ${actualGameType}`);

    case 'REVEAL_TILE':
      if (gameType !== 'MINES') return fail(ws, 'REVEAL_TILE is only valid for MINES');
      return handleMinesReveal(ws, userId, payload);

    case 'STEP':
      if (gameType !== 'CHICKEN') return fail(ws, 'STEP is only valid for CHICKEN');
      return handleChickenStep(ws, userId);

    case 'RESUME':
      if (gameType === 'CRASH') return handleCrashResume(ws, userId);
      if (gameType === 'CHICKEN') return handleChickenResume(ws, userId);
      if (gameType === 'MINES') return handleMinesResume(ws, userId);
      return fail(ws, `RESUME is not supported for ${gameType}`);

    case 'CHAT':
      return handleChat(ws, userId, username, payload);

    case 'CASHOUT':
      if (gameType === 'MINES') return handleMinesCashout(ws, userId, payload);
      if (gameType === 'CRASH') return handleCrashCashout(ws, userId);
      if (gameType === 'CHICKEN') return handleChickenCashout(ws, userId);
      return fail(ws, `CASHOUT not supported for ${gameType}`);

    default:
      return fail(ws, `Unknown action type: ${type}`);
  }
}

export function registerSocketServer(app: FastifyInstance) {
  logError = (obj, msg) => app.log.error(obj, msg);

  app.get('/ws', { websocket: true }, (socket, req) => {
    const ws = socket as unknown as WebSocket;

    let identity: AuthedIdentity;
    try {
      identity = authenticateConnection(req.raw);
    } catch (err) {
      const message = err instanceof AuthError ? err.message : 'Unauthorized';
      send(ws, { type: 'ERROR', data: { code: 'UNAUTHORIZED', message } });
      ws.close(1008, message);
      return;
    }

    sockets.add(ws);
    connectionMeta.set(ws, {
      userId: identity.userId,
      username: publicHandle(identity.userId),
      role: 'USER',
      rooms: new Set(),
      alive: true,
      verified: false,
    });

    ws.on('pong', () => {
      const meta = connectionMeta.get(ws);
      if (meta) meta.alive = true;
    });

    ws.on('error', () => releaseSocket(ws));

    verifyConnection(identity)
      .then((account) => {
        const meta = connectionMeta.get(ws);
        if (!meta) return;
        meta.role = account.role;
        meta.username = account.email ? userLabel(account.email) : meta.username;
        meta.verified = true;
      })
      .catch((err) => {
        const message = err instanceof AuthError ? err.message : 'Unauthorized';
        const code = message === 'Account is frozen' ? 'ACCOUNT_FROZEN' : 'UNAUTHORIZED';
        send(ws, { type: 'ERROR', data: { code, message } });
        ws.close(1008, message);
      });

    getBalance(identity.userId)
      .then((balance) => send(ws, { type: 'BALANCE', data: { balance } }))
      .catch(() => void 0);

    ws.on('message', async (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return fail(ws, 'Malformed JSON', 'BAD_JSON');
      }

      const handle = async () => {
        try {
          const meta = connectionMeta.get(ws);
          if (!meta?.verified) {
            return fail(ws, 'Connection is still authenticating', 'NOT_READY');
          }
          const username = meta.username ?? 'player';
          await route(ws, identity.userId, msg, username);
        } catch (err) {
          if (err instanceof InsufficientFundsError) {
            return fail(ws, 'Insufficient funds', 'INSUFFICIENT_FUNDS');
          }
          if (err instanceof AccountFrozenError) {
            return fail(ws, 'Account is frozen', 'ACCOUNT_FROZEN');
          }
          if (err instanceof MaintenanceModeError) {
            return fail(ws, err.message, 'MAINTENANCE_MODE');
          }
          if (err instanceof BetLimitError) {
            return fail(ws, err.message, 'BET_LIMIT');
          }
          const message = err instanceof Error ? err.message : 'Internal error';
          app.log.error({ err, userId: identity.userId }, 'socket handler error');
          return fail(ws, message, 'HANDLER_ERROR');
        }
      };
      return typeof msg.gameType === 'string' ? frameGame.run(msg.gameType, handle) : handle();
    });

    ws.on('close', () => releaseSocket(ws));
  });

  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      const meta = connectionMeta.get(ws);
      if (!meta || ws.readyState !== ws.OPEN) {
        releaseSocket(ws);
        continue;
      }
      if (!meta.alive) {
        releaseSocket(ws);
        ws.terminate();
        continue;
      }
      meta.alive = false;
      try {
        ws.ping();
      } catch {
        releaseSocket(ws);
        ws.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    crashManager.stopAll();
  });
}
