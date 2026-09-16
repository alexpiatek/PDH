import type * as nkruntime from '@heroiclabs/nakama-runtime';
import { MatchOpCode, withProtocolVersion } from './protocol';
import type { TableState } from '@pdh/engine';

export const PROFILE_COLLECTION = 'pdh_player_profiles';
export const CHIP_LEDGER = 'pdh_chip_ledger';
export const FREE_CHIPS = 10000;
type Allocation = { tableId: string; chips: number; buyInTotal: number; rebuyCount: number };
export interface PlayerProfile {
  schemaVersion: 1;
  displayName: string;
  availableChips: number;
  freeTopUps: number;
  freeChipsGranted: number;
  tableSessions: number;
  handsStarted: number;
  handsCompleted: number;
  handsWon: number;
  tableRebuys: number;
  netWinnings: number;
  allocation: Allocation | null;
  lastStartedHand: string | null;
  lastCompletedHand: string | null;
  createdAt: number;
  updatedAt: number;
}

export const profilesEnabled = (ctx: any) => ctx?.env?.PDH_ENABLE_PLAYER_PROFILES === 'true';

export function requireEmailAccount(ctx: any, nk: nkruntime.Nakama): string {
  if (!ctx?.userId) throw new Error('Sign in with email and password to play.');
  const account = nk.accountGetId?.(ctx.userId);
  if (!account?.email) throw new Error('An email/password account is required to play.');
  return ctx.userId;
}

function read(nk: nkruntime.Nakama, collection: string, userId: string, key: string) {
  if (!nk.storageRead || !nk.storageWrite) throw new Error('Player storage unavailable');
  return nk.storageRead([{ collection, userId, key }])[0];
}

function profileWrite(
  userId: string,
  profile: PlayerProfile,
  version?: string
): nkruntime.StorageWriteRequest {
  return {
    collection: PROFILE_COLLECTION,
    key: 'profile',
    userId,
    value: profile as unknown as Record<string, unknown>,
    version: version ?? '*',
    permissionRead: 1,
    permissionWrite: 0,
  };
}

function directoryWrites(writes: nkruntime.StorageWriteRequest[]) {
  return [
    ...writes,
    ...writes
      .filter((w) => w.collection === PROFILE_COLLECTION)
      .map((w) => ({
        collection: 'pdh_player_directory',
        key: w.userId,
        userId: '00000000-0000-0000-0000-000000000000',
        value: w.value,
        permissionRead: 0,
        permissionWrite: 0,
      })),
  ];
}

function ledgerWrite(
  userId: string,
  key: string,
  value: Record<string, unknown>
): nkruntime.StorageWriteRequest {
  return {
    collection: CHIP_LEDGER,
    key,
    userId,
    value,
    version: '*',
    permissionRead: 1,
    permissionWrite: 0,
  };
}

export function rpcPlayerProfile(
  ctx: any,
  _logger: unknown,
  nk: nkruntime.Nakama,
  payload: string
) {
  const userId = requireEmailAccount(ctx, nk);
  const input = JSON.parse(payload || '{}');
  const existing = read(nk, PROFILE_COLLECTION, userId, 'profile');
  const displayName =
    typeof input.displayName === 'string'
      ? input.displayName.trim().replace(/\s+/g, ' ').slice(0, 24)
      : '';
  const now = Date.now();
  const profile: PlayerProfile = existing
    ? JSON.parse(JSON.stringify(existing.value))
    : {
        schemaVersion: 1,
        displayName: displayName || 'Player',
        availableChips: FREE_CHIPS,
        freeTopUps: 0,
        freeChipsGranted: FREE_CHIPS,
        tableSessions: 0,
        handsStarted: 0,
        handsCompleted: 0,
        handsWon: 0,
        tableRebuys: 0,
        netWinnings: 0,
        allocation: null,
        lastStartedHand: null,
        lastCompletedHand: null,
        createdAt: now,
        updatedAt: now,
      };
  if (!existing || (displayName && displayName !== profile.displayName)) {
    if (displayName) profile.displayName = displayName;
    profile.updatedAt = now;
    nk.storageWrite!(
      directoryWrites([
        profileWrite(userId, profile, existing?.version),
        ...(!existing
          ? [ledgerWrite(userId, 'welcome', { kind: 'welcome', chips: FREE_CHIPS, at: now })]
          : []),
      ])
    );
  }
  return JSON.stringify(profile);
}

