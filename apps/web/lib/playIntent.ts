import { isValidTableCodeFormat, normalizeTableCode } from '@pdh/protocol';

export type PlayIntent = { action: 'create' | 'quick' } | { action: 'join'; code: string };
export function readPlayIntent(
  query: Record<string, string | string[] | undefined>
): PlayIntent | null {
  if (query.action === 'create' || query.action === 'quick') return { action: query.action };
  if (typeof query.code === 'string') {
    const code = normalizeTableCode(query.code);
    if (isValidTableCodeFormat(code)) return { action: 'join', code };
  }
  return null;
}
export function playIntentUrl(intent: PlayIntent): string {
  return intent.action === 'join'
    ? `/play?code=${encodeURIComponent(intent.code)}`
    : `/play?action=${intent.action}`;
}
export function inviteUrl(origin: string, code: string): string {
  return new URL(
    playIntentUrl({ action: 'join', code: normalizeTableCode(code) }),
    origin
  ).toString();
}
