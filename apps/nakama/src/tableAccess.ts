import type * as nkruntime from '@heroiclabs/nakama-runtime';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const MEMBERSHIPS = 'pdh_table_memberships';
const PROTECTED = new Set(['tables', MEMBERSHIPS, 'pdh_match_checkpoints']);

export function requireTableUser(ctx: unknown): string {
  const userId = (ctx as { userId?: string } | null)?.userId;
  if (!userId) throw new Error('Sign in before joining a table.');
  return userId;
}

// A shared code is an invitation. Membership survives refresh/reconnect, but a
// guessed match ID alone must never grant access to a code-only table.
export function grantTableAccess(nk: nkruntime.Nakama, userId: string, tableId: string) {
  if (!nk.storageWrite) throw new Error('Table access storage unavailable');
  nk.storageWrite([
    {
      collection: MEMBERSHIPS,
      key: tableId,
      userId,
      value: { tableId },
      permissionRead: 0,
      permissionWrite: 0,
    },
  ]);
}

export function canAccessTable(nk: nkruntime.Nakama, userId: string, tableId: string) {
  if (!nk.storageRead) throw new Error('Table access storage unavailable');
  const record = nk.storageRead([
    { collection: 'tables', key: tableId, userId: SYSTEM_USER_ID },
  ])[0];
  if (!(record?.value as { isPrivate?: boolean } | undefined)?.isPrivate) return true;
  return nk.storageRead([{ collection: MEMBERSHIPS, key: tableId, userId }]).length > 0;
}

// Also protects old records written with public-read permission before this release.
export function protectTableStorageRead(
  _ctx: unknown,
  _logger: unknown,
  _nk: unknown,
  request: { objectIds?: Array<{ collection: string }> }
) {
  if (request.objectIds?.some((id) => PROTECTED.has(id.collection))) {
    throw new Error('Use the table lobby to access tables.');
  }
  return request;
}

export function protectTableStorageList(
  _ctx: unknown,
  _logger: unknown,
  _nk: unknown,
  request: { collection: string }
) {
  if (PROTECTED.has(request.collection)) throw new Error('Use the table lobby to access tables.');
  return request;
}

(globalThis as any).protectTableStorageRead = protectTableStorageRead;
(globalThis as any).protectTableStorageList = protectTableStorageList;
