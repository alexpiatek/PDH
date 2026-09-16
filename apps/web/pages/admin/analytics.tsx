import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import {
  Activity,
  BarChart3,
  CircleDollarSign,
  Gauge,
  LogOut,
  RefreshCw,
  Shield,
  TrendingUp,
  Users,
} from 'lucide-react';
import { BondiPokerLogo } from '../../components/BondiPokerLogo';
import type { PlayerTestingDashboard } from '../../lib/playerTestingAnalyticsServer';

type LoadState = 'idle' | 'loading' | 'ready' | 'locked' | 'error';

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return new Intl.NumberFormat().format(value);
}

function formatSigned(value: number): string {
  if (value > 0) return `+${formatNumber(value)}`;
  return formatNumber(value);
}

function formatDate(value: string | null): string {
  if (!value) return 'Active';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function signalClass(signal: 'low' | 'medium' | 'high'): string {
  if (signal === 'high') return 'border-emerald-300/45 bg-emerald-400/[0.08] text-emerald-100';
  if (signal === 'medium') return 'border-amber-300/45 bg-amber-300/[0.08] text-amber-100';
  return 'border-zinc-500/45 bg-white/[0.035] text-zinc-200';
}

const AdminAnalyticsPage: NextPage = () => {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<PlayerTestingDashboard | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [adminName, setAdminName] = useState('');

  const maxEntrySessions = useMemo(
    () => Math.max(1, ...(dashboard?.entryPoints.map((entry) => entry.sessions) ?? [1])),
    [dashboard?.entryPoints]
  );
  const maxEventCount = useMemo(
    () => Math.max(1, ...(dashboard?.topEvents.map((event) => event.events) ?? [1])),
    [dashboard?.topEvents]
  );
  const maxChipStack = useMemo(
    () => Math.max(1, ...(dashboard?.chipTrend.map((point) => point.avgStack) ?? [1])),
    [dashboard?.chipTrend]
  );

  const loadDashboard = async () => {
    setLoadState('loading');
    setError('');
    try {
      const response = await fetch('/api/admin/player-analytics');
      if (response.status === 401) {
        setLoadState('locked');
        setDashboard(null);
        await router.push('/admin/login');
        return;
      }
      if (!response.ok) {
        throw new Error(`Dashboard request failed with HTTP ${response.status}`);
      }
      const payload = (await response.json()) as PlayerTestingDashboard;
      setDashboard(payload);
      setLoadState('ready');
    } catch (loadError) {
      setLoadState('error');
      setError(loadError instanceof Error ? loadError.message : 'Dashboard request failed.');
    }
  };

  useEffect(() => {
    void fetch('/api/admin/me')
      .then(async (response) => {
        if (response.status === 401) {
          await router.push('/admin/login');
          return;
        }
        const payload = (await response.json()) as {
          authenticated?: boolean;
          username?: string;
          localDev?: boolean;
        };
        if (payload.authenticated) {
          setAdminName(payload.localDev ? 'Local admin' : payload.username || 'Admin');
          await loadDashboard();
        } else {
          await router.push('/admin/login');
        }
      })
      .catch((meError) => {
        setLoadState('error');
        setError(meError instanceof Error ? meError.message : 'Admin check failed.');
      });
  }, [router]);

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    await router.push('/admin/login');
  };

  const summary = dashboard?.summary;
  const kpis = [
    {
      label: 'Profiles',
      value: formatNumber(summary?.profiles),
      icon: Users,
    },
    {
      label: 'Sessions',
      value: formatNumber(summary?.sessions),
      icon: Activity,
    },
    {
      label: 'Hands Seen',
      value: formatNumber(summary?.handsSeen),
      icon: BarChart3,
    },
    {
      label: 'Actions',
      value: formatNumber(summary?.actionsTaken),
      icon: Gauge,
    },
    {
      label: 'Rebuys',
      value: formatNumber(summary?.rebuys),
      icon: CircleDollarSign,
    },
    {
      label: 'Avg Minutes',
      value: summary?.avgSessionMinutes === null ? '-' : formatNumber(summary?.avgSessionMinutes),
      icon: TrendingUp,
    },
  ];

  return (
    <>
      <Head>
        <title>Admin Analytics | BondiPoker</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <main className="min-h-screen bg-[#03080b] text-zinc-100">
        <div className="border-b border-amber-300/35 bg-[#03080b]/86">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <BondiPokerLogo href="/play" variant="nav" className="w-40 max-w-[58vw]" />
              <div className="hidden h-10 w-px bg-white/10 sm:block" />
              <div>
                <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-200">
                  <Shield aria-hidden="true" className="h-4 w-4" />
                  Admin
                </div>
                <h1 className="mt-1 font-[var(--font-serif)] text-2xl font-semibold text-white">
                  Playtest Analytics
                </h1>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {adminName ? (
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-300">
                  {adminName}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void loadDashboard()}
                disabled={loadState === 'loading'}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-teal-200/50 bg-teal-400/[0.14] px-4 py-2 text-sm font-semibold text-teal-100 transition hover:border-teal-200/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`h-4 w-4 ${loadState === 'loading' ? 'animate-spin' : ''}`}
                />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.035] px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-rose-200/50 hover:text-rose-100"
              >
                <LogOut aria-hidden="true" className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>
        </div>

        <section className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
          {loadState === 'locked' ? (
            <div className="rounded-lg border border-amber-300/35 bg-amber-300/[0.08] p-5 text-amber-50">
              Enter the admin analytics passcode and refresh.
            </div>
          ) : null}

          {loadState === 'error' ? (
            <div className="rounded-lg border border-rose-300/45 bg-rose-500/10 p-5 text-rose-100">
              {error}
            </div>
          ) : null}

          {dashboard ? (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 text-sm text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  Source: <span className="font-semibold text-zinc-200">{dashboard.source}</span>
                  {dashboard.error ? (
                    <span className="text-amber-200"> - {dashboard.error}</span>
                  ) : null}
                </div>
                <div>Updated {formatDate(dashboard.updatedAt)}</div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                {kpis.map((kpi) => {
                  const Icon = kpi.icon;
                  return (
                    <div
                      key={kpi.label}
                      className="rounded-lg border border-white/10 bg-white/[0.035] p-4"
                    >
                      <Icon aria-hidden="true" className="h-5 w-5 text-teal-300" />
                      <div className="mt-3 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        {kpi.label}
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-white">{kpi.value}</div>
                    </div>
                  );
                })}
              </div>

              <section>
                <h2 className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
                  What To Improve Next
                </h2>
                <div className="mt-3 grid gap-3 lg:grid-cols-5">
                  {dashboard.decisions.map((decision) => (
                    <div
                      key={decision.area}
                      className={`rounded-lg border p-4 ${signalClass(decision.signal)}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">{decision.label}</div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em]">
                          {decision.signal}
                        </div>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-black/30">
                        <div
                          className="h-full rounded-full bg-current"
                          style={{ width: `${Math.max(4, Math.min(100, decision.score))}%` }}
                        />
                      </div>
                      <p className="mt-3 text-sm leading-5 opacity-85">{decision.recommendation}</p>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                <section className="rounded-lg border border-white/10 bg-white/[0.025] p-5">
                  <h2 className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
                    Entry Paths
                  </h2>
                  <div className="mt-4 space-y-3">
                    {dashboard.entryPoints.length ? (
                      dashboard.entryPoints.map((entry) => (
                        <div key={entry.entryPoint}>
                          <div className="flex justify-between gap-3 text-sm">
                            <span className="text-zinc-200">{entry.entryPoint}</span>
                            <span className="font-semibold text-white">{entry.sessions}</span>
                          </div>
                          <div className="mt-1 h-2 rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-teal-300"
                              style={{
                                width: `${Math.max(4, (entry.sessions / maxEntrySessions) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-zinc-500">No sessions captured yet.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-lg border border-white/10 bg-white/[0.025] p-5">
                  <h2 className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
                    Top Events
                  </h2>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {dashboard.topEvents.length ? (
                      dashboard.topEvents.map((event) => (
                        <div
                          key={event.eventType}
                          className="rounded-md border border-white/10 bg-black/20 px-3 py-2.5"
                        >
                          <div className="flex justify-between gap-3 text-sm">
                            <span className="truncate text-zinc-200">{event.eventType}</span>
                            <span className="font-semibold text-white">{event.events}</span>
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-amber-200"
                              style={{
                                width: `${Math.max(4, (event.events / maxEventCount) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-zinc-500">No events captured yet.</p>
                    )}
                  </div>
                </section>
              </div>

              <section className="rounded-lg border border-white/10 bg-white/[0.025] p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
                    Chip Trend
                  </h2>
                  <div className="text-sm text-zinc-500">Hourly average stack and net delta</div>
                </div>
                <div className="mt-5 flex h-40 items-end gap-2 overflow-x-auto">
                  {dashboard.chipTrend.length ? (
                    dashboard.chipTrend.map((point) => (
                      <div
                        key={point.bucket}
                        className="flex min-w-12 flex-1 flex-col items-center gap-2"
                      >
                        <div className="flex h-28 w-full items-end rounded-md bg-black/20 px-1">
                          <div
                            className="w-full rounded-t bg-teal-300/80"
                            style={{
                              height: `${Math.max(6, (point.avgStack / maxChipStack) * 100)}%`,
                            }}
                            title={`${formatNumber(point.avgStack)} avg stack`}
                          />
                        </div>
                        <div
                          className={`text-xs font-semibold ${
                            point.netDelta >= 0 ? 'text-emerald-200' : 'text-rose-200'
                          }`}
                        >
                          {formatSigned(point.netDelta)}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="self-start text-sm text-zinc-500">No chip ledger entries yet.</p>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-white/10 bg-white/[0.025] p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
                    Recent Sessions
                  </h2>
                  <a
                    href="/admin/login"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-teal-100 hover:text-teal-50"
                  >
                    <Shield aria-hidden="true" className="h-4 w-4" />
                    Admin-only access
                  </a>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                    <thead className="text-[0.66rem] uppercase tracking-[0.16em] text-zinc-500">
                      <tr>
                        <th className="border-b border-white/10 py-3 pr-4 font-semibold">Player</th>
                        <th className="border-b border-white/10 px-4 py-3 font-semibold">Entry</th>
                        <th className="border-b border-white/10 px-4 py-3 font-semibold">Table</th>
                        <th className="border-b border-white/10 px-4 py-3 font-semibold">Hands</th>
                        <th className="border-b border-white/10 px-4 py-3 font-semibold">
                          Actions
                        </th>
                        <th className="border-b border-white/10 px-4 py-3 font-semibold">Stack</th>
                        <th className="border-b border-white/10 px-4 py-3 font-semibold">
                          Started
                        </th>
                        <th className="border-b border-white/10 py-3 pl-4 font-semibold">Ended</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.recentSessions.length ? (
                        dashboard.recentSessions.map((session) => (
                          <tr key={session.sessionKey} className="text-zinc-200">
                            <td className="border-b border-white/5 py-3 pr-4">
                              <div className="font-semibold text-white">
                                {session.displayName || `Profile ${session.profileKey.slice(-6)}`}
                              </div>
                              <div className="text-xs text-zinc-500">
                                {session.profileKey.slice(-12)}
                              </div>
                            </td>
                            <td className="border-b border-white/5 px-4 py-3">
                              {session.entryPoint}
                            </td>
                            <td className="border-b border-white/5 px-4 py-3">
                              {session.tableId || session.matchId?.slice(0, 8) || '-'}
                            </td>
                            <td className="border-b border-white/5 px-4 py-3">
                              {session.handsSeen}
                            </td>
                            <td className="border-b border-white/5 px-4 py-3">
                              {session.actionsTaken}
                            </td>
                            <td className="border-b border-white/5 px-4 py-3">
                              {session.lastStack === null
                                ? '-'
                                : `${formatNumber(session.lastStack)} chips`}
                            </td>
                            <td className="border-b border-white/5 px-4 py-3">
                              {formatDate(session.startedAt)}
                            </td>
                            <td className="border-b border-white/5 py-3 pl-4">
                              {formatDate(session.endedAt)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="py-5 text-zinc-500" colSpan={8}>
                            No playtest sessions have been captured yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : null}
        </section>
      </main>
    </>
  );
};

export default AdminAnalyticsPage;
