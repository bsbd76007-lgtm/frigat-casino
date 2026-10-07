import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  NowPaymentsError,
  verifyIpnSignature,
} from '../services/nowpayments.service';
import { identityFromRequest } from '../middleware/auth';
import { pushBalanceToUser } from '../websocket/socket.server';
import {
  createDeposit,
  createWithdrawal,
  handleWebhook,
  handleNowPaymentsIpn,
  isSupportedCurrency,
  listDeposits,
  listWithdrawals,
  SUPPORTED_CURRENCIES,
  AccountFrozenError,
  InsufficientFundsError,
  InvalidSignatureError,
  PaymentConfigError,
  WebhookPayloadError,
  PaymentProviderError,
  WalletNotFoundError,
  MIN_WITHDRAWAL_USD,
  WithdrawalBelowMinimumError,
  BonusWageringError,
} from '../services/payment.service';


const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,8})?$/;

function isValidAmount(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_PATTERN.test(value) && Number(value) > 0;
}

function isPlausibleAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 20 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9:_-]+$/.test(value)
  );
}

export function registerPaymentRoutes(app: FastifyInstance) {
  app.post<{
    Body: { amount?: string; currency?: string; network?: string };
  }>('/api/payments/deposit', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const { amount, currency, network } = req.body ?? {};

    if (!isValidAmount(amount)) {
      return reply
        .code(400)
        .send({ error: 'amount must be a positive decimal string (max 8 dp)' });
    }
    if (!isSupportedCurrency(currency)) {
      return reply.code(400).send({
        error: 'unsupported_currency',
        supported: SUPPORTED_CURRENCIES,
      });
    }
    if (network !== undefined && typeof network !== 'string') {
      return reply.code(400).send({ error: 'network must be a string' });
    }

    try {
      return await createDeposit({
        userId: identity.userId,
        amount,
        currency,
        network,
      });
    } catch (err) {
      return replyForPaymentError(err, reply, req);
    }
  });

  app.post<{
    Body: { amount?: string; currency?: string; address?: string; network?: string };
  }>('/api/payments/withdraw', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const { amount, currency, address, network } = req.body ?? {};

    if (!isValidAmount(amount)) {
      return reply
        .code(400)
        .send({ error: 'amount must be a positive decimal string (max 8 dp)' });
    }
    if (!isSupportedCurrency(currency)) {
      return reply.code(400).send({
        error: 'unsupported_currency',
        supported: SUPPORTED_CURRENCIES,
      });
    }
    if (!isPlausibleAddress(address)) {
      return reply.code(400).send({ error: 'invalid_address' });
    }
    if (network !== undefined && typeof network !== 'string') {
      return reply.code(400).send({ error: 'network must be a string' });
    }

    try {
      const result = await createWithdrawal({
        userId: identity.userId,
        amount,
        currency,
        address,
        network,
      });

      pushBalanceToUser(identity.userId, result.balance);
      req.log.info(
        {
          userId: identity.userId,
          withdrawalId: result.withdrawalId,
          amount: result.amount,
          awaitingReview: result.review === true,
          reviewReason: result.reviewReason,
        },
        result.review
          ? 'withdrawal reserved and queued for admin review'
          : 'withdrawal reserved and dispatched'
      );

      return {
        success: true,
        message: result.review
          ? 'Withdrawal request submitted for review.'
          : 'Withdrawal request submitted.',
        ...result,
      };
    } catch (err) {
      return replyForPaymentError(err, reply, req);
    }
  });

  const WEBHOOK_BODY_LIMIT = 64 * 1024;

  const rejectUnsigned = (req: FastifyRequest, reply: FastifyReply, provider: string) => {
    req.log.warn({ ip: req.ip, provider }, 'rejected payment webhook: missing or invalid signature');
    return reply.code(401).send({ error: 'invalid_signature' });
  };

  const rejectPayload = (
    req: FastifyRequest,
    reply: FastifyReply,
    provider: string,
    reason: string
  ) => {
    req.log.warn({ ip: req.ip, provider, reason }, 'rejected payment webhook: invalid payload');
    return reply.code(400).send({ error: 'invalid_payload' });
  };

  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  app.post<{ Body: unknown }>(
    '/api/payments/webhook',
    { bodyLimit: WEBHOOK_BODY_LIMIT },
    async (req, reply) => {
      const body = req.body;
      if (!isPlainObject(body)) return rejectPayload(req, reply, 'cryptomus', 'not_an_object');
      if (typeof body.sign !== 'string' || body.sign.length === 0) {
        return rejectUnsigned(req, reply, 'cryptomus');
      }

      try {
        const result = await handleWebhook(body);

        if (result.credited) {
          pushBalanceToUser(result.credited.userId, result.credited.balance);
          req.log.info(
            {
              userId: result.credited.userId,
              amount: result.credited.amount,
            },
            'deposit credited'
          );
        }

        return reply.code(200).send({ received: true, handled: result.handled });
      } catch (err) {
        if (err instanceof InvalidSignatureError) return rejectUnsigned(req, reply, 'cryptomus');
        if (err instanceof WebhookPayloadError) {
          return rejectPayload(req, reply, 'cryptomus', err.reason);
        }
        if (err instanceof PaymentConfigError) {
          req.log.error('payment webhook received but Cryptomus is not configured');
          return reply.code(503).send({ error: 'payments_unavailable' });
        }
        req.log.error({ err }, 'payment webhook processing failed');
        return reply.code(500).send({ error: 'webhook_processing_failed' });
      }
    }
  );

  app.post<{ Body: unknown }>(
    '/api/payments/nowpayments/webhook',
    { bodyLimit: WEBHOOK_BODY_LIMIT },
    async (req, reply) => {
      const body = req.body;
      const signature = req.headers['x-nowpayments-sig'];
      if (typeof signature !== 'string' || signature.length === 0) {
        return rejectUnsigned(req, reply, 'nowpayments');
      }
      if (!isPlainObject(body)) return rejectPayload(req, reply, 'nowpayments', 'not_an_object');

      let authentic: boolean;
      try {
        authentic = verifyIpnSignature(body, signature);
      } catch (err) {
        req.log.error({ err }, 'NOWPayments IPN received but no IPN secret is configured');
        return reply.code(503).send({ error: 'payments_unavailable' });
      }

      if (!authentic) return rejectUnsigned(req, reply, 'nowpayments');

      try {
        const result = await handleNowPaymentsIpn(body);

        if (result.credited) {
          pushBalanceToUser(result.credited.userId, result.credited.balance);
          req.log.info(
            { userId: result.credited.userId, amount: result.credited.amount },
            'deposit credited (nowpayments)'
          );
        }

        return reply.code(200).send({ received: true, handled: result.handled });
      } catch (err) {
        if (err instanceof WebhookPayloadError) {
          return rejectPayload(req, reply, 'nowpayments', err.reason);
        }
        req.log.error({ err }, 'NOWPayments IPN processing failed');
        return reply.code(500).send({ error: 'webhook_processing_failed' });
      }
    }
  );

  app.get('/api/payments/config', async () => ({
    currencies: SUPPORTED_CURRENCIES,
    minWithdrawal: MIN_WITHDRAWAL_USD,
  }));

  app.get('/api/payments/history', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const [deposits, withdrawals] = await Promise.all([
      listDeposits(identity.userId),
      listWithdrawals(identity.userId),
    ]);

    return { deposits, withdrawals };
  });
}


