const BASE58 = '[1-9A-HJ-NP-Za-km-z]';

export interface CryptoCurrencySpec {
  code: string;
  label: string;
  network: string;
  payoutDecimals: number;
  binanceSymbol: string | null;
  nowPaymentsCode: string;
  cryptomusNetwork: string | null;
  uriScheme: string | null;
  address: RegExp;
}

export const CRYPTO_CURRENCIES = [
  {
    code: 'USDT',
    label: 'Tether',
    network: 'TRC-20',
    payoutDecimals: 6,
    binanceSymbol: null,
    nowPaymentsCode: 'usdttrc20',
    cryptomusNetwork: 'tron',
    uriScheme: null,
    address: new RegExp(`^T${BASE58}{33}$`),
  },
  {
    code: 'BTC',
    label: 'Bitcoin',
    network: 'Bitcoin',
    payoutDecimals: 8,
    binanceSymbol: 'BTCUSDT',
    nowPaymentsCode: 'btc',
    cryptomusNetwork: null,
    uriScheme: 'bitcoin',
    address: new RegExp(`^(bc1[02-9ac-hj-np-z]{11,71}|BC1[02-9AC-HJ-NP-Z]{11,71}|[13]${BASE58}{25,34})$`),
  },
  {
    code: 'ETH',
    label: 'Ethereum',
    network: 'ERC-20',
    payoutDecimals: 8,
    binanceSymbol: 'ETHUSDT',
    nowPaymentsCode: 'eth',
    cryptomusNetwork: null,
    uriScheme: null,
    address: /^0x[0-9a-fA-F]{40}$/,
  },
  {
    code: 'LTC',
    label: 'Litecoin',
    network: 'Litecoin',
    payoutDecimals: 8,
    binanceSymbol: 'LTCUSDT',
    nowPaymentsCode: 'ltc',
    cryptomusNetwork: null,
    uriScheme: 'litecoin',
    address: new RegExp(`^(ltc1[02-9ac-hj-np-z]{11,71}|[LM3]${BASE58}{26,33})$`),
  },
  {
    code: 'USDC',
    label: 'USD Coin',
    network: 'ERC-20',
    payoutDecimals: 6,
    binanceSymbol: 'USDCUSDT',
    nowPaymentsCode: 'usdc',
    cryptomusNetwork: 'eth',
    uriScheme: null,
    address: /^0x[0-9a-fA-F]{40}$/,
  },
  {
    code: 'SOL',
    label: 'Solana',
    network: 'Solana',
    payoutDecimals: 8,
    binanceSymbol: 'SOLUSDT',
    nowPaymentsCode: 'sol',
    cryptomusNetwork: 'sol',
    uriScheme: 'solana',
    address: new RegExp(`^${BASE58}{32,44}$`),
  },
  {
    code: 'TRX',
    label: 'TRON',
    network: 'TRON',
    payoutDecimals: 6,
    binanceSymbol: 'TRXUSDT',
    nowPaymentsCode: 'trx',
    cryptomusNetwork: 'tron',
    uriScheme: null,
    address: new RegExp(`^T${BASE58}{33}$`),
  },
  {
    code: 'BNB',
    label: 'BNB',
    network: 'BEP-20',
    payoutDecimals: 8,
    binanceSymbol: 'BNBUSDT',
    nowPaymentsCode: 'bnbbsc',
    cryptomusNetwork: 'bsc',
    uriScheme: null,
    address: /^0x[0-9a-fA-F]{40}$/,
  },
  {
    code: 'DOGE',
    label: 'Dogecoin',
    network: 'Dogecoin',
    payoutDecimals: 8,
    binanceSymbol: 'DOGEUSDT',
    nowPaymentsCode: 'doge',
    cryptomusNetwork: null,
    uriScheme: 'dogecoin',
    address: new RegExp(`^[DA9]${BASE58}{33}$`),
  },
] as const satisfies readonly CryptoCurrencySpec[];

export type CryptoCurrencyCode = (typeof CRYPTO_CURRENCIES)[number]['code'];

export const CRYPTO_CODES = CRYPTO_CURRENCIES.map((c) => c.code) as CryptoCurrencyCode[];

export function cryptoSpec(code: string): CryptoCurrencySpec | undefined {
  return CRYPTO_CURRENCIES.find((c) => c.code === code);
}

export function isCryptoCurrency(value: unknown): value is CryptoCurrencyCode {
  return typeof value === 'string' && CRYPTO_CURRENCIES.some((c) => c.code === value);
}

export function isValidCryptoAddress(code: string, address: string): boolean {
  const spec = cryptoSpec(code);
  return spec ? spec.address.test(address) : false;
}
