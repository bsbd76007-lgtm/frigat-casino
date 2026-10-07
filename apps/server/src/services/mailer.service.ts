import nodemailer, { type Transporter } from 'nodemailer';

import { config } from '../config';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  cid?: string;
  contentType?: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

export interface MailerResult {
  delivered: boolean;
  preview?: string;
}

type Logger = { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };

let transport: Transporter | null = null;
let resolved = false;

function smtpConfigured(): boolean {
  return config.smtp.host.length > 0;
}

function getTransport(): Transporter | null {
  if (resolved) return transport;
  resolved = true;

  if (!smtpConfigured()) {
    transport = null;
    return null;
  }

  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    ...(config.smtp.user
      ? { auth: { user: config.smtp.user, pass: config.smtp.pass } }
      : {}),
  });

  return transport;
}

export class MailerNotConfiguredError extends Error {
  constructor() {
    super('SMTP is not configured and the development fallback is disabled');
    this.name = 'MailerNotConfiguredError';
  }
}

export async function sendMail(mail: Mail, log: Logger): Promise<MailerResult> {
  const smtp = getTransport();

  if (!smtp) {
    if (config.env === 'production') throw new MailerNotConfiguredError();

    log.warn(
      { to: mail.to, subject: mail.subject, body: mail.text },
      'SMTP not configured — email logged instead of sent (development only)'
    );
    return { delivered: false, preview: mail.text };
  }

  await smtp.sendMail({
    from: config.smtp.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
    ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
  });

  log.info({ to: mail.to, subject: mail.subject }, 'email sent');
  return { delivered: true };
}

export function isMailerLive(): boolean {
  return getTransport() !== null;
}
