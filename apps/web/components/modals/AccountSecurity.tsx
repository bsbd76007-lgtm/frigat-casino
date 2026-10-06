'use client';

/**
 * The account panel's security sections: authenticator two-factor, the trial
 * Telegram link, and deleting the account.
 *
 * Everything here is a request to the server and a render of what it answers —
 * enabling 2FA, linking Telegram and deleting the account are all decided and
 * enforced in apps/server/src/routes/account.routes.ts. Nothing is trusted to
 * this component: hiding a button is presentation, the route is the rule.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { apiFetch } from '@/lib/api';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameSocket } from '@/components/providers/GameSocketProvider';

interface SecurityState {
  totpEnabled: boolean;
  backupCodesRemaining: number;
  telegram: { username: string; linkedAt: string } | null;
}

/** Server error codes → locale keys. Anything unmapped falls back to a generic line. */
const ERROR_KEYS: Record<string, string> = {
  invalid_totp: 'security.totpInvalid',
  totp_not_set_up: 'security.totpRestart',
  invalid_telegram_username: 'security.tgInvalid',
  invalid_password: 'security.deletePassword',
  balance_not_empty: 'security.deleteBalance',
  withdrawal_pending: 'security.deleteWithdrawal',
  game_in_progress: 'security.deleteGame',
  admin_cannot_self_delete: 'security.deleteAdmin',
  too_many_requests: 'security.tooMany',
};

class SecurityError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(path, init);
  } catch {
    throw new SecurityError('network');
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new SecurityError(typeof body.error === 'string' ? body.error : 'unknown');
  return body as T;
}

const post = <T,>(path: string, payload: unknown = {}) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(payload) });

const STYLE_ID = 'fg-account-security-styles';

const CSS = `
.acsec { display: flex; flex-direction: column; gap: 12px; }
.acsec__card { padding: 12px; border-radius: var(--fg-r-lg); background: var(--fg-panel-2);
  border: 1px solid var(--fg-line); }
.acsec__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.acsec__title { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--fg-text); }
.acsec__desc { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--fg-muted); }
.acsec__badge { flex: 0 0 auto; padding: 2px 8px; font-size: 10.5px; font-weight: 800;
  letter-spacing: .06em; text-transform: uppercase; border-radius: var(--fg-r-pill);
  color: var(--fg-muted); border: 1px solid var(--fg-line); }
.acsec__badge--on { color: var(--fg-pos-soft); border-color: color-mix(in srgb, var(--fg-pos) 45%, transparent);
  background: color-mix(in srgb, var(--fg-pos) 12%, transparent); }
.acsec__badge--beta { color: var(--fg-gold); border-color: color-mix(in srgb, var(--fg-gold) 45%, transparent); }
.acsec__body { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.acsec__row { display: flex; gap: 8px; }
.acsec__input { flex: 1 1 auto; min-width: 0; padding: 8px 10px; font: inherit; font-size: 13px;
  color: var(--fg-text); background: var(--fg-sunken); border: 1px solid var(--fg-hairline);
  border-radius: var(--fg-r); outline: none; }
.acsec__input:focus-visible { border-color: var(--fg-accent); box-shadow: var(--fg-ring); }
.acsec__btn { flex: 0 0 auto; padding: 8px 12px; font: inherit; font-size: 12.5px; font-weight: 700;
  color: var(--fg-text); background: var(--fg-hover); border: 1px solid var(--fg-line);
  border-radius: var(--fg-r); cursor: pointer; }
.acsec__btn:hover:not(:disabled) { background: var(--fg-hover-2); }
.acsec__btn:disabled { opacity: .5; cursor: not-allowed; }
.acsec__btn:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.acsec__btn--primary { color: var(--fg-on-accent); background: var(--fg-accent-deep); border-color: transparent; }
.acsec__btn--primary:hover:not(:disabled) { background: var(--fg-accent-mid); }
.acsec__btn--danger { color: #fff; background: #b3444f; border-color: transparent; }
.acsec__btn--danger:hover:not(:disabled) { background: #c25560; }
.acsec__key { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-family: var(--fg-num);
  font-size: 12.5px; letter-spacing: .08em; word-break: break-all; color: var(--fg-text);
  background: var(--fg-sunken); border: 1px dashed var(--fg-line-2); border-radius: var(--fg-r); }
.acsec__codes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 0; padding: 0;
  list-style: none; }
.acsec__codes li { padding: 6px 8px; font-family: var(--fg-num); font-size: 12.5px; text-align: center;
  color: var(--fg-text); background: var(--fg-sunken); border-radius: var(--fg-r); }
.acsec__err { margin: 0; padding: 8px 10px; font-size: 12px; font-weight: 600; color: #d69199;
  background: rgba(240, 97, 109, .12); border: 1px solid rgba(240, 97, 109, .35); border-radius: var(--fg-r); }
.acsec__ok { margin: 0; padding: 8px 10px; font-size: 12px; font-weight: 600; color: var(--fg-pos-soft);
  background: color-mix(in srgb, var(--fg-pos) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--fg-pos) 35%, transparent); border-radius: var(--fg-r); }
.acsec__card--danger { border-color: rgba(240, 97, 109, .35); }
.acsec__card--danger .acsec__title { color: #d69199; }
.acsec-del { display: flex; flex-direction: column; gap: 8px; }
.acsec-del__ask { margin: 0; padding: 10px 12px; font-size: 13px; font-weight: 700; line-height: 1.5;
  color: #d69199; background: rgba(239,68,68,.08); border: 1px solid rgba(240, 97, 109, .35);
  border-radius: var(--fg-r); }
.acsec-del .acsec__row > .acsec__btn { flex: 1 1 0; }
`;

