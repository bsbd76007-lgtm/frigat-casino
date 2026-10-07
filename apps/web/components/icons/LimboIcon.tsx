import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

export function LimboIcon({ size = 40, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const glow = `limbo-glow-${uid}`;

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
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <line
        x1="6"
        y1="16"
        x2="42"
        y2="16"
        stroke="#8b97a6"
        strokeWidth="1.6"
        strokeDasharray="3.2 3.4"
        strokeLinecap="round"
        opacity=".7"
      />
      <text
        x="6"
        y="12.5"
        fontSize="7"
        fontWeight="700"
        fill="#8b97a6"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        TARGET
      </text>

      <path
        d="M7 6v35h34"
        fill="none"
        stroke="#232d3a"
        strokeWidth="1.4"
        strokeLinecap="round"
      />

      <path
        d="M9 37c8-2 13-8 16-15s6-11 12-14"
        fill="none"
        stroke="#d9a441"
        strokeWidth="2.6"
        strokeLinecap="round"
        filter={`url(#${glow})`}
      />

      <g filter={`url(#${glow})`}>
        <circle cx="37" cy="8.5" r="4.6" fill="#d9a441" />
        <circle cx="37" cy="8.5" r="4.6" fill="none" stroke="#fff6d8" strokeWidth=".8" opacity=".6" />
      </g>

      <path
        d="M27 22.5l3.2 3.2m0-3.2-3.2 3.2"
        stroke="#d9a441"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity=".85"
      />
    </svg>
  );
}
