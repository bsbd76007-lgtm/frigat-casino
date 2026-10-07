import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '@/lib/adminAuth';
import { API_URL } from '@/lib/endpoints';
import { formatDecimalString } from '@/lib/decimal';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface AdminMetrics {
  ggr: string;
  totalWagered: string;
  totalPayout: string;
  totalPlayers: number;
  activeConnections: number;
  totalBets: number;
  rtpPercent: string;
  houseEdgePercent: string;
  activePlayersToday: number;
  betsToday: number;
  ggrToday: string;
  pendingWithdrawalCount: number;
  pendingWithdrawalAmount: string;
  generatedAt: string;
}

type MetricsResult =
  | { ok: true; metrics: AdminMetrics }
  | { ok: false; reason: string };

async function loadMetrics(): Promise<MetricsResult> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { ok: false, reason: 'No admin session cookie was present.' };

  const base = API_URL;

  try {
    const response = await fetch(`${base}/api/admin/metrics`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        reason: 'The game server rejected this admin token. It may have expired.',
      };
    }
    if (!response.ok) {
      return { ok: false, reason: `Metrics API returned ${response.status}.` };
    }
    return { ok: true, metrics: (await response.json()) as AdminMetrics };
  } catch {
    return {
      ok: false,
      reason: `Could not reach the game server at ${base}. Is it running?`,
    };
  }
}

function Metric({
  label,
  value,
  note,
  tone,
  live,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'positive' | 'negative';
  live?: boolean;
}) {
  return (
    <article className="metric">
      <h2 className="metric__label">
        {live && <span className="metric__live" aria-hidden="true" />}
        {label}
      </h2>
      <p
        className={`metric__value${tone ? ` metric__value--${tone}` : ''}`}
        aria-label={`${label}: ${value}`}
      >
        {value}
      </p>
      {note && <p className="metric__note">{note}</p>}
    </article>
  );
}

export default async function AdminDashboardPage() {
  const result = await loadMetrics();

  return (
    <>
      <header className="admin__head">
        <h1 className="admin__title">Dashboard</h1>
        <p className="admin__sub">
          {result.ok
            ? `Live platform totals · generated ${new Date(
                result.metrics.generatedAt
              ).toUTCString()}`
            : 'Live platform totals'}
        </p>
      </header>

      {!result.ok ? (
        <div className="admin__error" role="alert">
          <strong>Metrics unavailable.</strong> {result.reason}
          <br />
          They are served by <code>GET /api/admin/metrics</code> on the game
          server, which is the only component that can report live socket
          counts.
        </div>
      ) : (
        <>
          <section className="metrics">
            <Metric
              label="Total Revenue (GGR)"
              value={`$${formatDecimalString(result.metrics.ggr, 2)}`}
              tone={result.metrics.ggr.startsWith('-') ? 'negative' : 'positive'}
              note={`$${formatDecimalString(result.metrics.ggrToday, 2)} today`}
            />
            <Metric
              label="Active Players Today"
              value={result.metrics.activePlayersToday.toLocaleString()}
              live
              note={`${result.metrics.betsToday.toLocaleString()} bets · ${result.metrics.activeConnections} online now`}
            />
            <Metric
              label="Pending Payout Requests"
              value={`$${formatDecimalString(result.metrics.pendingWithdrawalAmount, 2)}`}
              tone={result.metrics.pendingWithdrawalCount > 0 ? 'negative' : undefined}
              note={`${result.metrics.pendingWithdrawalCount} awaiting approval`}
            />
            <Metric
              label="House Edge"
              value={`${result.metrics.houseEdgePercent}%`}
              tone={
                result.metrics.totalBets === 0
                  ? undefined
                  : Number(result.metrics.houseEdgePercent) < 0.5
                    ? 'negative'
                    : 'positive'
              }
              note={`${result.metrics.rtpPercent}% RTP · ${result.metrics.totalBets.toLocaleString()} bets`}
            />
          </section>

          <section className="metrics">
            <Metric
              label="Total Wagered"
              value={`$${formatDecimalString(result.metrics.totalWagered, 2)}`}
              note={`$${formatDecimalString(result.metrics.totalPayout, 2)} paid out`}
            />
            <Metric
              label="Registered Players"
              value={result.metrics.totalPlayers.toLocaleString()}
              note="All-time accounts"
            />
          </section>
        </>
      )}
    </>
  );
}
