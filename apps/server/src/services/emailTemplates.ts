import { readFileSync } from 'fs';
import { resolve } from 'path';

import type { MailAttachment } from './mailer.service';

export type CodeEmailKind = 'register' | 'login' | 'reset';
export type EmailLocale = 'en' | 'ru';

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
  attachments: MailAttachment[];
}

interface CodeEmailCopy {
  subject: (code: string) => string;
  eyebrow: string;
  title: string;
  intro: string;
  notice: string;
  reason: string;
}

interface LocaleChrome {
  yourCode: string;
  duration: (minutes: number) => string;
  expiresLead: string;
  singleUse: string;
  textValidity: (duration: string) => string;
  preheader: (code: string, duration: string) => string;
  sentTo: (to: string, reason: string) => string;
  footer: (year: number) => string;
}

const COPY: Record<EmailLocale, Record<CodeEmailKind, CodeEmailCopy>> = {
  en: {
    register: {
      subject: (code) => `${code} is your FRIGAT verification code`,
      eyebrow: 'Account verification',
      title: 'Confirm your email',
      intro: 'Welcome to FRIGAT. Enter this code to finish creating your account.',
      notice:
        'If you did not sign up, you can safely ignore this email. No account is created until the code is entered.',
      reason: 'someone started creating a FRIGAT account with this address',
    },
    login: {
      subject: (code) => `${code} is your FRIGAT sign-in code`,
      eyebrow: 'Sign-in verification',
      title: 'Your sign-in code',
      intro: 'Use this code to finish signing in to your FRIGAT account.',
      notice:
        'If this was not you, someone may know your password. Change it right away and never share this code. FRIGAT staff will never ask you for it.',
      reason: 'a sign-in to your FRIGAT account was requested',
    },
    reset: {
      subject: (code) => `${code} is your FRIGAT password reset code`,
      eyebrow: 'Password reset',
      title: 'Reset your password',
      intro: 'Use this code to set a new password for your FRIGAT account.',
      notice:
        'If you did not ask to reset your password, ignore this email. Your password stays the same and cannot be changed without this code.',
      reason: 'a password reset was requested for your FRIGAT account',
    },
  },
  ru: {
    register: {
      subject: (code) => `${code} — код подтверждения FRIGAT`,
      eyebrow: 'Подтверждение аккаунта',
      title: 'Подтвердите email',
      intro: 'Добро пожаловать в FRIGAT. Введите этот код, чтобы завершить регистрацию.',
      notice:
        'Если вы не регистрировались, просто проигнорируйте это письмо. Аккаунт не будет создан, пока не введён код.',
      reason: 'с этим адресом начали создавать аккаунт FRIGAT',
    },
    login: {
      subject: (code) => `${code} — код для входа в FRIGAT`,
      eyebrow: 'Подтверждение входа',
      title: 'Ваш код для входа',
      intro: 'Введите этот код, чтобы завершить вход в аккаунт FRIGAT.',
      notice:
        'Если это были не вы, возможно, кто-то знает ваш пароль. Сразу смените его и никому не сообщайте этот код. Сотрудники FRIGAT никогда его не запрашивают.',
      reason: 'был запрошен вход в ваш аккаунт FRIGAT',
    },
    reset: {
      subject: (code) => `${code} — код сброса пароля FRIGAT`,
      eyebrow: 'Сброс пароля',
      title: 'Сброс пароля',
      intro: 'Введите этот код, чтобы задать новый пароль для аккаунта FRIGAT.',
      notice:
        'Если вы не запрашивали сброс пароля, проигнорируйте это письмо. Пароль останется прежним, и без этого кода его нельзя изменить.',
      reason: 'был запрошен сброс пароля для вашего аккаунта FRIGAT',
    },
  },
};

