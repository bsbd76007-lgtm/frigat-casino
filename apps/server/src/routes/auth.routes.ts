import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { Prisma, Role } from '@prisma/client';
import { PASSWORD_POLICY, passwordProblems } from '@frigat/shared';
import { config } from '../config';
import { prisma } from '../config/prisma';
import { identityFromRequest } from '../middleware/auth';
import {
  throttled,
  recordAccountFailure,
  clearThrottle,
} from '../services/rateLimit.service';
import { verifyTurnstileToken } from '../utils/turnstile';
import { MailerNotConfiguredError, sendMail } from '../services/mailer.service';
import {
  parseEmailLocale,
  renderCodeEmail,
  type CodeEmailKind,
} from '../services/emailTemplates';
import {
  discardOtp,
  issueOtp,
  OTP_POLICY,
  OtpCooldownError,
  OtpTooManyAttemptsError,
  verifyOtp,
  type OtpPurpose,
} from '../services/otp.service';
import { spendSecondFactor } from '../services/totp.service';
import {
  allowedRedirectUri,
  exchangeGoogleCode,
  googleCodeExchangeEnabled,
  googleSignInEnabled,
  verifyGoogleAccessToken,
  verifyGoogleIdToken,
} from '../services/googleAuth.service';

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

const DUMMY_HASH_PROMISE = argon2.hash('frigat-nonexistent-account', ARGON2_OPTS);

function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTS);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = PASSWORD_POLICY.minLength;
const MAX_PASSWORD = PASSWORD_POLICY.maxLength;

interface CredentialsBody {
  email?: unknown;
  password?: unknown;
  turnstileToken?: unknown;
  locale?: unknown;
}

interface RegisterQuery {
  ref?: unknown;
}

const REFERRAL_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

interface ParsedCredentials {
  email: string;
  password: string;
}

function parseCredentials(body: CredentialsBody | undefined): ParsedCredentials | null {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!EMAIL_RE.test(email) || email.length > 254) return null;
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return null;

  return { email, password };
}

function signToken(userId: string, role: Role, tokenVersion: number): string {
  return jwt.sign({ userId, role, tv: tokenVersion }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    subject: userId,
  });
}

const CHALLENGE_SECRET = `${config.jwtSecret}:2fa-challenge`;
const CHALLENGE_TTL = '5m';

function signChallenge(userId: string, tokenVersion: number): string {
  return jwt.sign({ purpose: '2fa', tv: tokenVersion }, CHALLENGE_SECRET, {
    algorithm: 'HS256',
    expiresIn: CHALLENGE_TTL,
    subject: userId,
  });
}

