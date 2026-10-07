import { createHash, createHmac, randomBytes } from 'crypto';

const OUTCOME_HEX_CHARS = 13;
const OUTCOME_DIVISOR = Math.pow(2, 52);

export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

export function hashServerSeed(serverSeed: string): string {
  return createHash('sha256').update(serverSeed, 'utf8').digest('hex');
}

export function calculateOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): number {
  if (!Number.isInteger(nonce) || nonce < 0) {
    throw new Error('nonce must be a non-negative integer');
  }

  const hmac = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');

  const slice = hmac.slice(0, OUTCOME_HEX_CHARS);
  return parseInt(slice, 16) / OUTCOME_DIVISOR;
}

export function verifySeedCommitment(
  revealedServerSeed: string,
  publishedHash: string
): boolean {
  return hashServerSeed(revealedServerSeed) === publishedHash;
}
