import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createHash, createHmac } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma, Role, TransactionType } from '@prisma/client';

import { buildApp } from '../index';
import { config } from '../config';
import { prisma } from '../config/prisma';
import { resetRateLimits } from '../services/rateLimit.service';
import { canonicalIpnPayload } from '../services/nowpayments.service';
import { createWithdrawal } from '../services/payment.service';

const IPN_SECRET = 'test-ipn-secret-for-webhook-suite';
const CRYPTOMUS_KEY = 'test-cryptomus-key-for-webhook-suite';

let app: FastifyInstance;

beforeAll(async () => {
  Object.assign(config.nowpayments, { ipnSecret: IPN_SECRET });
  Object.assign(config.cryptomus, { apiKey: CRYPTOMUS_KEY });
  app = await buildApp({ logger: false });
  await app.ready();
});

beforeEach(() => resetRateLimits());

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const unique = () => Math.random().toString(16).slice(2);

async function makePayment(provider: 'NOWPAYMENTS' | 'CRYPTOMUS', amount = '25') {
  const user = await prisma.user.create({
    data: {
      email: `hook-${unique()}@test.local`,
      passwordHash: 'x',
      role: Role.USER,
      wallets: { create: { currency: 'USD', balance: new Prisma.Decimal('0') } },
    },
    select: { id: true },
  });
  const paymentId =
    provider === 'NOWPAYMENTS'
      ? String(4_000_000_000 + Math.floor(Math.random() * 999_999_999))
      : `uuid-${unique()}`;
  await prisma.payment.create({
    data: {
      userId: user.id,
      amount: new Prisma.Decimal(amount),
      currency: 'USDT',
      provider,
      paymentId,
    },
  });
  return { userId: user.id, paymentId };
}

const deposits = (userId: string) =>
  prisma.transaction.count({
    where: { wallet: { userId }, type: TransactionType.DEPOSIT },
  });

const paymentStatus = async (paymentId: string) =>
  (await prisma.payment.findUniqueOrThrow({ where: { paymentId } })).status;

function ipnSignature(body: Record<string, unknown>, secret = IPN_SECRET) {
  return createHmac('sha512', secret).update(canonicalIpnPayload(body)).digest('hex');
}

const sendIpn = (body: Record<string, unknown>, signature?: string) =>
  app.inject({
    method: 'POST',
    url: '/api/payments/nowpayments/webhook',
    headers: signature === undefined ? {} : { 'x-nowpayments-sig': signature },
    payload: body,
  });