export function AccountSecurity() {
  useInjectedStyles(STYLE_ID, CSS);
  const { t } = useLanguage();

  const [state, setState] = useState<SecurityState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const message = (err: unknown) =>
    t(err instanceof SecurityError && ERROR_KEYS[err.code] ? ERROR_KEYS[err.code] : 'security.error');

  const load = useCallback(async () => {
    try {
      setState(await call<SecurityState>('api/account/security'));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Two-factor ──
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);

  const startSetup = async () => {
    setTotpBusy(true);
    setTotpError(null);
    try {
      setSetup(await post<{ secret: string; otpauthUri: string }>('api/account/2fa/setup'));
      setTotpCode('');
    } catch (err) {
      setTotpError(message(err));
    } finally {
      setTotpBusy(false);
    }
  };

  const confirmSetup = async (event: FormEvent) => {
    event.preventDefault();
    setTotpBusy(true);
    setTotpError(null);
    try {
      const result = await post<{ backupCodes: string[] }>('api/account/2fa/enable', { code: totpCode });
      setBackupCodes(result.backupCodes);
      setSetup(null);
      setTotpCode('');
      await load();
    } catch (err) {
      setTotpError(message(err));
    } finally {
      setTotpBusy(false);
    }
  };

  const confirmDisable = async (event: FormEvent) => {
    event.preventDefault();
    setTotpBusy(true);
    setTotpError(null);
    try {
      await post('api/account/2fa/disable', { code: totpCode });
      setDisabling(false);
      setTotpCode('');
      await load();
    } catch (err) {
      setTotpError(message(err));
    } finally {
      setTotpBusy(false);
    }
  };

  // ── Telegram ──
  const [tgName, setTgName] = useState('');
  const [tgBusy, setTgBusy] = useState(false);
  const [tgError, setTgError] = useState<string | null>(null);

  const linkTelegram = async (event: FormEvent) => {
    event.preventDefault();
    setTgBusy(true);
    setTgError(null);
    try {
      await post('api/account/telegram', { username: tgName });
      setTgName('');
      await load();
    } catch (err) {
      setTgError(message(err));
    } finally {
      setTgBusy(false);
    }
  };

  const unlinkTelegram = async () => {
    setTgBusy(true);
    setTgError(null);
    try {
      await call('api/account/telegram', { method: 'DELETE' });
      await load();
    } catch (err) {
      setTgError(message(err));
    } finally {
      setTgBusy(false);
    }
  };

  if (loadFailed) return <p className="acsec__err">{t('security.loadError')}</p>;
  if (!state) return null;

  return (
    <div className="acsec">
      {/* ── Two-factor ── */}
      <div className="acsec__card">
        <div className="acsec__head">
          <h4 className="acsec__title">{t('security.totpTitle')}</h4>
          <span className={`acsec__badge${state.totpEnabled ? ' acsec__badge--on' : ''}`}>
            {state.totpEnabled ? t('security.on') : t('security.off')}
          </span>
        </div>
        <p className="acsec__desc">{t('security.totpDesc')}</p>

        <div className="acsec__body">
          {totpError && <p className="acsec__err" role="alert">{totpError}</p>}

          {backupCodes && (
            <>
              <p className="acsec__ok" role="status">{t('security.totpEnabled')}</p>
              <p className="acsec__desc">{t('security.backupSave')}</p>
              <ul className="acsec__codes">
                {backupCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <button type="button" className="acsec__btn" onClick={() => setBackupCodes(null)}>
                {t('security.backupDone')}
              </button>
            </>
          )}

          {!state.totpEnabled && !setup && !backupCodes && (
            <div className="acsec__row">
              <button type="button" className="acsec__btn acsec__btn--primary" disabled={totpBusy} onClick={() => void startSetup()}>
                {t('security.totpSetup')}
              </button>
            </div>
          )}

          {setup && (
            <form className="acsec__body" onSubmit={confirmSetup}>
              <p className="acsec__desc">{t('security.totpStep1')}</p>
              <div className="acsec__key">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
              <a className="acsec__desc" href={setup.otpauthUri}>{t('security.totpOpenApp')}</a>
              <p className="acsec__desc">{t('security.totpStep2')}</p>
              <div className="acsec__row">
                <input
                  className="acsec__input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  aria-label={t('security.codeLabel')}
                />
                <button type="submit" className="acsec__btn acsec__btn--primary" disabled={totpBusy || totpCode.length !== 6}>
                  {t('security.totpEnable')}
                </button>
              </div>
              <button type="button" className="acsec__btn" onClick={() => setSetup(null)}>
                {t('security.cancel')}
              </button>
            </form>
          )}

          {state.totpEnabled && !backupCodes && (
            <>
              <p className="acsec__desc">
                {t('security.backupLeft', { count: state.backupCodesRemaining })}
              </p>
              {!disabling ? (
                <div className="acsec__row">
                  <button type="button" className="acsec__btn" onClick={() => { setDisabling(true); setTotpCode(''); setTotpError(null); }}>
                    {t('security.totpDisable')}
                  </button>
                </div>
              ) : (
                <form className="acsec__row" onSubmit={confirmDisable}>
                  <input
                    className="acsec__input"
                    autoComplete="one-time-code"
                    maxLength={12}
                    placeholder={t('security.codeOrBackup')}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    aria-label={t('security.codeLabel')}
                  />
                  <button type="submit" className="acsec__btn acsec__btn--danger" disabled={totpBusy || !totpCode.trim()}>
                    {t('security.totpDisableConfirm')}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Telegram (trial) ── */}
      <div className="acsec__card">
        <div className="acsec__head">
          <h4 className="acsec__title">{t('security.tgTitle')}</h4>
          <span className="acsec__badge acsec__badge--beta">{t('security.beta')}</span>
        </div>
        <p className="acsec__desc">{t('security.tgDesc')}</p>
        <div className="acsec__body">
          {tgError && <p className="acsec__err" role="alert">{tgError}</p>}
          {state.telegram ? (
            <div className="acsec__row">
              <div className="acsec__key">@{state.telegram.username}</div>
              <button type="button" className="acsec__btn" disabled={tgBusy} onClick={() => void unlinkTelegram()}>
                {t('security.tgUnlink')}
              </button>
            </div>
          ) : (
            <form className="acsec__row" onSubmit={linkTelegram}>
              <input
                className="acsec__input"
                placeholder="@username"
                autoComplete="off"
                value={tgName}
                onChange={(e) => setTgName(e.target.value)}
                aria-label={t('security.tgTitle')}
              />
              <button type="submit" className="acsec__btn acsec__btn--primary" disabled={tgBusy || !tgName.trim()}>
                {t('security.tgLink')}
              </button>
            </form>
          )}
        </div>
      </div>

    </div>
  );
}

/**
 * "Delete account" — a plain text link at the very end of the account panel.
 * It opens the confirmation in place: password, an authenticator code when
 * 2FA is on, and an "I understand" tick. The server decides and enforces
 * everything (see POST /api/account/delete).
 */
export function AccountDelete() {
  useInjectedStyles(STYLE_ID, CSS);
  const { t } = useLanguage();
  const { setToken } = useGameSocket();

  // closed → "are you sure?" → password form. Two deliberate clicks before
  // anything that can delete is even on screen.
  const [step, setStep] = useState<'closed' | 'ask' | 'form'>('closed');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = (err: unknown) =>
    t(err instanceof SecurityError && ERROR_KEYS[err.code] ? ERROR_KEYS[err.code] : 'security.error');

  // Whether the form needs a code is only worth asking once it is opened.
  useEffect(() => {
    if (step !== 'form') return;
    void call<SecurityState>('api/account/security')
      .then((s) => setTotpEnabled(s.totpEnabled))
      .catch(() => {});
  }, [step]);

  const reset = () => {
    setStep('closed');
    setPassword('');
    setCode('');
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('api/account/delete', { password, code: code || undefined });
      // Every session is already dead server-side; drop ours and leave.
      setToken(null);
      await fetch('/api/session', { method: 'DELETE' }).catch(() => {});
      window.location.replace('/');
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  if (step === 'closed') {
    return (
      <button type="button" className="acc__btn acc__btn--danger" onClick={() => setStep('ask')}>
        {t('security.deleteTitle')}
      </button>
    );
  }

  if (step === 'ask') {
    return (
      <div className="acsec-del" role="alertdialog" aria-label={t('security.deleteTitle')}>
        <p className="acsec-del__ask">{t('security.deleteAreYouSure')}</p>
        <div className="acsec__row">
          <button
            type="button"
            className="acsec__btn acsec__btn--danger"
            onClick={() => setStep('form')}
          >
            {t('security.deleteYes')}
          </button>
          <button type="button" className="acsec__btn" onClick={reset} autoFocus>
            {t('security.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="acsec-del" onSubmit={submit}>
      <p className="acsec__desc">{t('security.deleteDesc')}</p>
      {error && <p className="acsec__err" role="alert">{error}</p>}
      <input
        className="acsec__input"
        type="password"
        autoComplete="current-password"
        placeholder={t('security.deletePasswordLabel')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-label={t('security.deletePasswordLabel')}
        autoFocus
      />
      {totpEnabled && (
        <input
          className="acsec__input"
          autoComplete="one-time-code"
          maxLength={12}
          placeholder={t('security.codeOrBackup')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label={t('security.codeLabel')}
        />
      )}
      <div className="acsec__row">
        <button type="submit" className="acsec__btn acsec__btn--danger" disabled={busy || !password}>
          {busy ? t('security.deleting') : t('security.deleteForever')}
        </button>
        <button type="button" className="acsec__btn" onClick={reset}>
          {t('security.cancel')}
        </button>
      </div>
    </form>
  );
}

export default AccountSecurity;
