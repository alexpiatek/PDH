import { checkPlayerTestingDatabase } from './playerTestingAnalyticsServer';

export type SystemHealthStatus = 'operational' | 'degraded' | 'down' | 'unconfigured';

export interface SystemHealthCheck {
  id: 'web' | 'game-backend' | 'analytics-database' | 'external-monitor';
  label: string;
  status: SystemHealthStatus;
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
  dashboardUrl?: string;
}

export interface SystemHealthSnapshot {
  status: Exclude<SystemHealthStatus, 'unconfigured'>;
  checkedAt: string;
  checks: SystemHealthCheck[];
  note: string;
}

async function timedCheck(
  id: SystemHealthCheck['id'],
  label: string,
  operation: () => Promise<void>
): Promise<SystemHealthCheck> {
  const startedAt = Date.now();
  try {
    await operation();
    return {
      id,
      label,
      status: 'operational',
      latencyMs: Date.now() - startedAt,
      detail: 'Responding normally',
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      id,
      label,
      status: 'down',
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : 'Health check failed',
      checkedAt: new Date().toISOString(),
    };
  }
}

function nakamaHealthUrl(): string {
  const explicit = process.env.NAKAMA_HEALTHCHECK_URL;
  if (explicit) return explicit;
  const host = process.env.NEXT_PUBLIC_NAKAMA_HOST || '127.0.0.1';
  const port = process.env.NEXT_PUBLIC_NAKAMA_PORT || '7350';
  const protocol = process.env.NEXT_PUBLIC_NAKAMA_USE_SSL === 'true' ? 'https' : 'http';
  return `${protocol}://${host}:${port}/healthcheck`;
}

export async function loadSystemHealth(): Promise<SystemHealthSnapshot> {
  const checkedAt = new Date().toISOString();
  const monitorUrl = process.env.UPTIME_MONITOR_DASHBOARD_URL?.trim();
  const [database, gameBackend] = await Promise.all([
    timedCheck('analytics-database', 'Analytics database', checkPlayerTestingDatabase),
    timedCheck('game-backend', 'Game backend', async () => {
      const response = await fetch(nakamaHealthUrl(), {
        cache: 'no-store',
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`);
    }),
  ]);

  const checks: SystemHealthCheck[] = [
    {
      id: 'web',
      label: 'Website',
      status: 'operational',
      latencyMs: null,
      detail: 'Admin API is responding',
      checkedAt,
    },
    gameBackend,
    database,
    {
      id: 'external-monitor',
      label: 'External connection monitor',
      status: monitorUrl ? 'operational' : 'unconfigured',
      latencyMs: null,
      detail: monitorUrl
        ? 'External monitoring dashboard connected'
        : 'Not connected; VPN and regional failures may not be recorded',
      checkedAt,
      ...(monitorUrl ? { dashboardUrl: monitorUrl } : {}),
    },
  ];
  const serviceChecks = checks.filter((check) => check.id !== 'external-monitor');
  const status = serviceChecks.some((check) => check.status === 'down') ? 'down' : 'operational';

  return {
    status,
    checkedAt,
    checks,
    note: 'A failure before HTTPS reaches Bondi Poker requires an external multi-region monitor.',
  };
}
