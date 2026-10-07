import { ImageResponse } from 'next/og';

export const alt = 'FRIGAT — provably fair casino games';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BG = '#0a0a0c';
const EDGE = '#1e1e23';
const TEXT = '#f2f2f5';
const MUTED = '#9b9ba6';
const ACCENT = '#3b7cff';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: BG,
          padding: 72,
          border: `1px solid ${EDGE}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: ACCENT,
              borderRadius: 6,
              color: '#ffffff',
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            F
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 6,
              color: TEXT,
            }}
          >
            FRIGAT
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: -2,
              color: TEXT,
              maxWidth: 900,
            }}
          >
            Provably fair casino games
          </div>
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.4,
              color: MUTED,
              maxWidth: 820,
            }}
          >
            Every outcome is committed to a published seed hash before the round is
            dealt — so any round can be verified afterwards.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: 22,
            color: MUTED,
          }}
        >
          <div
            style={{
              padding: '6px 12px',
              border: `1px solid ${EDGE}`,
              borderRadius: 4,
              color: TEXT,
            }}
          >
            18+
          </div>
          <div>Gambling can be addictive. Play responsibly.</div>
        </div>
      </div>
    ),
    size
  );
}