function russianMinutes(minutes: number): string {
  const mod10 = minutes % 10;
  const mod100 = minutes % 100;
  if (mod10 === 1 && mod100 !== 11) return `${minutes} минуту`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${minutes} минуты`;
  return `${minutes} минут`;
}

const CHROME: Record<EmailLocale, LocaleChrome> = {
  en: {
    yourCode: 'Your code',
    duration: (m) => `${m} minute${m === 1 ? '' : 's'}`,
    expiresLead: 'Expires in',
    singleUse: 'can be used once',
    textValidity: (d) => `Expires in ${d} and can be used once.`,
    preheader: (code, d) => `Your code is ${code}. It expires in ${d}.`,
    sentTo: (to, reason) => `This email was sent to ${to} because ${reason}.`,
    footer: (year) => `© ${year} FRIGAT · 18+ · Please play responsibly.`,
  },
  ru: {
    yourCode: 'Ваш код',
    duration: russianMinutes,
    expiresLead: 'Действует',
    singleUse: 'одноразовый',
    textValidity: (d) => `Код действует ${d}, использовать его можно один раз.`,
    preheader: (code, d) => `Ваш код: ${code}. Действует ${d}.`,
    sentTo: (to, reason) => `Это письмо отправлено на ${to}, потому что ${reason}.`,
    footer: (year) => `© ${year} FRIGAT · 18+ · Играйте ответственно.`,
  },
};

export function parseEmailLocale(value: unknown): EmailLocale {
  return value === 'ru' ? 'ru' : 'en';
}

const LOGO_CID = 'frigat-logo';
const LOGO_PATH = resolve(__dirname, '../../assets/email/frigat-monogram.png');

let logo: Buffer | null | undefined;

function loadLogo(): Buffer | null {
  if (logo !== undefined) return logo;
  try {
    logo = readFileSync(LOGO_PATH);
  } catch {
    logo = null;
  }
  return logo;
}

const C = {
  page: '#f4f6f9',
  card: '#ffffff',
  header: '#0a0a0c',
  mark: '#1f57d6',
  onMark: '#ffffff',
  text: '#10161d',
  muted: '#55616f',
  line: '#d8dee7',
  accentText: '#1d4ed8',
  codeBg: '#f4f6f9',
};

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function brandMark(hasLogo: boolean): string {
  if (hasLogo) {
    return `<td width="32" valign="middle" style="width:32px;"><img src="cid:${LOGO_CID}" width="32" height="28" alt="FRIGAT" style="display:block;width:32px;height:28px;border:0;outline:none;text-decoration:none;"></td>`;
  }
  return `<td width="32" height="32" align="center" valign="middle" style="width:32px;height:32px;background-color:${C.mark};border-radius:8px;font-family:${SANS};font-size:18px;font-weight:800;line-height:32px;color:${C.onMark};">F</td>`;
}

export function renderCodeEmail(
  kind: CodeEmailKind,
  params: { code: string; to: string; ttlMinutes: number; locale?: EmailLocale }
): RenderedMail {
  const locale = params.locale ?? 'en';
  const copy = COPY[locale][kind];
  const chrome = CHROME[locale];
  const { code, to, ttlMinutes } = params;
  const duration = chrome.duration(ttlMinutes);
  const year = new Date().getUTCFullYear();
  const subject = copy.subject(code);
  const logoBytes = loadLogo();

  const text = [
    copy.title,
    '',
    copy.intro,
    '',
    `${chrome.yourCode}: ${code}`,
    chrome.textValidity(duration),
    '',
    copy.notice,
    '',
    '—',
    chrome.sentTo(to, copy.reason),
    chrome.footer(year),
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(chrome.preheader(code, duration))}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${C.page};">
<tr>
<td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
<tr>
<td style="background-color:${C.header};border-radius:12px 12px 0 0;padding:24px 32px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0">
<tr>
${brandMark(logoBytes !== null)}
<td style="padding-left:12px;font-family:${SANS};font-size:18px;font-weight:800;letter-spacing:4px;color:#ffffff;">FRIGAT</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="background-color:${C.card};border-left:1px solid ${C.line};border-right:1px solid ${C.line};padding:32px 32px 8px 32px;font-family:${SANS};">
<p style="margin:0 0 8px 0;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.accentText};">${escapeHtml(copy.eyebrow)}</p>
<h1 style="margin:0 0 16px 0;font-size:24px;line-height:32px;font-weight:700;color:${C.text};">${escapeHtml(copy.title)}</h1>
<p style="margin:0 0 24px 0;font-size:16px;line-height:24px;color:${C.text};">${escapeHtml(copy.intro)}</p>
</td>
</tr>
<tr>
<td style="background-color:${C.card};border-left:1px solid ${C.line};border-right:1px solid ${C.line};padding:0 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr>
<td align="center" style="background-color:${C.codeBg};border:1px solid ${C.line};border-radius:12px;padding:24px 16px;">
<p style="margin:0 0 8px 0;font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">${escapeHtml(chrome.yourCode)}</p>
<p style="margin:0;font-family:${MONO};font-size:36px;line-height:44px;font-weight:700;letter-spacing:10px;padding-left:10px;color:${C.text};">${escapeHtml(code)}</p>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="background-color:${C.card};border-left:1px solid ${C.line};border-right:1px solid ${C.line};padding:16px 32px 32px 32px;font-family:${SANS};">
<p style="margin:0 0 24px 0;font-size:14px;line-height:20px;color:${C.muted};text-align:center;">${escapeHtml(chrome.expiresLead)} <strong style="color:${C.text};">${escapeHtml(duration)}</strong> &middot; ${escapeHtml(chrome.singleUse)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td style="border-top:1px solid ${C.line};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
</table>
<p style="margin:24px 0 0 0;font-size:14px;line-height:20px;color:${C.muted};">${escapeHtml(copy.notice)}</p>
</td>
</tr>
<tr>
<td style="background-color:${C.card};border:1px solid ${C.line};border-top:0;border-radius:0 0 12px 12px;font-size:0;line-height:0;height:8px;">&nbsp;</td>
</tr>
<tr>
<td align="center" style="padding:24px 16px 0 16px;font-family:${SANS};font-size:12px;line-height:20px;color:${C.muted};">
${escapeHtml(chrome.sentTo(to, copy.reason))}<br>
${escapeHtml(chrome.footer(year))}
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;

  const attachments: MailAttachment[] = logoBytes
    ? [{ filename: 'frigat.png', content: logoBytes, cid: LOGO_CID, contentType: 'image/png' }]
    : [];

  return { subject, text, html, attachments };
}
