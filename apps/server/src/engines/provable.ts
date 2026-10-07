import { createHmac } from 'crypto';

const OUTCOME_HEX_CHARS = 13;
const OUTCOME_DIVISOR = Math.pow(2, 52);

export function floatAt(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor: number
): number {
  const hex = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}:${cursor}`)
    .digest('hex');
  return parseInt(hex.slice(0, OUTCOME_HEX_CHARS), 16) / OUTCOME_DIVISOR;
}

export function provableShuffle(
  n: number,
  serverSeed: string,
  clientSeed: string,
  nonce: number
): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const r = floatAt(serverSeed, clientSeed, nonce, n - 1 - i);
    const j = Math.floor(r * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