function cryptomusSign(body: Record<string, unknown>, key = CRYPTOMUS_KEY) {
  const serialized = JSON.stringify(body).replace(/\//g, '\\/');
  return createHash('md5').update(Buffer.from(serialized).toString('base64') + key).digest('hex');
}

const sendCryptomus = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/payments/webhook', payload: body });

describe('withdrawal payout currency policy', () => {
  it('converts a USD withdrawal to BTC using a Binance quote before dispatch', async () => {
    const user = await prisma.user.create({
      data: {
        email: `withdrawal-${unique()}@test.local`,
        role: Role.USER,
        wallets: {
          create: { currency: 'USD', balance: new Prisma.Decimal('100') },
        },
      },
      select: { id: true },
    });

    const previousNowPaymentsConfig = {
      ...config.nowpayments,
    };
    Object.assign(config.nowpayments, {
      apiKey: 'test-nowpayments-api-key',
      payoutEmail: 'payout@test.local',
      payoutPassword: 'test-payout-password',
      apiBase: 'https://nowpayments.test/v1',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.binance.com') {
        expect(url.searchParams.get('symbol')).toBe('BTCUSDT');
        expect(url.pathname).toBe('/api/v3/depth');
        return new Response(JSON.stringify({ asks: [['70000', '1']] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname.endsWith('/auth')) {
        return new Response(JSON.stringify({ token: 'test-payout-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname.endsWith('/payout')) {
        const payload = JSON.parse(String(init?.body)) as {
          withdrawals: Array<{ amount: string }>;
        };
        expect(payload.withdrawals[0].amount).toBe('0.00014285');
        return new Response(
          JSON.stringify({
            id: 'batch-id',
            withdrawals: [{
              id: 'withdrawal-id',
              address: 'bc1qtestaddressfortestwithdrawal',
              currency: 'btc',
              amount: payload.withdrawals[0].amount,
              status: 'waiting',
            }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    try {
      const result = await createWithdrawal({
        userId: user.id,
        amount: '10',
        currency: 'BTC',
        address: 'bc1qtestaddressfortestwithdrawal',
      });

      expect(result.amount).toBe('10.00000000');
      expect(result.amountCurrency).toBe('USD');
      expect(result.payoutAmount).toBe('0.00014285');
      expect(Number(result.exchangeRateUsdt)).toBeGreaterThan(69_990);
      expect(Number(result.exchangeRateUsdt)).toBeLessThan(70_010);
      expect(result.exchangeRateSource).toBe('BINANCE');
      expect(result.currency).toBe('BTC');
      expect(result.status).toBe('PENDING');
      expect(result.review).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      const stored = await prisma.withdrawal.findUniqueOrThrow({
        where: { id: result.withdrawalId },
      });
      expect(stored.amount.toFixed(8)).toBe('10.00000000');
      expect(stored.payoutAmount?.toFixed(8)).toBe('0.00014285');
      expect(stored.exchangeRateUsdt?.toFixed(12)).toBe('70000.000000000000');
    } finally {
      fetchSpy.mockRestore();
      Object.assign(config.nowpayments, previousNowPaymentsConfig);
    }
  });

  it('queues a withdrawal for manual review and does not dispatch if Binance cannot quote', async () => {
    const user = await prisma.user.create({
      data: {
        email: `withdrawal-${unique()}@test.local`,
        role: Role.USER,
        wallets: {
          create: { currency: 'USD', balance: new Prisma.Decimal('100') },
        },
      },
      select: { id: true },
    });

    const previousNowPaymentsConfig = { ...config.nowpayments };
    Object.assign(config.nowpayments, {
      apiKey: 'test-nowpayments-api-key',
      payoutEmail: 'payout@test.local',
      payoutPassword: 'test-payout-password',
      apiBase: 'https://nowpayments.test/v1',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('unavailable', { status: 503 })
    );

    try {
      const result = await createWithdrawal({
        userId: user.id,
        amount: '10',
        currency: 'ETH',
        address: '0x1234567890123456789012345678901234567890',
      });

      expect(result.review).toBe(true);
      expect(result.reviewReason).toBe('conversion_unavailable');
      expect(result.status).toBe('PENDING_ADMIN_REVIEW');
      expect(result.payoutAmount).toBeNull();
      expect(result.exchangeRateUsdt).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      Object.assign(config.nowpayments, previousNowPaymentsConfig);
    }
  });
});

describe('NOWPayments IPN webhook', () => {
  it('rejects a missing signature with 401 and a generic body', async () => {
    const { userId, paymentId } = await makePayment('NOWPAYMENTS');
    const res = await sendIpn({ payment_id: Number(paymentId), payment_status: 'finished' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_signature' });
    expect(await deposits(userId)).toBe(0);
  });

  it('rejects a wrong signature with 401 and credits nothing', async () => {
    const { userId, paymentId } = await makePayment('NOWPAYMENTS');
    const body = { payment_id: Number(paymentId), payment_status: 'finished' };
    const res = await sendIpn(body, ipnSignature(body, 'some-other-secret'));
    expect(res.statusCode).toBe(401);
    expect(await deposits(userId)).toBe(0);
  });

  it('rejects a signed but malformed payload with 400', async () => {
    const body = { payment_status: 'finished' };
    const res = await sendIpn(body, ipnSignature(body));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_payload' });
  });

  it('credits a finished payment exactly once, however often it is replayed', async () => {
    const { userId, paymentId } = await makePayment('NOWPAYMENTS', '25');
    const body = {
      payment_id: Number(paymentId),
      payment_status: 'finished',
      price_amount: 25,
      price_currency: 'usd',
      fee: { depositFee: 0.1, currency: 'usdttrc20', serviceFee: 0.2 },
    };
    const signature = ipnSignature(body);

    for (let i = 0; i < 3; i += 1) {
      const res = await sendIpn(body, signature);
      expect(res.statusCode).toBe(200);
    }
    expect(await deposits(userId)).toBe(1);
    expect(await paymentStatus(paymentId)).toBe('PAID');
  });

  it('does not let a replayed older status overwrite a credited payment', async () => {
    const { paymentId } = await makePayment('NOWPAYMENTS');
    const finished = { payment_id: Number(paymentId), payment_status: 'finished' };
    await sendIpn(finished, ipnSignature(finished));

    const waiting = { payment_id: Number(paymentId), payment_status: 'waiting' };
    const res = await sendIpn(waiting, ipnSignature(waiting));
    expect(res.statusCode).toBe(200);
    expect(await paymentStatus(paymentId)).toBe('PAID');
  });

  it('refuses to credit when the signed amount differs from the stored payment', async () => {
    const { userId, paymentId } = await makePayment('NOWPAYMENTS', '25');
    const body = { payment_id: Number(paymentId), payment_status: 'finished', price_amount: 2500 };
    const res = await sendIpn(body, ipnSignature(body));
    expect(res.statusCode).toBe(400);
    expect(await deposits(userId)).toBe(0);
  });

  it('refuses a currency other than the USD the invoice was priced in', async () => {
    const { userId, paymentId } = await makePayment('NOWPAYMENTS', '25');
    const body = {
      payment_id: Number(paymentId),
      payment_status: 'finished',
      price_amount: 25,
      price_currency: 'eur',
    };
    const res = await sendIpn(body, ipnSignature(body));
    expect(res.statusCode).toBe(400);
    expect(await deposits(userId)).toBe(0);
  });

  it('refuses to settle a payment that belongs to the other provider', async () => {
    const { userId, paymentId } = await makePayment('CRYPTOMUS');
    const body = { payment_id: paymentId.replace(/^uuid-/, 'x'), payment_status: 'finished' };
    await prisma.payment.update({ where: { paymentId }, data: { paymentId: body.payment_id } });
    const res = await sendIpn(body, ipnSignature(body));
    expect(res.statusCode).toBe(400);
    expect(await deposits(userId)).toBe(0);
  });

  it('ignores a status it does not know without touching the payment', async () => {
    const { paymentId } = await makePayment('NOWPAYMENTS');
    const body = { payment_id: Number(paymentId), payment_status: 'teleported' };
    const res = await sendIpn(body, ipnSignature(body));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true, handled: false });
    expect(await paymentStatus(paymentId)).toBe('PENDING');
  });
});

describe('Cryptomus webhook', () => {
  it('rejects a body without a signature with 401', async () => {
    const { userId, paymentId } = await makePayment('CRYPTOMUS');
    const res = await sendCryptomus({ uuid: paymentId, status: 'paid' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_signature' });
    expect(await deposits(userId)).toBe(0);
  });

  it('rejects a forged signature with 401', async () => {
    const { userId, paymentId } = await makePayment('CRYPTOMUS');
    const unsigned = { uuid: paymentId, status: 'paid' };
    const res = await sendCryptomus({ ...unsigned, sign: cryptomusSign(unsigned, 'wrong-key') });
    expect(res.statusCode).toBe(401);
    expect(await deposits(userId)).toBe(0);
  });

  it('credits a correctly signed paid invoice once', async () => {
    const { userId, paymentId } = await makePayment('CRYPTOMUS');
    const unsigned = { type: 'payment', uuid: paymentId, status: 'paid', url: 'https://x/y' };
    const signed = { ...unsigned, sign: cryptomusSign(unsigned) };

    expect((await sendCryptomus(signed)).statusCode).toBe(200);
    expect((await sendCryptomus(signed)).statusCode).toBe(200);
    expect(await deposits(userId)).toBe(1);
  });

  it('rejects a signed payload with an unexpected type with 400', async () => {
    const { paymentId } = await makePayment('CRYPTOMUS');
    const unsigned = { type: 'refund', uuid: paymentId, status: 'paid' };
    const res = await sendCryptomus({ ...unsigned, sign: cryptomusSign(unsigned) });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an oversized body before it reaches the handler', async () => {
    const res = await sendCryptomus({ uuid: 'x', status: 'paid', sign: 'y', pad: 'a'.repeat(70 * 1024) });
    expect(res.statusCode).toBe(413);
  });
});