function readChallenge(token: string): { userId: string; tv: number } | null {
  try {
    const claims = jwt.verify(token, CHALLENGE_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (claims.purpose !== '2fa' || typeof claims.sub !== 'string') return null;
    return { userId: claims.sub, tv: typeof claims.tv === 'number' ? claims.tv : -1 };
  } catch {
    return null;
  }
}

async function turnstileRejected(
  req: FastifyRequest<{ Body: CredentialsBody }>,
  reply: FastifyReply,
  scope: string
): Promise<boolean> {
  const token =
    typeof req.body?.turnstileToken === 'string' ? req.body.turnstileToken : undefined;

  const outcome = await verifyTurnstileToken(token, req.ip);
  if (outcome.ok) return false;

  if (outcome.misconfigured) {
    req.log.error(
      { scope, codes: outcome.codes },
      'turnstile is misconfigured — TURNSTILE_SECRET_KEY is missing or not accepted by Cloudflare, so ALL auth requests are being rejected. ' +
        'Set a valid secret, or set TURNSTILE_DISABLED=true to bypass while configuring the deployment.'
    );

    await reply.code(503).send({
      error: 'turnstile_misconfigured',
      message:
        'Human verification is not configured on this server. This is a server-side problem, not a failed check.',
    });
    return true;
  }

  req.log.warn({ scope, ip: req.ip, codes: outcome.codes }, 'turnstile verification failed');
  await reply.code(403).send({
    error: 'turnstile_failed',
    message: 'Human verification failed. Please try again.',
  });
  return true;
}

interface CodeAccepted {
  requiresOtp: true;
  email: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  devCode?: string;
  delivered?: boolean;
}

type CodeDelivery =
  | { ok: true; body: CodeAccepted }
  | { ok: false; status: number; body: Record<string, unknown> };

async function deliverCode(
  req: FastifyRequest,
  email: string,
  options: {
    purpose: OtpPurpose;
    passwordHash?: string | null;
    template: CodeEmailKind;
  }
): Promise<CodeDelivery> {
  let issued;
  try {
    issued = await issueOtp(email, {
      purpose: options.purpose,
      passwordHash: options.passwordHash ?? null,
    });
  } catch (err) {
    if (err instanceof OtpCooldownError) {
      return {
        ok: false,
        status: 429,
        body: {
          error: 'otp_cooldown',
          message: `Please wait ${err.retryAfterSeconds}s before requesting another code.`,
          retryAfterSeconds: err.retryAfterSeconds,
        },
      };
    }
    throw err;
  }

  const accepted: CodeAccepted = {
    requiresOtp: true,
    email,
    expiresInSeconds: Math.floor(OTP_POLICY.ttlMs / 1000),
    resendAfterSeconds: Math.floor(OTP_POLICY.resendCooldownMs / 1000),
  };

  try {
    const result = await sendMail(
      {
        to: email,
        ...renderCodeEmail(options.template, {
          code: issued.code,
          to: email,
          ttlMinutes: Math.floor(OTP_POLICY.ttlMs / 60000),
          locale: parseEmailLocale((req.body as { locale?: unknown } | undefined)?.locale),
        }),
      },
      req.log
    );

    req.log.info(
      { email, purpose: options.purpose, delivered: result.delivered },
      'otp issued'
    );

    if (!result.delivered && config.env !== 'production') {
      return { ok: true, body: { ...accepted, devCode: issued.code, delivered: false } };
    }

    return { ok: true, body: accepted };
  } catch (err) {
    await discardOtp(email).catch((cleanupErr) => {
      req.log.error({ err: cleanupErr, email }, 'failed to retire undelivered otp');
    });

    if (err instanceof MailerNotConfiguredError) {
      req.log.error('code requested but SMTP is not configured in production');
    } else {
      req.log.error({ err, email, purpose: options.purpose }, 'otp email delivery failed');
    }

    return {
      ok: false,
      status: 503,
      body: {
        error: 'email_unavailable',
        message: 'We could not send your code right now. Please try again shortly.',
      },
    };
  }
}

function bypassesOtp(role: Role, email: string): boolean {
  if (role === Role.ADMIN) return true;
  return config.otpBypassEmails.includes(email.trim().toLowerCase());
}

async function resolveReferrer(
  req: FastifyRequest,
  raw: unknown
): Promise<string | null> {
  const ref = typeof raw === 'string' ? raw.trim() : '';
  if (!ref || !REFERRAL_CODE_RE.test(ref)) return null;

  const referrer = await prisma.user.findUnique({
    where: { referralCode: ref },
    select: { id: true },
  });
  if (!referrer) req.log.info({ ref }, 'unknown referral code ignored');
  return referrer?.id ?? null;
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.get('/api/auth/me', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: identity.userId },
      select: {
        id: true,
        email: true,
        role: true,
        frozen: true,
        createdAt: true,
        referralCode: true,
        totpEnabled: true,
        telegramUsername: true,
        telegramLinkedAt: true,
        wallets: { select: { balance: true, currency: true } },
      },
    });
    if (!user) return reply.code(404).send({ error: 'user_not_found' });

    const wallet = user.wallets.find((w) => w.currency === 'USD') ?? user.wallets[0];

    return reply.send({
      id: user.id,
      email: user.email,
      role: user.role,
      frozen: user.frozen,
      createdAt: user.createdAt,
      referralCode: user.referralCode,
      totpEnabled: user.totpEnabled,
      telegram: user.telegramUsername
        ? { username: user.telegramUsername, linkedAt: user.telegramLinkedAt }
        : null,
      balance: wallet?.balance.toString() ?? '0',
      currency: wallet?.currency ?? 'USD',
    });
  });

  const handleRegisterRequestCode = async (
    req: FastifyRequest<{ Body: CredentialsBody; Querystring: RegisterQuery }>,
    reply: FastifyReply
  ) => {
    if (throttled(req.ip, 'register')) {
      return reply.code(429).send({ error: 'too_many_requests' });
    }

    if (await turnstileRejected(req, reply, 'register')) return reply;

    const credentials = parseCredentials(req.body);
    if (!credentials) {
      return reply.code(400).send({
        error: 'invalid_credentials_format',
        message: `A valid email and a password of at least ${MIN_PASSWORD} characters are required.`,
      });
    }

    const weaknesses = passwordProblems(credentials.password);
    if (weaknesses.length > 0) {
      return reply.code(400).send({
        error: 'weak_password',
        message: `Password must contain: ${weaknesses.map((w) => w.message.toLowerCase()).join(', ')}.`,
        requirements: weaknesses.map((w) => w.code),
      });
    }

    const taken = await prisma.user.findUnique({
      where: { email: credentials.email },
      select: { id: true },
    });
    if (taken) {
      return reply.code(409).send({
        error: 'email_taken',
        message: 'An account with that email already exists.',
      });
    }

    const passwordHash = await hashPassword(credentials.password);

    const delivery = await deliverCode(req, credentials.email, {
      purpose: 'REGISTER',
      passwordHash,
      template: 'register',
    });

    if (!delivery.ok) return reply.code(delivery.status).send(delivery.body);

    req.log.info({ email: credentials.email }, 'registration code sent');
    return reply.send(delivery.body);
  };

  app.post<{ Body: CredentialsBody; Querystring: RegisterQuery }>(
    '/api/auth/register/request-code',
    handleRegisterRequestCode
  );

  app.post<{ Body: CredentialsBody; Querystring: RegisterQuery }>(
    '/api/auth/register',
    handleRegisterRequestCode
  );

  app.post<{
    Body: { email?: unknown; code?: unknown };
    Querystring: RegisterQuery;
  }>('/api/auth/register/confirm', async (req, reply) => {
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\D/g, '') : '';

    if (!EMAIL_RE.test(email) || code.length !== OTP_POLICY.digits) {
      return reply.code(400).send({
        error: 'invalid_code_format',
        message: `Enter the ${OTP_POLICY.digits}-digit code from your email.`,
      });
    }

    if (throttled(req.ip, 'register-confirm', email)) {
      return reply.code(429).send({
        error: 'too_many_requests',
        message: 'Too many attempts. Please wait a few minutes and try again.',
      });
    }

    let outcome;
    try {
      outcome = await verifyOtp(email, code, 'REGISTER');
    } catch (err) {
      if (err instanceof OtpTooManyAttemptsError) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: 'Too many incorrect codes. Request a new one in a few minutes.',
        });
      }
      throw err;
    }

    if (!outcome.ok) {
      recordAccountFailure('register-confirm', email);
      req.log.warn({ email, reason: outcome.reason, ip: req.ip }, 'registration code rejected');
      return reply.code(401).send({
        error: 'invalid_code',
        message: 'That code is not valid or has expired. Request a new one.',
      });
    }

    if (!outcome.passwordHash) {
      req.log.error({ email }, 'registration intent verified without a password hash');
      return reply.code(409).send({
        error: 'registration_expired',
        message: 'That registration has expired. Please start again.',
      });
    }

    const referredById = await resolveReferrer(req, req.query?.ref);

    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash: outcome.passwordHash as string,
            role: Role.USER,
            referredById,
          },
        });

        await tx.wallet.create({ data: { userId: created.id, currency: 'USD' } });
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = err.meta?.target;
        const fields = Array.isArray(target) ? target : [String(target ?? '')];
        if (fields.some((f) => String(f).includes('email'))) {
          return reply.code(409).send({
            error: 'email_taken',
            message: 'An account with that email already exists.',
          });
        }
      }
      throw err;
    }

    clearThrottle(req.ip, 'register', email);
    clearThrottle(req.ip, 'register-confirm', email);
    req.log.info({ userId: user.id, referredById }, 'account registered after email verification');

    return reply.code(201).send({
      token: signToken(user.id, user.role, user.tokenVersion),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        referralCode: user.referralCode,
        referredBy: referredById,
      },
    });
  });

  app.post<{ Body: CredentialsBody }>('/api/auth/login', async (req, reply) => {
    const credentials = parseCredentials(req.body);

    if (throttled(req.ip, 'login', credentials?.email)) {
      req.log.warn({ ip: req.ip, email: credentials?.email }, 'sign-in throttled');
      return reply.code(429).send({
        error: 'too_many_requests',
        message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
      });
    }

    if (await turnstileRejected(req, reply, 'login')) return reply;
    const invalid = (reason: string, detail?: Record<string, unknown>) => {
      if (credentials) recordAccountFailure('login', credentials.email);
      req.log.warn({ reason, ip: req.ip, ...detail }, 'sign-in rejected');
      return reply.code(401).send({
        error: 'invalid_credentials',
        message: 'That email and password combination was not recognised.',
      });
    };

    if (!credentials) {
      return invalid('malformed_credentials');
    }

    const user = await prisma.user.findUnique({
      where: { email: credentials.email },
      select: {
        id: true,
        email: true,
        role: true,
        passwordHash: true,
        tokenVersion: true,
        frozen: true,
        createdAt: true,
        totpEnabled: true,
        wallets: { select: { balance: true, currency: true } },
      },
    });

    const hash = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
    const ok = await argon2.verify(hash, credentials.password).catch((err: unknown) => {
      req.log.error(
        { err, email: credentials.email, userId: user?.id },
        'argon2 verify threw — stored hash is unreadable'
      );
      return false;
    });

    if (!user) return invalid('unknown_email', { email: credentials.email });
    if (!ok) return invalid('wrong_password', { email: credentials.email, userId: user.id });

    clearThrottle(req.ip, 'login', credentials.email);

    if (bypassesOtp(user.role, user.email)) {
      if (user.totpEnabled) {
        req.log.info({ userId: user.id }, 'password accepted — authenticator code required');
        return reply.send({
          requiresOtp: false,
          requiresTotp: true,
          challenge: signChallenge(user.id, user.tokenVersion),
        });
      }

      const balance =
        user.wallets.find((w) => w.currency === 'USD')?.balance.toString() ?? '0';

      req.log.warn(
        { userId: user.id, role: user.role, ip: req.ip },
        'sign-in completed WITHOUT the email second factor (admin/designated bypass)'
      );

      return reply.send({
        requiresOtp: false,
        token: signToken(user.id, user.role, user.tokenVersion),
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          balance,
          frozen: user.frozen,
          createdAt: user.createdAt,
        },
      });
    }

    const delivery = await deliverCode(req, credentials.email, {
      purpose: 'LOGIN',
      template: 'login',
    });

    if (!delivery.ok) return reply.code(delivery.status).send(delivery.body);

    req.log.info({ userId: user.id, role: user.role }, 'password accepted — code sent');

    return reply.send(delivery.body);
  });

  app.post<{
    Body: { code?: unknown; redirectUri?: unknown; token?: unknown; accessToken?: unknown };
    Querystring: RegisterQuery;
  }>(
    '/api/auth/google',
    async (req, reply) => {
      if (!googleSignInEnabled()) {
        return reply.code(503).send({
          error: 'google_unavailable',
          message: 'Google sign-in is not configured on this server.',
        });
      }

      if (throttled(req.ip, 'google')) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
        });
      }

      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const accessToken =
        typeof req.body?.accessToken === 'string' ? req.body.accessToken : '';

      if (code && !googleCodeExchangeEnabled()) {
        req.log.error('google code received but GOOGLE_CLIENT_SECRET is not set — cannot exchange it');
        return reply.code(503).send({
          error: 'google_unavailable',
          message: 'Google sign-in is not fully configured on this server (missing client secret).',
        });
      }

      const redirectUri =
        typeof req.body?.redirectUri === 'string' ? req.body.redirectUri : undefined;
      if (redirectUri !== undefined && !allowedRedirectUri(redirectUri)) {
        req.log.warn({ redirectUri }, 'google code sent with a redirect_uri that is not ours');
        return reply.code(400).send({
          error: 'invalid_redirect_uri',
          message: 'Google sign-in came back to an unexpected address.',
        });
      }

      const kind = code ? 'auth_code' : accessToken ? 'access_token' : 'id_token';
      const identity = code
        ? await exchangeGoogleCode(code, redirectUri, req.log)
        : accessToken
          ? await verifyGoogleAccessToken(accessToken)
          : await verifyGoogleIdToken(typeof req.body?.token === 'string' ? req.body.token : '');
      if (!identity) {
        req.log.warn(
          { ip: req.ip, kind },
          'google sign-in rejected — token invalid, issued to another client, or email unverified'
        );
        return reply.code(401).send({
          error: 'invalid_google_token',
          message: 'Google sign-in could not be verified. Please try again.',
        });
      }

      const select = {
        id: true,
        email: true,
        role: true,
        frozen: true,
        createdAt: true,
        tokenVersion: true,
        totpEnabled: true,
        deletedAt: true,
        googleId: true,
      } as const;

      let created = false;
      let account = await prisma.user.findUnique({
        where: { googleId: identity.googleId },
        select,
      });

      if (!account) {
        const byEmail = await prisma.user.findUnique({
          where: { email: identity.email },
          select,
        });

        if (byEmail?.googleId) {
          req.log.warn(
            { userId: byEmail.id, ip: req.ip },
            'google sign-in for an email already linked to a different Google account'
          );
          return reply.code(409).send({
            error: 'google_account_mismatch',
            message: 'This email is linked to a different Google account.',
          });
        }

        if (byEmail) {
          account = await prisma.user.update({
            where: { id: byEmail.id },
            data: { googleId: identity.googleId },
            select,
          });
          req.log.info({ userId: account.id }, 'google account linked to existing user');
        } else {
          const referredById = await resolveReferrer(req, req.query?.ref);
          try {
            account = await prisma.$transaction(async (tx) => {
              const user = await tx.user.create({
                data: {
                  email: identity.email,
                  googleId: identity.googleId,
                  role: Role.USER,
                  referredById,
                },
                select,
              });
              await tx.wallet.create({ data: { userId: user.id, currency: 'USD' } });
              return user;
            });
            created = true;
            req.log.info({ userId: account.id, referredById }, 'account registered with google');
          } catch (err) {
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
              throw err;
            }
            account = await prisma.user.findUnique({
              where: { googleId: identity.googleId },
              select,
            });
            if (!account) {
              return reply.code(409).send({
                error: 'email_taken',
                message: 'An account with that email already exists.',
              });
            }
          }
        }
      }

      if (account.deletedAt) {
        return reply.code(403).send({
          error: 'account_deleted',
          message: 'This account has been deleted.',
        });
      }

      clearThrottle(req.ip, 'google');

      if (account.totpEnabled) {
        req.log.info({ userId: account.id }, 'google accepted — authenticator code required');
        return reply.send({
          requiresTotp: true,
          challenge: signChallenge(account.id, account.tokenVersion),
        });
      }

      req.log.info({ userId: account.id, created }, 'sign-in via google');

      return reply.code(created ? 201 : 200).send({
        token: signToken(account.id, account.role, account.tokenVersion),
        created,
        user: {
          id: account.id,
          email: account.email,
          role: account.role,
          frozen: account.frozen,
          createdAt: account.createdAt,
        },
      });
    }
  );

  app.post<{ Body: { email?: unknown; code?: unknown }; Querystring: RegisterQuery }>(
    '/api/auth/otp/verify',
    async (req, reply) => {
      const email =
        typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const code =
        typeof req.body?.code === 'string' ? req.body.code.replace(/\D/g, '') : '';

      if (!EMAIL_RE.test(email) || code.length !== OTP_POLICY.digits) {
        return reply.code(400).send({
          error: 'invalid_code_format',
          message: `Enter the ${OTP_POLICY.digits}-digit code from your email.`,
        });
      }

      if (throttled(req.ip, 'otp-verify', email)) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: 'Too many attempts. Please wait a few minutes and try again.',
        });
      }

      let outcome;
      try {
        outcome = await verifyOtp(email, code, 'LOGIN');
      } catch (err) {
        if (err instanceof OtpTooManyAttemptsError) {
          return reply.code(429).send({
            error: 'too_many_requests',
            message: 'Too many incorrect codes. Request a new one in a few minutes.',
          });
        }
        throw err;
      }

      if (!outcome.ok) {
        recordAccountFailure('otp-verify', email);
        req.log.warn({ email, reason: outcome.reason, ip: req.ip }, 'otp rejected');
        return reply.code(401).send({
          error: 'invalid_code',
          message: 'That code is not valid or has expired. Request a new one.',
        });
      }

      const account = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          role: true,
          frozen: true,
          createdAt: true,
          tokenVersion: true,
          totpEnabled: true,
        },
      });

      if (!account) {
        req.log.warn({ email, ip: req.ip }, 'otp verify for an address with no account');
        return reply.code(401).send({
          error: 'invalid_code',
          message: 'That code is not valid or has expired. Request a new one.',
        });
      }

      clearThrottle(req.ip, 'otp-verify', email);

      if (account.totpEnabled) {
        req.log.info({ userId: account.id }, 'email code accepted — authenticator code required');
        return reply.code(200).send({
          requiresTotp: true,
          challenge: signChallenge(account.id, account.tokenVersion),
        });
      }

      req.log.info({ userId: account.id }, 'sign-in via email code');

      return reply.code(200).send({
        token: signToken(account.id, account.role, account.tokenVersion),
        user: {
          id: account.id,
          email: account.email,
          role: account.role,
          frozen: account.frozen,
          createdAt: account.createdAt,
        },
      });
    }
  );

  app.post<{ Body: { challenge?: unknown; code?: unknown } }>(
    '/api/auth/2fa/verify',
    async (req, reply) => {
      const ticket =
        typeof req.body?.challenge === 'string' ? readChallenge(req.body.challenge) : null;
      const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

      if (!ticket) {
        return reply.code(401).send({
          error: 'challenge_expired',
          message: 'That sign-in has expired. Please start again.',
        });
      }
      if (!code) {
        return reply.code(400).send({
          error: 'invalid_code_format',
          message: 'Enter the 6-digit code from your authenticator app.',
        });
      }
      if (throttled(req.ip, 'totp-verify', ticket.userId)) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: 'Too many attempts. Please wait a few minutes and try again.',
        });
      }

      const account = await prisma.user.findUnique({
        where: { id: ticket.userId },
        select: {
          id: true,
          email: true,
          role: true,
          frozen: true,
          createdAt: true,
          tokenVersion: true,
          totpEnabled: true,
          deletedAt: true,
        },
      });
      if (!account || account.deletedAt || !account.totpEnabled || account.tokenVersion !== ticket.tv) {
        return reply.code(401).send({
          error: 'challenge_expired',
          message: 'That sign-in has expired. Please start again.',
        });
      }

      if (!(await spendSecondFactor(account.id, code))) {
        recordAccountFailure('totp-verify', account.id);
        req.log.warn({ userId: account.id, ip: req.ip }, 'authenticator code rejected');
        return reply.code(401).send({
          error: 'invalid_totp',
          message: 'That code is not valid. Check your authenticator app and try again.',
        });
      }

      clearThrottle(req.ip, 'totp-verify', account.id);
      req.log.info({ userId: account.id }, 'sign-in completed with authenticator code');

      return reply.code(200).send({
        token: signToken(account.id, account.role, account.tokenVersion),
        user: {
          id: account.id,
          email: account.email,
          role: account.role,
          frozen: account.frozen,
          createdAt: account.createdAt,
        },
      });
    }
  );

  app.post<{ Body: CredentialsBody }>(
    '/api/auth/forgot-password/request',
    async (req, reply) => {
      const email =
        typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

      if (!EMAIL_RE.test(email) || email.length > 254) {
        return reply.code(400).send({
          error: 'invalid_email',
          message: 'Enter a valid email address.',
        });
      }

      if (throttled(req.ip, 'forgot-password')) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: 'Too many reset requests. Please wait a few minutes.',
        });
      }

      if (await turnstileRejected(req, reply, 'forgot-password')) return reply;

      const accepted = {
        success: true,
        message: 'If an account exists with this email, a reset code has been sent.',
        expiresInSeconds: Math.floor(OTP_POLICY.resetTtlMs / 1000),
        resendAfterSeconds: Math.floor(OTP_POLICY.resendCooldownMs / 1000),
      };

      let issued;
      try {
        issued = await issueOtp(email, {
          purpose: 'PASSWORD_RESET',
          ttlMs: OTP_POLICY.resetTtlMs,
        });
      } catch (err) {
        if (err instanceof OtpCooldownError) {
          return reply.code(429).send({
            error: 'otp_cooldown',
            message: `Please wait ${err.retryAfterSeconds}s before requesting another code.`,
            retryAfterSeconds: err.retryAfterSeconds,
          });
        }
        throw err;
      }

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (!user) {
        req.log.info({ email }, 'password reset requested for unknown address');
        return reply.send(accepted);
      }

      try {
        const result = await sendMail(
          {
            to: email,
            ...renderCodeEmail('reset', {
              code: issued.code,
              to: email,
              ttlMinutes: Math.floor(OTP_POLICY.resetTtlMs / 60000),
              locale: parseEmailLocale(req.body?.locale),
            }),
          },
          req.log
        );

        req.log.info(
          { userId: user.id, delivered: result.delivered },
          'password reset code sent'
        );

        if (!result.delivered && config.env !== 'production') {
          return reply.send({ ...accepted, devCode: issued.code, delivered: false });
        }

        return reply.send(accepted);
      } catch (err) {
        await discardOtp(email).catch((cleanupErr) => {
          req.log.error({ err: cleanupErr, email }, 'failed to retire undelivered otp');
        });

        if (err instanceof MailerNotConfiguredError) {
          req.log.error('password reset requested but SMTP is not configured in production');
        } else {
          req.log.error({ err, email }, 'password reset email delivery failed');
        }

        return reply.code(503).send({
          error: 'email_unavailable',
          message: 'We could not send your code right now. Please try again shortly.',
        });
      }
    }
  );

  app.post<{
    Body: { email?: unknown; code?: unknown; newPassword?: unknown };
  }>('/api/auth/forgot-password/reset', async (req, reply) => {
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\D/g, '') : '';
    const newPassword =
      typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!EMAIL_RE.test(email) || code.length !== OTP_POLICY.digits) {
      return reply.code(400).send({
        error: 'invalid_code_format',
        message: `Enter the ${OTP_POLICY.digits}-digit code from your email.`,
      });
    }

    const weaknesses = passwordProblems(newPassword);
    if (weaknesses.length > 0) {
      return reply.code(400).send({
        error: 'weak_password',
        message: `Password must contain: ${weaknesses.map((w) => w.message.toLowerCase()).join(', ')}.`,
        requirements: weaknesses.map((w) => w.code),
      });
    }

    if (throttled(req.ip, 'forgot-password-reset', email)) {
      return reply.code(429).send({
        error: 'too_many_requests',
        message: 'Too many attempts. Please wait a few minutes and try again.',
      });
    }

    let outcome;
    try {
      outcome = await verifyOtp(email, code, 'PASSWORD_RESET');
    } catch (err) {
      if (err instanceof OtpTooManyAttemptsError) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: 'Too many incorrect codes. Request a new one in a few minutes.',
        });
      }
      throw err;
    }

    if (!outcome.ok) {
      recordAccountFailure('forgot-password-reset', email);
      req.log.warn({ email, reason: outcome.reason, ip: req.ip }, 'reset code rejected');
      return reply.code(401).send({
        error: 'invalid_code',
        message: 'That code is not valid or has expired. Request a new one.',
      });
    }

    const passwordHash = await hashPassword(newPassword);

    const updated = await prisma.user.updateMany({
      where: { email },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    if (updated.count === 0) {
      req.log.warn({ email }, 'reset code verified for an address with no account');
      return reply.code(401).send({
        error: 'invalid_code',
        message: 'That code is not valid or has expired. Request a new one.',
      });
    }

    clearThrottle(req.ip, 'forgot-password', email);
    clearThrottle(req.ip, 'forgot-password-reset', email);
    req.log.info({ email }, 'password reset completed');

    return reply.send({
      success: true,
      message: 'Password reset successfully. You can now sign in.',
    });
  });
}
