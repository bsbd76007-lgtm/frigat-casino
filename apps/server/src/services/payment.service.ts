import { bonusFor, wageringRemaining } from './depositBonus.service';
import { createHash, timingSafeEqual } from 'crypto';
import { Prisma, TransactionType, type CryptoPaymentStatus } from '@prisma/client';

import { config } from '../config';
import { BinancePriceError, getBinanceUsdtAskBook } from './binancePrice.service';
import {
  NOWPAYMENTS_PROVIDER,
  createNowPayment,
  createPayout,
  NowPaymentsError,
  isPayoutConfigured,
  isKnownNowPaymentsStatus,
  mapNowPaymentsStatus,
  networkLabelFor,
  payCurrencyFor,
} from './nowpayments.service';
import { prisma } from '../config/prisma';
import {
  requestWithdrawal,
  rejectWithdrawal,
  AccountFrozenError,
  WalletNotFoundError,
} from './ledger.service';

const D = Prisma.Decimal;

export const SUPPORTED_CURRENCIES = ['USDT', 'BTC', 'ETH', 'LTC'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const DEFAULT_NETWORK: Record<SupportedCurrency, string | undefined> = {
  USDT: 'tron',
  BTC: undefined,
  ETH: undefined,
  LTC: undefined,
};

const LEDGER_CURRENCY = 'USD';

export const MANUAL_PROVIDER = 'MANUAL_ADMIN';

export function isSupportedCurrency(value: unknown): value is SupportedCurrency {
  return (
    typeof value === 'string' &&
    (SUPPORTED_CURRENCIES as readonly string[]).includes(value)
  );
}

export class PaymentConfigError extends Error {
  constructor() {
    super('Cryptomus credentials are not configured');
    this.name = 'PaymentConfigError';
  }
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly ambiguous = false
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export class WebhookPayloadError extends Error {
  constructor(readonly reason: string) {
    super(`Webhook payload rejected: ${reason}`);
    this.name = 'WebhookPayloadError';
  }
}

export class InvalidSignatureError extends Error {
  constructor() {
    super('Webhook signature verification failed');
    this.name = 'InvalidSignatureError';
  }
}

export {
  AccountFrozenError,
  InsufficientFundsError,
  WalletNotFoundError,
} from './ledger.service';

function signPayload(rawBody: string, apiKey: string): string {
  return createHash('md5')
    .update(Buffer.from(rawBody).toString('base64') + apiKey)
    .digest('hex');
}

function signaturesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface CryptomusEnvelope<T> {
  state: number;
  result?: T;
  message?: string;
  errors?: Record<string, unknown>;
}

async function cryptomusRequest<T>(
  path: string,
  body: Record<string, unknown>,
  keyKind: 'payment' | 'payout' = 'payment'
): Promise<T> {
  const { merchantId, apiKey, payoutApiKey, apiBase } = config.cryptomus;
  const signingKey = keyKind === 'payout' ? payoutApiKey || apiKey : apiKey;

  if (!merchantId || !signingKey) throw new PaymentConfigError();

  const rawBody = JSON.stringify(body);

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        merchant: merchantId,
        sign: signPayload(rawBody, signingKey),
      },
      body: rawBody,
      signal: abort.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new PaymentProviderError('payment provider timed out', undefined, true);
    }
    throw new PaymentProviderError(
      err instanceof Error ? err.message : 'payment provider unreachable',
      undefined,
      true
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let envelope: CryptomusEnvelope<T>;
  try {
    envelope = JSON.parse(text) as CryptomusEnvelope<T>;
  } catch {
    throw new PaymentProviderError(
      `payment provider returned a non-JSON response (${response.status})`,
      response.status
    );
  }

  if (!response.ok || envelope.state !== 0 || !envelope.result) {
    throw new PaymentProviderError(
      envelope.message ?? `payment provider rejected the request (${response.status})`,
      response.status
    );
  }

  return envelope.result;
}

const STATUS_MAP: Record<string, CryptoPaymentStatus> = {
  paid: 'PAID',
  paid_over: 'PAID_OVER',
  confirm_check: 'CONFIRMING',
  confirmations: 'CONFIRMING',
  check: 'PENDING',
  process: 'PENDING',
  wrong_amount: 'WRONG_AMOUNT',
  wrong_amount_waiting: 'WRONG_AMOUNT',
  cancel: 'CANCELLED',
  canceled: 'CANCELLED',
  fail: 'FAILED',
  system_fail: 'FAILED',
  refund_process: 'FAILED',
  refund_fail: 'FAILED',
  refund_paid: 'FAILED',
  locked: 'PENDING',
  expired: 'EXPIRED',
};

function mapStatus(raw: unknown): CryptoPaymentStatus {
  if (typeof raw !== 'string') return 'PENDING';
  return STATUS_MAP[raw.toLowerCase()] ?? 'PENDING';
}

function isSettled(status: CryptoPaymentStatus): boolean {
  return status === 'PAID' || status === 'PAID_OVER' || status === 'CONFIRMED';
}

function isPayoutFailure(status: CryptoPaymentStatus): boolean {
  return status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED';
}

export interface CreateDepositInput {
  userId: string;
  amount: string;
  currency: SupportedCurrency;
  network?: string;
}

const PRICE_CURRENCY = 'USD';

export interface CreateDepositResult {
  paymentId: string;
  amount: string;
  currency: string;
  priceAmount: string;
  priceCurrency: string;
  status: CryptoPaymentStatus;
  address: string | null;
  payUrl: string | null;
  network: string | null;
  expiresAt: string | null;
}

interface CryptomusInvoice {
  uuid: string;
  order_id: string;
  amount: string;
  payer_amount?: string | null;
  payer_currency?: string | null;
  address?: string | null;
  url?: string | null;
  network?: string | null;
  status?: string;
  expired_at?: number | null;
}

export async function createDeposit(
  input: CreateDepositInput
): Promise<CreateDepositResult> {
  const amount = new D(input.amount);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new Error('payment: deposit amount must be positive');
  }

  const account = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { frozen: true },
  });
  if (!account) throw new WalletNotFoundError();
  if (account.frozen) throw new AccountFrozenError();

  const orderId = `dep_${input.userId}_${Date.now().toString(36)}`;

  if (config.paymentsProvider === NOWPAYMENTS_PROVIDER) {
    return createNowPaymentsDeposit(input, amount, orderId);
  }

  const network = input.network ?? DEFAULT_NETWORK[input.currency];

  const invoice = await cryptomusRequest<CryptomusInvoice>('/payment', {
    amount: amount.toFixed(2),
    currency: PRICE_CURRENCY,
    to_currency: input.currency,
    order_id: orderId,
    ...(network ? { network } : {}),
    ...(config.cryptomus.webhookUrl ? { url_callback: config.cryptomus.webhookUrl } : {}),
    ...(config.cryptomus.returnUrl ? { url_return: config.cryptomus.returnUrl } : {}),
  });

  const record = await prisma.payment.create({
    data: {
      userId: input.userId,
      amount,
      currency: input.currency,
      status: mapStatus(invoice.status),
      paymentId: invoice.uuid,
      address: invoice.address ?? null,
      payUrl: invoice.url ?? null,
    },
    select: { status: true },
  });

  return {
    paymentId: invoice.uuid,
    amount: invoice.payer_amount ?? invoice.amount ?? amount.toFixed(2),
    currency: invoice.payer_currency ?? input.currency,
    priceAmount: amount.toFixed(2),
    priceCurrency: PRICE_CURRENCY,
    status: record.status,
    address: invoice.address ?? null,
    payUrl: invoice.url ?? null,
    network: invoice.network ?? network ?? null,
    expiresAt: invoice.expired_at
      ? new Date(invoice.expired_at * 1000).toISOString()
      : null,
  };
}

