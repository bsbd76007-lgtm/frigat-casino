import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';


loadEnv({ path: resolve(__dirname, '../../.env') });
loadEnv({ path: resolve(__dirname, '../../../../.env') });

export const MIN_JWT_SECRET_LENGTH = 32;

function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET ?? '';
  if (secret.length >= MIN_JWT_SECRET_LENGTH) return secret;

  console.error(
    `[config] FATAL: JWT_SECRET is ${secret ? `only ${secret.length} characters` : 'not set'}. ` +
      `It must be at least ${MIN_JWT_SECRET_LENGTH} characters in every environment. ` +
      'Generate one with: openssl rand -base64 32'
  );
  process.exit(1);
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const DEPLOYED_WEB_ORIGIN = 'https://frigat-web.onrender.com';

function splitOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function dedupe(origins: string[]): string[] {
  return [...new Set(origins)];
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  host: optional('HOST', '0.0.0.0'),
  port: parseInt(optional('PORT', '4000'), 10),

  jwtSecret: requireJwtSecret(),

  jwtExpiresIn: optional('JWT_EXPIRES_IN', '12h'),

  databaseUrl: optional(
    'DATABASE_URL',
    'postgresql://frigat:frigat@localhost:5432/frigat?schema=public'
  ),

  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),

  google: {
    clientId: optional('GOOGLE_CLIENT_ID', ''),
    clientSecret: optional('GOOGLE_CLIENT_SECRET', ''),
  },

  smtp: {
    host: optional('SMTP_HOST', ''),
    port: parseInt(optional('SMTP_PORT', '587'), 10),
    user: optional('SMTP_USER', ''),
    pass: optional('SMTP_PASS', ''),
    from: optional('SMTP_FROM', 'FRIGAT <no-reply@frigat.local>'),
  },

  nowpayments: {
    apiKey: optional('NOWPAYMENTS_API_KEY', ''),
    ipnSecret: optional('NOWPAYMENTS_IPN_SECRET', ''),
    apiBase: optional('NOWPAYMENTS_API_BASE', 'https://api.nowpayments.io/v1'),
    ipnCallbackUrl: optional('NOWPAYMENTS_IPN_CALLBACK_URL', ''),
    payoutEmail: optional('NOWPAYMENTS_PAYOUT_EMAIL', ''),
    payoutPassword: optional('NOWPAYMENTS_PAYOUT_PASSWORD', ''),
  },

  paymentsProvider: optional(
    'PAYMENTS_PROVIDER',
    process.env.NOWPAYMENTS_API_KEY ? 'NOWPAYMENTS' : 'CRYPTOMUS'
  ).toUpperCase(),

  cryptomus: {
    merchantId: optional('CRYPTOMUS_MERCHANT_ID', ''),
    apiKey: optional('CRYPTOMUS_API_KEY', ''),
    payoutApiKey: optional('CRYPTOMUS_PAYOUT_API_KEY', ''),
    apiBase: optional('CRYPTOMUS_API_BASE', 'https://api.cryptomus.com/v1'),
    webhookUrl: optional('CRYPTOMUS_WEBHOOK_URL', ''),
    returnUrl: optional('CRYPTOMUS_RETURN_URL', ''),
  },

  otpBypassEmails: optional('AUTH_OTP_BYPASS_EMAILS', '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),

  turnstile: {
    secretKey: optional('TURNSTILE_SECRET_KEY', ''),
    disabled: ['true', '1'].includes(optional('TURNSTILE_DISABLED', '').toLowerCase()),
    verifyUrl: optional(
      'TURNSTILE_VERIFY_URL',
      'https://challenges.cloudflare.com/turnstile/v0/siteverify'
    ),
  },

  webOrigins: dedupe([
    DEPLOYED_WEB_ORIGIN,
    ...splitOrigins(process.env.CORS_ORIGIN),
    ...splitOrigins(process.env.CLIENT_URL),
    ...splitOrigins(process.env.WEB_ORIGINS),
    ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000']),
  ]),
} as const;