export function rpcFreeTopUp(ctx: any, _logger: unknown, nk: nkruntime.Nakama, payload: string) {
  const userId = requireEmailAccount(ctx, nk);
  const input = JSON.parse(payload || '{}');
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId))
    throw new Error('Invalid top-up request');
  const key = `topup:${input.requestId}`;
  const existing = read(nk, PROFILE_COLLECTION, userId, 'profile');
  if (!existing) throw new Error('Create your profile first.');
  if (read(nk, CHIP_LEDGER, userId, key)) return JSON.stringify(existing.value);
  const profile: PlayerProfile = JSON.parse(JSON.stringify(existing.value));
  if (!Number.isSafeInteger(profile.availableChips + FREE_CHIPS))
    throw new Error('Chip balance limit reached');
  profile.availableChips += FREE_CHIPS;
  profile.freeTopUps += 1;
  profile.freeChipsGranted += FREE_CHIPS;
  profile.updatedAt = Date.now();
  nk.storageWrite!(
    directoryWrites([
      profileWrite(userId, profile, existing.version),
      ledgerWrite(userId, key, {
        kind: 'free_top_up',
        chips: FREE_CHIPS,
        at: profile.updatedAt,
      }),
    ])
  );
  return JSON.stringify(profile);
}

// Profiles, ledger receipts, and the match checkpoint are one storage transaction.
// Only one funded table per account in the pilot keeps chips from being spent twice.
export function accountingWrites(
  nk: nkruntime.Nakama,
  before: TableState,
  after: TableState,
  stateVersion: number
) {
  const writes: nkruntime.StorageWriteRequest[] = [];
  const ids = new Set([...before.seats, ...after.seats].filter(Boolean).map((seat) => seat!.id));
  for (const userId of ids) {
    const existing = read(nk, PROFILE_COLLECTION, userId, 'profile');
    if (!existing)
      throw new Error(
        'A player profile is missing; this legacy table cannot use persistent chips.'
      );
    const profile: PlayerProfile = JSON.parse(JSON.stringify(existing.value));
    const old = JSON.stringify(profile);
    const seat = after.seats.find((s) => s?.id === userId);
    const previous = profile.allocation;
    if (previous && previous.tableId !== after.id)
      throw new Error('Leave your other table before joining another.');
    if (seat) {
      const buyIn = seat.buyInTotal ?? seat.stack;
      const debit = buyIn - (previous?.buyInTotal ?? 0);
      if (!Number.isSafeInteger(debit) || debit < 0) throw new Error('Invalid table chip transfer');
      if (profile.availableChips < debit)
        throw new Error('Not enough chips. Add a free top-up in your profile.');
      profile.availableChips -= debit;
      if (!previous) profile.tableSessions++;
      profile.tableRebuys += (seat.rebuyCount ?? 0) - (previous?.rebuyCount ?? 0);
      if (previous) profile.netWinnings += seat.stack - previous.chips - debit;
      profile.allocation = {
        tableId: after.id,
        chips: seat.stack,
        buyInTotal: buyIn,
        rebuyCount: seat.rebuyCount ?? 0,
      };
      profile.displayName = seat.name;
    } else if (previous) {
      profile.availableChips += previous.chips;
      profile.allocation = null;
    }
    const hand = after.hand;
    const handKey = hand ? `${after.id}:${hand.handId}` : null;
    if (hand && hand.players.some((p) => p.id === userId)) {
      if (profile.lastStartedHand !== handKey) {
        profile.handsStarted++;
        profile.lastStartedHand = handKey;
      }
      if (hand.phase === 'showdown' && profile.lastCompletedHand !== handKey) {
        profile.handsCompleted++;
        if (hand.showdownWinners.some((p) => p.playerId === userId)) profile.handsWon++;
        profile.lastCompletedHand = handKey;
      }
    }
    if (old !== JSON.stringify(profile)) {
      profile.updatedAt = Date.now();
      writes.push(profileWrite(userId, profile, existing.version));
      writes.push(
        ledgerWrite(userId, `table:${after.id}:${stateVersion}`, {
          kind: 'table_update',
          tableId: after.id,
          handId: hand?.handId ?? null,
          availableChips: profile.availableChips,
          tableChips: profile.allocation?.chips ?? 0,
          netWinnings: profile.netWinnings,
          tableRebuys: profile.tableRebuys,
          at: profile.updatedAt,
        })
      );
    }
  }
  return directoryWrites(writes);
}

