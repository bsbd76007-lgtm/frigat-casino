import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

export function AviaIcon({ size = 48, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const glow = `avia-glow-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title && <title>{title}</title>}
      <defs>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect x="4" y="34" width="40" height="10" rx="2" fill="#0b1622" />
      <rect x="6" y="36" width="24" height="3" rx="1.5" fill="#1e293b" />
      <path d="M8 37.5h20" stroke="var(--fg-gold)" strokeWidth="1" strokeDasharray="3 3" />

      <path
        d="M9 33C17 31 25 25 31 15"
        stroke="var(--fg-accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="2.5 3.5"
        opacity=".75"
      />

      <g filter={`url(#${glow})`} transform="rotate(-28 30 16)">
        <path
          d="M22 16.4c0-1.2 1-2.1 2.2-2.1h11.3c1.9 0 3.6 1 4.5 2.1-.9 1.2-2.6 2.1-4.5 2.1H24.2c-1.2 0-2.2-.9-2.2-2.1z"
          fill="#c25560"
        />
        <rect x="27" y="10.6" width="3.4" height="11.6" rx="1.5" fill="#e5e7eb" />
        <rect x="30.5" y="13" width="2.4" height="6.8" rx="1.1" fill="#cbd5e1" />
        <path d="M22.4 13.6h3.2l-1.4 2.8h-2.6z" fill="#e5e7eb" />
        <circle cx="33" cy="16.4" r="1.5" fill="#0f172a" opacity=".8" />
        <rect x="39.6" y="12.6" width="1.3" height="7.6" rx="0.65" fill="var(--fg-gold)" />
      </g>
    </svg>
  );
}

export default AviaIcon;