async function createNowPaymentsDeposit(
  input: CreateDepositInput,
  amount: Prisma.Decimal,
  orderId: string
): Promise<CreateDepositResult> {
  const payment = await createNowPayment({
    amount: amount.toFixed(2),
    currency: input.currency,
    orderId,
  });

  const paymentId = String(payment.payment_id);
  const status = mapNowPaymentsStatus(payment.payment_status);

  await prisma.payment.create({
    data: {
      userId: input.userId,
      amount,
      currency: input.currency,
      status,
      provider: NOWPAYMENTS_PROVIDER,
      paymentId,
      address: payment.pay_address ?? null,
      payUrl: null,
    },
    select: { id: true },
  });

  return {
    paymentId,
    amount: payment.pay_amount != null ? String(payment.pay_amount) : amount.toFixed(2),
    currency: input.currency,
    priceAmount: amount.toFixed(2),
    priceCurrency: PRICE_CURRENCY,
    status,
    address: payment.pay_address ?? null,
    payUrl: null,
    network: networkLabelFor(input.currency),
    expiresAt: payment.valid_until ?? payment.expiration_estimate_date ?? null,
  };
}

export async function listDeposits(userId: string, take = 20) {
  const rows = await prisma.payment.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      paymentId: true,
      txHash: true,
      address: true,
      payUrl: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    amount: row.amount.toFixed(8),
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface WebhookResult {
  handled: boolean;
  credited?: {
    userId: string;
    balance: string;
    amount: string;
  };
}

export function verifyWebhookSignature(body: Record<string, unknown>): boolean {
  const { sign, ...rest } = body as { sign?: unknown } & Record<string, unknown>;
  if (typeof sign !== 'string' || sign.length === 0) return false;

  const apiKey = config.cryptomus.apiKey;
  if (!apiKey) throw new PaymentConfigError();

  const serialized = JSON.stringify(rest).replace(/\//g, '\\/');
  return signaturesMatch(signPayload(serialized, apiKey), sign);
}

const PAYMENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TX_HASH_RE = /^[A-Za-z0-9:_-]{1,256}$/;

function optionalTxHash(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !TX_HASH_RE.test(raw)) throw new WebhookPayloadError('tx_hash');
  return raw;
}

function signedAmount(raw: unknown): Prisma.Decimal | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') throw new WebhookPayloadError('amount');
  const text = String(raw).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new WebhookPayloadError('amount');
  return new D(text);
}

