'use client';

import { useRef, type ClipboardEvent } from 'react';

export const OTP_DIGITS = 6;

export function emptyDigits(): string[] {
  return Array(OTP_DIGITS).fill('');
}

export interface OtpDigitsProps {
  digits: string[];
  onDigitsChange: (digits: string[]) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
  idPrefix?: string;
  label?: string;
}

export function OtpDigits({
  digits,
  onDigitsChange,
  onComplete,
  disabled = false,
  idPrefix = 'otp',
  label = 'Verification code',
}: OtpDigitsProps) {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const labelId = `${idPrefix}-code-label`;

  const focusBox = (index: number) => {
    boxes.current[Math.max(0, Math.min(index, OTP_DIGITS - 1))]?.focus();
  };

  const setDigit = (index: number, raw: string) => {
    const value = raw.replace(/\D/g, '');
    if (!value) {
      onDigitsChange(digits.map((d, i) => (i === index ? '' : d)));
      return;
    }

    const next = [...digits];
    for (let i = 0; i < value.length && index + i < OTP_DIGITS; i += 1) {
      next[index + i] = value[i];
    }
    onDigitsChange(next);

    if (next.every((entry) => entry !== '')) onComplete(next.join(''));

    focusBox(index + value.length);
  };

  const onKeyDown = (index: number, key: string) => {
    if (key === 'Backspace' && !digits[index] && index > 0) focusBox(index - 1);
    if (key === 'ArrowLeft' && index > 0) focusBox(index - 1);
    if (key === 'ArrowRight' && index < OTP_DIGITS - 1) focusBox(index + 1);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, OTP_DIGITS);
    if (!pasted) return;
    event.preventDefault();

    const next = emptyDigits();
    for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i];
    onDigitsChange(next);

    if (pasted.length === OTP_DIGITS) onComplete(pasted);
    else focusBox(pasted.length);
  };

  return (
    <div className="auth__field">
      <span className="auth__label" id={labelId}>
        {label}
      </span>
      <div className="auth__otp" role="group" aria-labelledby={labelId}>
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              boxes.current[index] = el;
            }}
            className="auth__otp-box"
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={OTP_DIGITS}
            value={digit}
            disabled={disabled}
            aria-label={`Digit ${index + 1} of ${OTP_DIGITS}`}
            onChange={(event) => setDigit(index, event.target.value)}
            onKeyDown={(event) => onKeyDown(index, event.key)}
            onPaste={onPaste}
            onFocus={(event) => event.currentTarget.select()}
          />
        ))}
      </div>
    </div>
  );
}

export function focusFirstOtpBox(): void {
  window.setTimeout(() => {
    const first = document.querySelector<HTMLInputElement>('.auth__otp-box');
    first?.focus();
  }, 50);
}

export default OtpDigits;
