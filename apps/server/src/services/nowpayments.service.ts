import { createHmac, timingSafeEqual } from 'crypto';
import type { CryptoPaymentStatus } from '@prisma/client';

import { cryptoSpec } from '@frigat/shared';

import { config } from '../config';

export const NOWPAYMENTS_PROVIDER = 'NOWPAYMENTS';

export function payCurrencyFor(currency: string): string {
  return cryptoSpec(currency)?.nowPaymentsCode ?? currency.toLowerCase();
}

export function networkLabelFor(currency: string): string | null {
  return cryptoSpec(currency)?.network ?? null;
}

export function isNowPaymentsConfigured(): boolean {
  return config.nowpayments.apiKey.length > 0;
}

export class NowPaymentsError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'NowPaymentsError';
  }
}

const STATUS_MAP: Record<string, CryptoPaymentStatus> = {
  waiting: 'PENDING',
  confirming: 'CONFIRMING',
  confirmed: 'CONFIRMED',
  sending: 'CONFIRMING',
  partially_paid: 'WRONG_AMOUNT',
  finished: 'PAID',
  failed: 'FAILED',
  refunded: 'CANCELLED',
  expired: 'EXPIRED',
};

export function mapNowPaymentsStatus(raw: unknown): CryptoPaymentStatus {
  if (typeof raw !== 'string') return 'PENDING';
  return STATUS_MAP[raw.toLowerCase()] ?? 'PENDING';
}

const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; bearer?: string }
): Promise<T> {
  if (!isNowPaymentsConfigured()) {
    throw new NowPaymentsError('NOWPayments API key is not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${config.nowpayments.apiBase}${path}`, {
      method: init.method,
      headers: {
        'x-api-key': config.nowpayments.apiKey,
        ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new NowPaymentsError('payment provider timed out');
    }
    throw new NowPaymentsError(
      err instanceof Error ? err.message : 'payment provider unreachable'
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new NowPaymentsError(
      `payment provider returned a non-JSON response (${response.status})`,
      response.status
    );
  }

  if (!response.ok) {
    const message =
      (parsed as { message?: string })?.message ??
      `payment provider rejected the request (${response.status})`;
    throw new NowPaymentsError(message, response.status);
  }

  return parsed as T;
}

export async function nowPaymentsStatus(): Promise<{ message: string }> {
  return request<{ message: string }>('/status', { method: 'GET' });
}

export function isPayoutConfigured(): boolean {
  return (
    isNowPaymentsConfigured() &&
    config.nowpayments.payoutEmail.length > 0 &&
    config.nowpayments.payoutPassword.length > 0
  );
}

async function authenticate(): Promise<string> {
  const auth = await request<{ token?: string }>('/auth', {
    method: 'POST',
    body: {
      email: config.nowpayments.payoutEmail,
      password: config.nowpayments.payoutPassword,
    },
  });
  if (!auth.token) {
    throw new NowPaymentsError('NOWPayments did not return a payout auth token');
  }
  return auth.token;
}

export interface PayoutRecipient {
  address: string;
  currency: string;
  amount: string;
}

export interface NowPaymentsPayoutBatch {
  id: string;
  withdrawals: Array<{
    id: string;
    address: string;
    currency: string;
    amount: string | number;
    status: string;
    hash?: string | null;
  }>;
}

export async function createPayout(
  recipients: PayoutRecipient[]
): Promise<NowPaymentsPayoutBatch> {
  if (!isPayoutConfigured()) {
    throw new NowPaymentsError('NOWPayments payout credentials are not configured');
  }
  const token = await authenticate();

  return request<NowPaymentsPayoutBatch>('/payout', {
    method: 'POST',
    body: { ipn_callback_url: config.nowpayments.ipnCallbackUrl || undefined, withdrawals: recipients },
    bearer: token,
  });
}

export interface NowPaymentsPayment {
  payment_id: number | string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  order_id?: string | null;
  expiration_estimate_date?: string | null;
  valid_until?: string | null;
  payin_extra_id?: string | null;
}

export interface CreatePaymentInput {
  amount: string;
  currency: string;
  orderId: string;
  description?: string;
}

export async function createNowPayment(
  input: CreatePaymentInput
): Promise<NowPaymentsPayment> {
  return request<NowPaymentsPayment>('/payment', {
    method: 'POST',
    body: {
      price_amount: Number(input.amount),
      price_currency: 'usd',
      pay_currency: payCurrencyFor(input.currency),
      order_id: input.orderId,
      order_description: input.description ?? 'FRIGAT deposit',
      ...(config.nowpayments.ipnCallbackUrl
        ? { ipn_callback_url: config.nowpayments.ipnCallbackUrl }
        : {}),
    },
  });
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) sorted[key] = sortKeysDeep(source[key]);
  return sorted;
}

export function canonicalIpnPayload(body: Record<string, unknown>): string {
  return JSON.stringify(sortKeysDeep(body));
}

export function isKnownNowPaymentsStatus(raw: unknown): boolean {
  return typeof raw === 'string' && raw.toLowerCase() in STATUS_MAP;
}

export function verifyIpnSignature(
  body: Record<string, unknown>,
  signature: unknown
): boolean {
  const secret = config.nowpayments.ipnSecret;
  if (!secret) throw new NowPaymentsError('NOWPayments IPN secret is not configured');
  if (typeof signature !== 'string' || signature.length === 0) return false;

  const expected = createHmac('sha512', secret)
    .update(canonicalIpnPayload(body))
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