export async function handleNowPaymentsIpn(
  body: Record<string, unknown>
): Promise<WebhookResult> {
  const rawId = body.payment_id;
  const paymentId =
    (typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0) ||
    (typeof rawId === 'string' && PAYMENT_ID_RE.test(rawId))
      ? String(rawId)
      : null;
  if (!paymentId) throw new WebhookPayloadError('payment_id');

  if (typeof body.payment_status !== 'string') throw new WebhookPayloadError('payment_status');
  if (!isKnownNowPaymentsStatus(body.payment_status)) return { handled: false };

  if (
    body.price_currency !== undefined &&
    (typeof body.price_currency !== 'string' || body.price_currency.toLowerCase() !== 'usd')
  ) {
    throw new WebhookPayloadError('price_currency');
  }

  return settleDeposit({
    provider: NOWPAYMENTS_PROVIDER,
    paymentId,
    status: mapNowPaymentsStatus(body.payment_status),
    txHash: optionalTxHash(body.payin_hash),
    creditOverride: null,
    expectedAmount: signedAmount(body.price_amount),
  });
}

export async function handleWebhook(
  body: Record<string, unknown>
): Promise<WebhookResult> {
  if (!verifyWebhookSignature(body)) throw new InvalidSignatureError();

  const uuid = typeof body.uuid === 'string' && PAYMENT_ID_RE.test(body.uuid) ? body.uuid : null;
  if (!uuid) throw new WebhookPayloadError('uuid');
  if (typeof body.status !== 'string') throw new WebhookPayloadError('status');
  if (body.type !== undefined && body.type !== 'payment' && body.type !== 'payout') {
    throw new WebhookPayloadError('type');
  }

  const status = mapStatus(body.status);
  const txHash = optionalTxHash(body.txid);

  if (body.type === 'payout') {
    return handlePayoutWebhook(uuid, status, txHash);
  }

  return handleDepositWebhook(uuid, status, txHash);
}