export function withProfileTransaction(handler: (...args: any[]) => any) {
  return (...args: any[]) => {
    const [ctx, logger, nk, dispatcher, , original] = args;
    if (!profilesEnabled(ctx)) return handler(...args);
    const buffered: any[][] = [];
    const working = JSON.parse(JSON.stringify(original));
    let checkpoint: nkruntime.StorageWriteRequest | undefined;
    const stagedNk = Object.assign({}, nk, {
      storageWrite: (writes: nkruntime.StorageWriteRequest[]) => {
        for (const write of writes) {
          if (write.collection !== 'pdh_match_checkpoints')
            throw new Error('Unexpected match write');
          checkpoint = write;
        }
        return [];
      },
    });
    const stagedDispatcher = Object.assign({}, dispatcher, {
      broadcastMessage: (...message: any[]) => buffered.push(message),
    });
    let committedResult: any;
    let committed = false;
    try {
      const base = nk.storageRead([
        {
          collection: 'pdh_match_checkpoints',
          key: original.table.id,
          userId: '00000000-0000-0000-0000-000000000000',
        },
      ])[0];
      const result = handler(
        ctx,
        logger,
        stagedNk,
        stagedDispatcher,
        args[4],
        working,
        ...args.slice(6)
      );
      if (checkpoint) {
        if (
          base?.value?.stateVersion !== undefined &&
          base.value.stateVersion !== original.stateVersion
        )
          throw new Error('Table changed on another server. Reconnect before playing.');
        checkpoint.version = base?.version ?? '*';
        nk.storageWrite([
          checkpoint,
          ...accountingWrites(nk, original.table, working.table, working.stateVersion),
        ]);
      }
      if (!checkpoint && original.stateVersion !== working.stateVersion)
        throw new Error('Table update was not saved. Please retry.');
      committedResult = result;
      committed = true;
      for (const message of buffered) dispatcher.broadcastMessage(...message);
      return result;
    } catch (error) {
      logger.error('Player accounting transaction rejected: %v', String(error));
      // A delivery error after commit must never rewind the authoritative state.
      if (committed) return committedResult;
      dispatcher.broadcastMessage(
        MatchOpCode.ServerMessage,
        JSON.stringify(
          withProtocolVersion({
            type: 'error',
            message: String(error instanceof Error ? error.message : error),
          })
        ),
        null,
        null,
        true
      );
      return { state: original };
    }
  };
}

export function rpcPlayerReport(ctx: any, _logger: unknown, nk: nkruntime.Nakama, payload: string) {
  const userId = requireEmailAccount(ctx, nk);
  const admins = String(ctx?.env?.PDH_ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim());
  if (!admins.includes(userId)) throw new Error('Player report is restricted to administrators.');
  const { cursor } = JSON.parse(payload || '{}');
  if (!nk.storageList) throw new Error('Player report unavailable');
  const result = nk.storageList(
    '00000000-0000-0000-0000-000000000000',
    'pdh_player_directory',
    100,
    typeof cursor === 'string' ? cursor : undefined
  );
  return JSON.stringify({
    players: result.objects.map((o) => ({ playerId: o.key, profile: o.value })),
    cursor: result.cursor,
  });
}

(globalThis as any).rpcPlayerProfile = rpcPlayerProfile;
(globalThis as any).rpcFreeTopUp = rpcFreeTopUp;
(globalThis as any).rpcPlayerReport = rpcPlayerReport;