function replyForPaymentError(
  err: unknown,
  reply: FastifyReply,
  req: FastifyRequest
) {
  if (err instanceof InsufficientFundsError) {
    return reply.code(409).send({ error: 'insufficient_funds' });
  }
  if (err instanceof WithdrawalBelowMinimumError) {
    return reply.code(400).send({
      error: 'below_minimum_withdrawal',
      minimum: MIN_WITHDRAWAL_USD,
      detail: err.message,
    });
  }
  if (err instanceof BonusWageringError) {
    return reply.code(409).send({
      error: 'bonus_wagering_required',
      remaining: err.remaining,
      detail: err.message,
    });
  }
  if (err instanceof AccountFrozenError) {
    return reply.code(409).send({ error: 'account_frozen' });
  }
  if (err instanceof WalletNotFoundError) {
    return reply.code(404).send({ error: 'wallet_not_found' });
  }
  if (err instanceof PaymentConfigError) {
    req.log.error('payment attempted but Cryptomus credentials are missing');
    return reply.code(503).send({ error: 'payments_unavailable' });
  }
  if (err instanceof PaymentProviderError) {
    req.log.error({ err }, 'cryptomus request failed');
    return reply.code(502).send({ error: 'provider_error', detail: err.message });
  }
  if (err instanceof NowPaymentsError) {
    const credentialProblem = err.status === 401 || err.status === 403;
    if (credentialProblem) {
      req.log.error({ err }, 'NOWPayments rejected our API key — deposits are down');
      return reply.code(503).send({ error: 'payments_unavailable' });
    }
    req.log.error({ err }, 'nowpayments request failed');
    return reply.code(502).send({ error: 'provider_error', detail: err.message });
  }
  throw err;
}