async function handleDepositWebhook(
  uuid: string,
  status: CryptoPaymentStatus,
  txHash: string | null
): Promise<WebhookResult> {
  return settleDeposit({
    provider: 'CRYPTOMUS',
    paymentId: uuid,
    status,
    txHash,
    creditOverride: null,
  });
}

interface SettleDepositInput {
  provider: string;
  paymentId: string;
  status: CryptoPaymentStatus;
  txHash: string | null;
  creditOverride: Prisma.Decimal | null;
  expectedAmount?: Prisma.Decimal | null;
}

async function settleDeposit(input: SettleDepositInput): Promise<WebhookResult> {
  const { paymentId, status, txHash } = input;

  const payment = await prisma.payment.findUnique({
    where: { paymentId },
    select: { id: true, userId: true, amount: true, transactionId: true, provider: true },
  });

  if (!payment) return { handled: false };
  if (payment.provider !== input.provider) throw new WebhookPayloadError('provider');
  if (input.expectedAmount && !input.expectedAmount.eq(payment.amount)) {
    throw new WebhookPayloadError('amount_mismatch');
  }

  if (payment.transactionId) return { handled: true };

  const received = input.creditOverride;

  if (!isSettled(status)) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status,
        ...(txHash ? { txHash } : {}),
        ...(received ? { paidAmount: received } : {}),
      },
    });
    return { handled: true };
  }

  const creditAmount = received ?? payment.amount;

  const outcome = await prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, transactionId: null },
      data: {
        status,
        paidAmount: creditAmount,
        ...(txHash ? { txHash } : {}),
      },
    });
    if (claimed.count !== 1) return null;

    const wallet = await tx.wallet.upsert({
      where: {
        userId_currency: { userId: payment.userId, currency: LEDGER_CURRENCY },
      },
      update: {},
      create: {
        userId: payment.userId,
        currency: LEDGER_CURRENCY,
        balance: new D(0),
      },
      select: { id: true },
    });

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: creditAmount } },
      select: { balance: true },
    });

    const ledgerRow = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.DEPOSIT,
        amount: creditAmount,
        status: 'COMPLETED',
        txHash: txHash ?? `${input.provider.toLowerCase()}:${paymentId}`,
      },
      select: { id: true },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { transactionId: ledgerRow.id },
    });

    const priorDeposits = await tx.payment.count({
      where: { userId: payment.userId, transactionId: { not: null }, id: { not: payment.id } },
    });
    const bonus = bonusFor(priorDeposits, creditAmount);
    if (bonus) {
      const withBonus = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: bonus } },
        select: { balance: true },
      });
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.DEPOSIT_BONUS,
          amount: bonus,
          status: 'COMPLETED',
          txHash: `deposit-bonus:${payment.id}`,
        },
      });
      return { balance: withBonus.balance.toString() };
    }

    return { balance: updated.balance.toString() };
  });

  if (!outcome) return { handled: true };

  return {
    handled: true,
    credited: {
      userId: payment.userId,
      balance: outcome.balance,
      amount: creditAmount.toFixed(8),
    },
  };
}

