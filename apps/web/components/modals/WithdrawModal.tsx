'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { CurrencyGrid, paymentEndpoint, type CurrencyCode } from '@/components/modals/CurrencyGrid';

import { apiJson, ApiError } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { formatDecimalString } from '@/lib/decimal';
import { useLanguage } from '@/components/providers/LanguageProvider';

interface WithdrawalResult {
  withdrawalId: string;
  status: string;
  amount: string;
  amountCurrency: 'USD';
  payoutAmount: string | null;
  exchangeRateUsdt: string | null;
  exchangeRateSource: 'BINANCE' | 'USDT_PEG' | null;
  currency: string;
  address: string;
  balance: string;
  review?: boolean;
}

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,8})?$/;

function addressLooksValid(value: string): boolean {
  return value.length >= 20 && value.length <= 128 && /^[a-zA-Z0-9:_-]+$/.test(value);
}

const MIN_WITHDRAWAL = 10;

function messageForError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return 'Could not submit the withdrawal. Please try again.';
  }
  switch (err.message) {
    case 'insufficient_funds':
      return 'Your balance changed and no longer covers this amount.';
    case 'account_frozen':
      return 'This account is frozen. Contact support to withdraw.';
    case 'invalid_address':
      return 'That does not look like a valid wallet address.';
    case 'wallet_not_found':
      return 'No wallet found for this account yet.';
    case 'payments_unavailable':
      return 'Withdrawals are temporarily unavailable. Please try again later.';
    default:
      return err.message;
  }
}

export default function WithdrawModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose?: () => void;
}) {
  const { balance } = useGameSocket();
  const { t } = useLanguage();

  const [currency, setCurrency] = useState<CurrencyCode>('USDT');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WithdrawalResult | null>(null);

  const [touched, setTouched] = useState({ amount: false, address: false });

  useEffect(() => {
    if (open) return;
    setAmount('');
    setAddress('');
    setError(null);
    setResult(null);
    setTouched({ amount: false, address: false });
  }, [open]);

  const available = balance.balance;

  const amountValid = useMemo(
    () => AMOUNT_PATTERN.test(amount) && Number(amount) > 0,
    [amount]
  );
  const addressValid = useMemo(() => addressLooksValid(address.trim()), [address]);

  const exceedsBalance = useMemo(() => {
    if (!amountValid || available === null) return false;
    return Number(amount) > Number(available);
  }, [amount, amountValid, available]);

  const belowMinimum = amountValid && Number(amount) < MIN_WITHDRAWAL;

  const canSubmit =
    amountValid &&
    !belowMinimum &&
    addressValid &&
    !exceedsBalance &&
    !loading &&
    available !== null;

  const showAmountError = touched.amount && amount.length > 0 && !amountValid;
  const showAddressError = touched.address && address.length > 0 && !addressValid;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const path = paymentEndpoint('/api/payments/withdraw');

    try {
      const response = await apiJson<WithdrawalResult>(path, {
        method: 'POST',
        body: JSON.stringify({ amount, currency, address: address.trim() }),
      });

      showToast(
        response.review === false
          ? 'Withdrawal request submitted! Funds are on their way.'
          : 'Withdrawal request submitted! Pending admin review.',
        'success',
        6000
      );
      setResult(response);
      onClose?.();
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setLoading(false);
    }
  }, [amount, address, currency, canSubmit, onClose]);

  const setMax = useCallback(() => {
    if (available === null) return;
    const [whole, fraction = ''] = available.split('.');
    setAmount(fraction ? `${whole}.${fraction.slice(0, 8)}` : whole);
    setTouched((prev) => ({ ...prev, amount: true }));
  }, [available]);

  if (result) {
    return (
      <>
        <div className="wal__banner wal__banner--ok" role="status">
          <b>{t('wallet.wdSubmitted')}</b>
          <span>
            Your funds will be dispatched shortly.
            {result.review
              ? ` $${formatDecimalString(result.amount, 2)} ${result.amountCurrency} is reserved. ${
                  result.payoutAmount
                    ? `Estimated payout: ${result.payoutAmount} ${result.currency} at ${formatDecimalString(result.exchangeRateUsdt ?? '1', 2)} USDT per ${result.currency}.`
                    : `An administrator will determine the ${result.currency} payout amount because a current quote was unavailable.`
                }`
              : ` $${formatDecimalString(result.amount, 2)} ${result.amountCurrency} has been reserved. Payout: ${result.payoutAmount} ${result.currency} at ${formatDecimalString(result.exchangeRateUsdt ?? '1', 2)} USDT per ${result.currency}.`}
          </span>
        </div>

        <div className="wal__field">
          <span className="wal__label">{t('wallet.wdDestination')}</span>
          <code className="wal__addr">{result.address}</code>
        </div>
        <div className="wal__field">
          <span className="wal__label">{t('wallet.wdRemaining')}</span>
          <code>{formatDecimalString(result.balance, 2)}</code>
        </div>

        <button
          type="button"
          className="wal__btn wal__btn--ghost"
          onClick={() => setResult(null)}
        >
          Make another withdrawal
        </button>
      </>
    );
  }

  return (
    <>
      <div className="wal__balance">
        <span>{t('wallet.wdAvailable')}</span>
        <b>
          {balance.hasSynced ? formatDecimalString(available ?? '0', 2) : '—'}{' '}
          {balance.currency}
        </b>
      </div>

      <CurrencyGrid value={currency} onChange={setCurrency} />

      <div className="wal__field">
        <label className="wal__label" htmlFor="withdraw-amount">
          Amount (USD)
        </label>
        <div className="wal__row">
          <input
            id="withdraw-amount"
            className="wal__input"
            inputMode="decimal"
            placeholder={`${MIN_WITHDRAWAL}.00`}
            value={amount}
            onChange={(event) => setAmount(event.target.value.trim())}
            onBlur={() => setTouched((prev) => ({ ...prev, amount: true }))}
            aria-invalid={showAmountError || exceedsBalance}
          />
          <button
            type="button"
            className="wal__max"
            onClick={setMax}
            disabled={available === null}
          >
            MAX
          </button>
        </div>
      </div>

      <div className="wal__field">
        <label className="wal__label" htmlFor="withdraw-address">
          {currency} wallet address
        </label>
        <input
          id="withdraw-address"
          className="wal__input"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('wallet.wdAddressPlaceholder')}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, address: true }))}
          aria-invalid={showAddressError}
        />
      </div>

      <p className="wal__hint">{t('wallet.wdMinNote', { amount: `$${MIN_WITHDRAWAL}` })}</p>

      {showAmountError && (
        <p className="wal__error">{t('wallet.wdBadAmount')}</p>
      )}
      {belowMinimum && touched.amount && (
        <p className="wal__error">{t('wallet.wdBelowMin', { amount: `$${MIN_WITHDRAWAL}` })}</p>
      )}
      {exceedsBalance && (
        <p className="wal__error">{t('wallet.wdTooMuch')}</p>
      )}
      {showAddressError && (
        <p className="wal__error">{t('wallet.wdBadAddress')}</p>
      )}
      {error && <p className="wal__error">{error}</p>}

      <p className="wal__hint">
        Double-check the address and network. Withdrawals sent on the wrong
        network cannot be recovered.
      </p>

      <button
        type="button"
        className="wal__btn wal__btn--primary"
        onClick={submit}
        disabled={!canSubmit}
      >
        {loading ? 'Submitting…' : 'Request Withdrawal'}
      </button>
    </>
  );
}
