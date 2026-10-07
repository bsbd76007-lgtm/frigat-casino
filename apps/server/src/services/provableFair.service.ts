import {
  generateServerSeed,
  hashServerSeed,
} from '@frigat/shared';
import { randomBytes } from 'crypto';
import { prisma } from '../config/prisma';
import { gameState } from '../websocket/gameState.store';
import type { SeedContext } from '../types/engine.types';

export async function getActiveSeed(userId: string) {
  const existing = await prisma.provableSeed.findFirst({
    where: { userId, active: true },
  });
  if (existing) return existing;

  const serverSeed = generateServerSeed();
  return prisma.provableSeed.create({
    data: {
      userId,
      serverSeed,
      hashedServerSeed: hashServerSeed(serverSeed),
      clientSeed: randomBytes(8).toString('hex'),
      nonce: 0,
    },
  });
}

function hasRoundInFlight(userId: string): boolean {
  if (gameState.getMines(userId)?.active) return true;
  const crash = gameState.getCrashBet(userId);
  return Boolean(crash && !crash.settled);
}

export async function nextSeedContext(userId: string): Promise<SeedContext> {
  const seed = await getActiveSeed(userId);

  const updated = await prisma.provableSeed.update({
    where: { id: seed.id },
    data: { nonce: { increment: 1 } },
    select: { serverSeed: true, clientSeed: true, nonce: true, hashedServerSeed: true },
  });

  return {
    serverSeed: updated.serverSeed,
    clientSeed: updated.clientSeed,
    nonce: updated.nonce - 1,
    hashedServerSeed: updated.hashedServerSeed,
  };
}

export const CLIENT_SEED_MIN_LENGTH = 4;
export const CLIENT_SEED_MAX_LENGTH = 128;

export class InvalidClientSeedError extends Error {
  constructor() {
    super(
      `clientSeed must be ${CLIENT_SEED_MIN_LENGTH}–${CLIENT_SEED_MAX_LENGTH} characters`
    );
    this.name = 'InvalidClientSeedError';
  }
}

export async function setClientSeed(userId: string, clientSeed: string) {
  if (
    !clientSeed ||
    clientSeed.length < CLIENT_SEED_MIN_LENGTH ||
    clientSeed.length > CLIENT_SEED_MAX_LENGTH
  ) {
    throw new InvalidClientSeedError();
  }
  return rotateSeed(userId, clientSeed);
}

export class SeedInUseError extends Error {
  constructor() {
    super('Finish or cash out your active game before rotating your seed');
    this.name = 'SeedInUseError';
  }
}

export async function rotateSeed(userId: string, clientSeed?: string) {
  if (hasRoundInFlight(userId)) throw new SeedInUseError();

  const serverSeed = generateServerSeed();

  return prisma.$transaction(async (tx) => {
    const revealed = await tx.provableSeed.findFirst({
      where: { userId, active: true },
      select: { serverSeed: true, hashedServerSeed: true, clientSeed: true, nonce: true },
    });

    await tx.provableSeed.updateMany({
      where: { userId, active: true },
      data: { active: false },
    });

    const active = await tx.provableSeed.create({
      data: {
        userId,
        serverSeed,
        hashedServerSeed: hashServerSeed(serverSeed),
        clientSeed: clientSeed ?? randomBytes(8).toString('hex'),
        nonce: 0,
      },
    });

    return { active, revealed };
  });
}