async function handlePayoutWebhook(
  uuid: string,
  status: CryptoPaymentStatus,
  txHash: string | null
): Promise<WebhookResult> {
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { paymentId: uuid },
    select: { id: true, status: true, transactionId: true },
  });
  if (!withdrawal) return { handled: false };

  await prisma.withdrawal.update({
    where: { id: withdrawal.id },
    data: { status, ...(txHash ? { txHash } : {}) },
  });

  if (isPayoutFailure(status) && !isPayoutFailure(withdrawal.status)) {
    try {
      await rejectWithdrawal({
        transactionId: withdrawal.transactionId,
        auditWithin: async () => undefined,
      });
    } catch {
    }
  }

  return { handled: true };
}

export interface CreateWithdrawalInput {
  userId: string;
  amount: string;
  currency: SupportedCurrency;
  address: string;
  network?: string;
}

export interface CreateWithdrawalResult {
  review?: boolean;
  reviewReason?: 'conversion_unavailable' | 'provider_unavailable';
  withdrawalId: string;
  status: CryptoPaymentStatus;
  amount: string;
  amountCurrency: 'USD';
  payoutAmount: string | null;
  exchangeRateUsdt: string | null;
  exchangeRateSource: 'BINANCE' | 'USDT_PEG' | null;
  currency: string;
  address: string;
  balance: string;
}

interface CryptomusPayout {
  uuid: string;
  status?: string;
  txid?: string | null;
}

interface WithdrawalQuote {
  payoutAmount: Prisma.Decimal;
  exchangeRateUsdt: Prisma.Decimal;
  exchangeRateSource: 'BINANCE' | 'USDT_PEG';
}

async function quoteWithdrawal(
  amount: Prisma.Decimal,
  currency: SupportedCurrency
): Promise<WithdrawalQuote> {
  const exchangeRateSource = currency === 'USDT' ? 'USDT_PEG' : 'BINANCE';
  let payoutAmount: Prisma.Decimal;
  let exchangeRateUsdt: Prisma.Decimal;

  if (currency === 'USDT') {
    payoutAmount = amount;
    exchangeRateUsdt = new D(1);
  } else {
    const asks = await getBinanceUsdtAskBook(currency);
    let remainingUsdt = amount;
    payoutAmount = new D(0);
    let usedPartialLevel = false;

    for (const ask of asks) {
      const price = new D(ask.price);
      const levelQuantity = new D(ask.quantity).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
      const affordableQuantity = remainingUsdt
        .dividedBy(price)
        .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
      const quantity = Prisma.Decimal.min(levelQuantity, affordableQuantity);
      if (quantity.lessThanOrEqualTo(0)) break;

      payoutAmount = payoutAmount.plus(quantity);
      remainingUsdt = remainingUsdt.minus(quantity.mul(price));
      if (quantity.lessThan(levelQuantity)) {
        usedPartialLevel = true;
        break;
      }
    }

    if (remainingUsdt.gt(0) && !usedPartialLevel) {
      throw new BinancePriceError('Binance order book depth is insufficient for this withdrawal.');
    }
    if (payoutAmount.gt(0)) {
      exchangeRateUsdt = amount.minus(remainingUsdt).dividedBy(payoutAmount);
    } else {
      exchangeRateUsdt = new D(0);
    }
  }

  if (!exchangeRateUsdt.isFinite() || exchangeRateUsdt.lessThanOrEqualTo(0) || payoutAmount.lessThanOrEqualTo(0)) {
    throw new BinancePriceError('The withdrawal conversion quote is outside supported precision.');
  }

  return { payoutAmount, exchangeRateUsdt, exchangeRateSource };
}

