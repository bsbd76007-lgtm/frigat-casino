/// <reference types="node" />

import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';

const prisma = new PrismaClient();

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

const MIN_SEED_PASSWORD_LENGTH = 16;

function requireSeedPassword(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Set a strong password in the environment before running the seed.`
    );
  }

  if (value.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(
      `${name} must be at least ${MIN_SEED_PASSWORD_LENGTH} characters long.`
    );
  }

  return value;
}

function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

function hashServerSeed(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@frigat.local';
  const adminPassword = requireSeedPassword('SEED_ADMIN_PASSWORD');
  const userEmail = process.env.SEED_USER_EMAIL ?? 'tester@frigat.local';
  const userPassword = requireSeedPassword('SEED_USER_PASSWORD');

  const adminHash = await argon2.hash(adminPassword, ARGON2_OPTS);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash: adminHash,
      role: Role.ADMIN,
    },
    create: {
      email: adminEmail,
      passwordHash: adminHash,
      role: Role.ADMIN,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: userEmail },
    update: {},
    create: {
      email: userEmail,
      passwordHash: await argon2.hash(userPassword, ARGON2_OPTS),
      role: Role.USER,
    },
  });

  await prisma.wallet.upsert({
    where: { userId_currency: { userId: user.id, currency: 'USD' } },
    update: {},
    create: {
      userId: user.id,
      currency: 'USD',
      balance: 1000,
    },
  });

  const existingSeed = await prisma.provableSeed.findFirst({
    where: { userId: user.id, active: true },
  });

  if (!existingSeed) {
    const serverSeed = generateServerSeed();
    await prisma.provableSeed.create({
      data: {
        userId: user.id,
        serverSeed,
        hashedServerSeed: hashServerSeed(serverSeed),
        clientSeed: randomBytes(8).toString('hex'),
        nonce: 0,
        active: true,
      },
    });
  }

  console.log('✅ Seed complete');
  console.log(`   Admin: ${admin.email}`);
  console.log(`   User:  ${user.email} (wallet: 1000 USD)`);
  console.log('   Seed passwords are supplied via environment variables and intentionally not printed.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
