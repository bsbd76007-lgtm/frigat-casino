import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

export function CrashIcon({ size = 40, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const glow = `crash-glow-${uid}`;

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      <defs>
        <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        d="M7 6v35h34"
        fill="none"
        stroke="#3a475a"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      <path
        d="M9 39c7-1 12-5 15-11S29 15 35 10v29z"
        fill="#e0b055"
        opacity=".22"
      />
      <path
        d="M9 39c7-1 12-5 15-11S29 15 35 10"
        fill="none"
        stroke="#e0b055"
        strokeWidth="2.6"
        strokeLinecap="round"
        filter={`url(#${glow})`}
      />

      <g transform="rotate(38 35 10)" filter={`url(#${glow})`}>
        <path
          d="M35 2.5c2.6 2.4 4 5.6 4 9.2 0 1.6-.3 3.2-.9 4.7h-6.2c-.6-1.5-.9-3.1-.9-4.7 0-3.6 1.4-6.8 4-9.2z"
          fill="#e6f0f7"
        />
        <path d="M31 10.5 27.6 15l3.5-.6z" fill="#e0b055" />
        <path d="M39 10.5 42.4 15l-3.5-.6z" fill="#e0b055" />
        <circle cx="35" cy="10" r="1.9" fill="#0a0f14" opacity=".85" />
        <circle cx="35" cy="10" r="1.1" fill="#7fb8a6" />
        <path
          d="M33.2 16.4h3.6l-1.8 5.2z"
          fill="#d9a441"
          opacity=".9"
        />
      </g>
    </svg>
  );
}