async function dispatchNowPaymentsPayout(
  input: CreateWithdrawalInput,
  amount: Prisma.Decimal,
  quote: WithdrawalQuote,
  withdrawalId: string,
  reserved: { transactionId: string; balance: string }
): Promise<CreateWithdrawalResult> {
  let batch: Awaited<ReturnType<typeof createPayout>>;
  try {
    batch = await createPayout([
      {
        address: input.address,
        currency: payCurrencyFor(input.currency),
        amount: quote.payoutAmount.toFixed(8),
      },
    ]);
  } catch (err) {
    const refused = err instanceof NowPaymentsError && typeof err.status === 'number';

    if (!refused) {
      await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'PENDING_ADMIN_REVIEW' },
      });
      throw new PaymentProviderError(
        'Payout could not be confirmed and is being reviewed. Your balance stays reserved.',
        undefined,
        true
      );
    }

    await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'FAILED' },
    });
    await rejectWithdrawal({
      transactionId: reserved.transactionId,
      auditWithin: async () => undefined,
    }).catch(() => undefined);
    throw err;
  }

  const leg = batch.withdrawals?.[0];
  const updated = await prisma.withdrawal.update({
    where: { id: withdrawalId },
    data: {
      provider: NOWPAYMENTS_PROVIDER,
      payoutAmount: quote.payoutAmount,
      exchangeRateUsdt: quote.exchangeRateUsdt,
      exchangeRateSource: quote.exchangeRateSource,
      paymentId: leg?.id ?? batch.id,
      status: mapNowPaymentsStatus(leg?.status),
      ...(leg?.hash ? { txHash: leg.hash } : {}),
    },
    select: { id: true, status: true },
  });

  return {
    withdrawalId: updated.id,
    status: updated.status,
    amount: amount.toFixed(8),
    amountCurrency: LEDGER_CURRENCY,
    payoutAmount: quote.payoutAmount.toFixed(8),
    exchangeRateUsdt: quote.exchangeRateUsdt.toFixed(12),
    exchangeRateSource: quote.exchangeRateSource,
    currency: input.currency,
    address: input.address,
    balance: reserved.balance,
  };
}

export const MIN_WITHDRAWAL_USD = '10';

export class WithdrawalBelowMinimumError extends Error {
  constructor() {
    super(`The minimum withdrawal is $${MIN_WITHDRAWAL_USD}.`);
    this.name = 'WithdrawalBelowMinimumError';
  }
}

export class BonusWageringError extends Error {
  constructor(readonly remaining: string) {
    super(`Wager $${remaining} more before withdrawing — your deposit bonus is still being played through.`);
    this.name = 'BonusWageringError';
  }
}

