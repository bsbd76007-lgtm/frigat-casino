'use client';

import { forwardRef, useState, type InputHTMLAttributes } from 'react';

import { EyeIcon, EyeOffIcon } from '@/components/icons/ui';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useInjectedStyles } from '@/lib/useInjectedStyles';

const STYLE_ID = 'fg-password-input';
const CSS = `
.pwd { position: relative; display: block; }
.pwd > input { width: 100%; padding-right: 40px; }
.pwd__toggle { position: absolute; top: 50%; right: 6px; transform: translateY(-50%);
  display: grid; place-items: center; width: 28px; height: 28px; padding: 0;
  color: var(--fg-muted); background: none; border: 0; border-radius: var(--fg-r);
  cursor: pointer; transition: color var(--fg-t), background-color var(--fg-t); }
.pwd__toggle:hover:not(:disabled) { color: var(--fg-text); background: var(--fg-hover-2); }
.pwd__toggle:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.pwd__toggle:disabled { opacity: .5; cursor: not-allowed; }
`;

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { disabled, ...rest },
  ref
) {
  useInjectedStyles(STYLE_ID, CSS);
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  const label = visible ? t('auth.hidePassword') : t('auth.showPassword');

  return (
    <span className="pwd">
      <input ref={ref} {...rest} disabled={disabled} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="pwd__toggle"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={label}
        aria-pressed={visible}
        title={label}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  );
});

export default PasswordInput;
