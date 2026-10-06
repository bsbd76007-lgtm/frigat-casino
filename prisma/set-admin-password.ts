/**
 * Sets the admin password — and nothing else. Safe to run against a live
 * database, unlike seed.ts, which also creates a funded test user.
 *
 *   DATABASE_URL='postgresql://…' ADMIN_PASSWORD='…' npx tsx prisma/set-admin-password.ts
 *
 * ADMIN_EMAIL defaults to admin@frigat.local. The account is created if it
 * does not exist, and every existing session for it is signed out.
 *
 * Raw SQL on purpose, touching only columns every migration level has: the
 * generated client selects every column in schema.prisma, so it fails against
 * a deployment whose database is a few migrations behind this checkout.
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@frigat.local').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!password || password.length < 8) {
    throw new Error('Set ADMIN_PASSWORD (at least 8 characters).');
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const updated = await prisma.$executeRaw`
    UPDATE "User"
       SET "passwordHash" = ${passwordHash},
           "role" = 'ADMIN'::"Role",
           "tokenVersion" = "tokenVersion" + 1
     WHERE "email" = ${email}`;

  if (updated === 0) {
    const id = `c${randomBytes(12).toString('hex')}`;
    const referralCode = `c${randomBytes(12).toString('hex')}`;
    await prisma.$executeRaw`
      INSERT INTO "User" ("id", "email", "passwordHash", "role", "referralCode")
      VALUES (${id}, ${email}, ${passwordHash}, 'ADMIN'::"Role", ${referralCode})`;
    console.log(`✅ Admin account created: ${email}`);
  } else {
    console.log(`✅ Admin password set for ${email}`);
  }
}

main()
  .catch((e) => {
    console.error('Failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