export async function createWithdrawal(
  input: CreateWithdrawalInput
): Promise<CreateWithdrawalResult> {
  const amount = new D(input.amount);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new Error('payment: withdrawal amount must be positive');
  }
  if (amount.lessThan(MIN_WITHDRAWAL_USD)) throw new WithdrawalBelowMinimumError();

  const remaining = await wageringRemaining(input.userId);
  if (remaining.gt(0)) throw new BonusWageringError(remaining.toFixed(2));

  let quote: WithdrawalQuote | null = null;
  let conversionUnavailable = false;
  try {
    quote = await quoteWithdrawal(amount, input.currency);
  } catch (err) {
    if (!(err instanceof BinancePriceError)) throw err;
    conversionUnavailable = true;
  }

  const reserved = await requestWithdrawal({
    userId: input.userId,
    amount: amount.toFixed(8),
    currency: LEDGER_CURRENCY,
  });

  const network = input.network ?? DEFAULT_NETWORK[input.currency];

  const record = await prisma.withdrawal.create({
    data: {
      userId: input.userId,
      amount,
      ...(quote
        ? {
            payoutAmount: quote.payoutAmount,
            exchangeRateUsdt: quote.exchangeRateUsdt,
            exchangeRateSource: quote.exchangeRateSource,
          }
        : {}),
      currency: input.currency,
      address: input.address,
      network: network ?? null,
      status: 'PENDING',
      transactionId: reserved.transactionId,
    },
    select: { id: true },
  });

  const queueForManualReview = async (
    reviewReason: CreateWithdrawalResult['reviewReason'] = 'provider_unavailable'
  ) => {
    const queued = await prisma.withdrawal.update({
      where: { id: record.id },
      data: { provider: MANUAL_PROVIDER, status: 'PENDING_ADMIN_REVIEW' },
      select: { id: true, status: true },
    });

    return {
      withdrawalId: queued.id,
      status: queued.status,
      amount: amount.toFixed(8),
      amountCurrency: LEDGER_CURRENCY,
      payoutAmount: quote?.payoutAmount.toFixed(8) ?? null,
      exchangeRateUsdt: quote?.exchangeRateUsdt.toFixed(12) ?? null,
      exchangeRateSource: quote?.exchangeRateSource ?? null,
      currency: input.currency,
      address: input.address,
      balance: reserved.balance,
      review: true,
      reviewReason,
    } satisfies CreateWithdrawalResult;
  };

  if (!quote) {
    return queueForManualReview(
      conversionUnavailable ? 'conversion_unavailable' : 'provider_unavailable'
    );
  }

  if (isPayoutConfigured()) {
    return dispatchNowPaymentsPayout(input, amount, quote, record.id, reserved);
  }

  if (!config.cryptomus.merchantId || !config.cryptomus.payoutApiKey) {
    return queueForManualReview();
  }

  let payout: CryptomusPayout;
  try {
    payout = await cryptomusRequest<CryptomusPayout>(
      '/payout',
      {
        amount: quote.payoutAmount.toFixed(8),
        currency: input.currency,
        address: input.address,
        order_id: `wd_${record.id}`,
        is_subtract: '1',
        ...(network ? { network } : {}),
        ...(config.cryptomus.webhookUrl
          ? { url_callback: config.cryptomus.webhookUrl }
          : {}),
      },
      'payout'
    );
  } catch (err) {
    const ambiguous = err instanceof PaymentProviderError && err.ambiguous;

    if (ambiguous) {
      await prisma.withdrawal.update({
        where: { id: record.id },
        data: { status: 'PENDING_ADMIN_REVIEW' },
      });
      throw new PaymentProviderError(
        'Payout could not be confirmed and is being reviewed. Your balance stays reserved.',
        err instanceof PaymentProviderError ? err.status : undefined,
        true
      );
    }

    await prisma.withdrawal.update({
      where: { id: record.id },
      data: { status: 'FAILED' },
    });
    await rejectWithdrawal({
      transactionId: reserved.transactionId,
      auditWithin: async () => undefined,
    }).catch(() => undefined);
    throw err;
  }

  const updated = await prisma.withdrawal.update({
    where: { id: record.id },
    data: {
      paymentId: payout.uuid,
      payoutAmount: quote.payoutAmount,
      exchangeRateUsdt: quote.exchangeRateUsdt,
      exchangeRateSource: quote.exchangeRateSource,
      status: mapStatus(payout.status),
      ...(payout.txid ? { txHash: payout.txid } : {}),
    },
    select: { id: true, status: true },
  });

  return {
    withdrawalId: updated.id,
    status: updated.status,
    amount: amount.toFixed(8),
    amountCurrency: LEDGER_CURRENCY,
    payoutAmount: quote.payoutAmount.toFixed(8),
    exchangeRateUsdt: quote.exchangeRateUsdt.toFixed(12),
    exchangeRateSource: quote.exchangeRateSource,
    currency: input.currency,
    address: input.address,
    balance: reserved.balance,
  };
}

export async function listWithdrawals(userId: string, take = 20) {
  const rows = await prisma.withdrawal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      amount: true,
      payoutAmount: true,
      exchangeRateUsdt: true,
      exchangeRateSource: true,
      currency: true,
      status: true,
      address: true,
      txHash: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    amount: row.amount.toFixed(8),
    amountCurrency: LEDGER_CURRENCY,
    payoutAmount: row.payoutAmount?.toFixed(8) ?? null,
    exchangeRateUsdt: row.exchangeRateUsdt?.toFixed(12) ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}
