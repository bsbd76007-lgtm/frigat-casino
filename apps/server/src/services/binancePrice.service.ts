const BINANCE_API_BASE = 'https://api.binance.com/api/v3/depth';
const REQUEST_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 5_000;

const SYMBOLS = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  LTC: 'LTCUSDT',
} as const;

export type BinanceAsset = keyof typeof SYMBOLS;
export interface BinanceAskLevel {
  price: string;
  quantity: string;
}

export class BinancePriceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BinancePriceError';
  }
}

const askCache = new Map<BinanceAsset, { asks: BinanceAskLevel[]; expiresAt: number }>();

export async function getBinanceUsdtAskBook(asset: BinanceAsset): Promise<BinanceAskLevel[]> {
  const cached = askCache.get(asset);
  if (cached && cached.expiresAt > Date.now()) return cached.asks;

  const symbol = SYMBOLS[asset];
  const url = new URL(BINANCE_API_BASE);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('limit', '100');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { accept: 'application/json' },
    });
  } catch (cause) {
    throw new BinancePriceError('Binance price quote request failed', { cause });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new BinancePriceError(`Binance price quote returned HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new BinancePriceError('Binance price quote returned invalid JSON', { cause });
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('asks' in payload) ||
    !Array.isArray(payload.asks) ||
    payload.asks.length === 0 ||
    payload.asks.length > 100
  ) {
    throw new BinancePriceError('Binance returned an invalid order book');
  }

  const asks: BinanceAskLevel[] = [];
  let previousPrice = 0;
  for (const level of payload.asks) {
    if (
      !Array.isArray(level) ||
      level.length < 2 ||
      typeof level[0] !== 'string' ||
      typeof level[1] !== 'string' ||
      level[0].length > 40 ||
      level[1].length > 40 ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(level[0]) ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(level[1]) ||
      !Number.isFinite(Number(level[0])) ||
      !Number.isFinite(Number(level[1])) ||
      Number(level[0]) <= 0 ||
      Number(level[1]) <= 0 ||
      Number(level[0]) < previousPrice
    ) {
      throw new BinancePriceError('Binance returned an invalid ask level');
    }
    previousPrice = Number(level[0]);
    asks.push({ price: level[0], quantity: level[1] });
  }

  askCache.set(asset, { asks, expiresAt: Date.now() + CACHE_TTL_MS });
  return asks;
}
