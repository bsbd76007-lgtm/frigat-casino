'use client';

import {

  LOCALES,
  useLanguage,
  type Locale,
} from '@/components/providers/LanguageProvider';

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLanguage();

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = LOCALES[(index + delta + LOCALES.length) % LOCALES.length];
    setLocale(next.code as Locale);
  };

  return (
    <div className="lang" role="radiogroup" aria-label={t('header.language')}>
      {LOCALES.map((item, index) => {
        const active = item.code === locale;
        return (
          <button
            key={item.code}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={active ? 'lang__pill lang__pill--on' : 'lang__pill'}
            onClick={() => setLocale(item.code as Locale)}
            onKeyDown={(event) => onKeyDown(event, index)}
            title={item.label}
            lang={item.code}
          >
            {item.short}
          </button>
        );
      })}
    </div>
  );
}
