export type ClientLogLevel = 'info' | 'warn' | 'error';

function compactFields(fields: Record<string, unknown>) {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      compact[key] = value;
    }
  }
  return compact;
}

export function serializeClientError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function logClientEvent(
  event: string,
  fields: Record<string, unknown> = {},
  level: ClientLogLevel = 'info'
) {
  const payload = compactFields({
    ts: new Date().toISOString(),
    event,
    ...fields,
  });

  if (typeof window !== 'undefined') {
    const key = '__PDH_CLIENT_LOGS__';
    const target = window as unknown as { [key: string]: unknown };
    const existing = Array.isArray(target[key]) ? (target[key] as unknown[]) : [];
    existing.push(payload);
    if (existing.length > 200) {
      existing.splice(0, existing.length - 200);
    }
    target[key] = existing;
  }

  if (level === 'error') {
    console.error('[pdh-client]', payload);
    return;
  }
  if (level === 'warn') {
    console.warn('[pdh-client]', payload);
    return;
  }
  console.info('[pdh-client]', payload);
}
