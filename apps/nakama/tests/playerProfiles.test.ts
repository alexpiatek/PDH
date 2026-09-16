import { describe, expect, it, vi } from 'vitest';
import { PokerTable } from '@pdh/engine';
import {
  accountingWrites,
  rpcPlayerProfile,
  rpcFreeTopUp,
  rpcPlayerReport,
  withProfileTransaction,
} from '../src/playerProfiles';
import {
  canAccessTable,
  grantTableAccess,
  protectTableStorageList,
  protectTableStorageRead,
} from '../src/tableAccess';

function store() {
  const data = new Map<string, any>();
  const key = (o: any) => `${o.collection}/${o.userId}/${o.key}`;
  const nk: any = {
    accountGetId: () => ({ email: 'player@example.test' }),
    storageRead: (items: any[]) =>
      items
        .map((o) => data.get(key(o)))
        .filter(Boolean)
        .map((o) => structuredClone(o)),
    storageWrite: (items: any[]) => {
      // Match Nakama's all-or-nothing version-checked storage batch.
      for (const o of items) {
        const prev = data.get(key(o));
        if (
          (o.version === '*' && prev) ||
          (o.version && o.version !== '*' && o.version !== prev?.version)
        )
          throw Error('storage version conflict');
      }
      for (const o of items)
        data.set(key(o), {
          ...structuredClone(o),
          version: String(Number(data.get(key(o))?.version ?? 0) + 1),
        });
      return items.map((o) => data.get(key(o)));
    },
    storageList: (_id: string, collection: string) => ({
      objects: [...data.values()].filter((o) => o.collection === collection),
    }),
  };
  const profile = (id = 'p1') => JSON.parse(rpcPlayerProfile({ userId: id }, null, nk, '{}'));
  return { nk, data, profile };
}

describe('persistent free-play profiles', () => {
  it('requires email and grants the welcome balance exactly once', () => {
    const { nk, profile } = store();
    expect(profile().availableChips).toBe(10000);
    expect(profile().availableChips).toBe(10000);
    nk.accountGetId = () => ({});
    expect(() => profile()).toThrow('email/password');
  });

  it('allows unlimited distinct top-ups but deduplicates retries', () => {
    const { nk, profile } = store();
    profile();
    for (const requestId of ['request-00000000001', 'request-00000000001', 'request-00000000002']) {
      rpcFreeTopUp({ userId: 'p1' }, null, nk, JSON.stringify({ requestId, amount: 999999 }));
    }
    expect(profile()).toMatchObject({
      availableChips: 30000,
      freeTopUps: 2,
      freeChipsGranted: 30000,
    });
  });

  it('transfers table chips, records winnings and hands once, then returns chips on exit', () => {
    const { nk, profile } = store();
    profile();
    profile('p2');
    const before = new PokerTable('ABC234').state;
    const after = structuredClone(before);
    after.seats[0] = {
      id: 'p1',
      name: 'Alex',
      seat: 0,
      stack: 10000,
      buyInTotal: 10000,
      rebuyCount: 0,
    };
    after.seats[1] = {
      id: 'p2',
      name: 'Brad',
      seat: 1,
      stack: 10000,
      buyInTotal: 10000,
      rebuyCount: 0,
    };
    nk.storageWrite(accountingWrites(nk, before, after, 1));
    expect(profile()).toMatchObject({ availableChips: 0, tableSessions: 1 });
    const settled = structuredClone(after);
    settled.seats[0]!.stack = 11000;
    settled.seats[1]!.stack = 9000;
    settled.hand = {
      handId: 'h1',
      phase: 'showdown',
      players: [{ id: 'p1' }, { id: 'p2' }],
      showdownWinners: [{ playerId: 'p1', amount: 2000 }],
    } as any;
    nk.storageWrite(accountingWrites(nk, after, settled, 2));
    nk.storageWrite(accountingWrites(nk, settled, settled, 3));
    expect(profile()).toMatchObject({
      netWinnings: 1000,
      handsStarted: 1,
      handsCompleted: 1,
      handsWon: 1,
    });
    expect(profile('p2').netWinnings).toBe(-1000);
    const empty = structuredClone(settled);
    empty.seats.fill(null);
    nk.storageWrite(accountingWrites(nk, settled, empty, 4));
    expect(profile()).toMatchObject({ availableChips: 11000, allocation: null });
    expect(profile('p2').availableChips).toBe(9000);
  });

  it('blocks spending the same balance at two tables and requires funded rebuys', () => {
    const { nk, profile } = store();
    profile();
    const empty = new PokerTable('A').state;
    const seated = structuredClone(empty);
    seated.seats[0] = {
      id: 'p1',
      name: 'Alex',
      seat: 0,
      stack: 10000,
      buyInTotal: 10000,
      rebuyCount: 0,
    };
    nk.storageWrite(accountingWrites(nk, empty, seated, 1));
    expect(() => accountingWrites(nk, empty, { ...seated, id: 'B' }, 2)).toThrow('other table');
    const busted = structuredClone(seated);
    busted.seats[0]!.stack = 0;
    nk.storageWrite(accountingWrites(nk, seated, busted, 2));
    const rebought = structuredClone(busted);
    Object.assign(rebought.seats[0]!, { stack: 10000, buyInTotal: 20000, rebuyCount: 1 });
    expect(() => accountingWrites(nk, busted, rebought, 3)).toThrow('Not enough chips');
    rpcFreeTopUp({ userId: 'p1' }, null, nk, JSON.stringify({ requestId: 'request-00000000001' }));
    nk.storageWrite(accountingWrites(nk, busted, rebought, 3));
    expect(profile()).toMatchObject({
      availableChips: 0,
      freeTopUps: 1,
      tableRebuys: 1,
      netWinnings: -10000,
    });
  });

  it('rejects concurrent grants atomically without writing a receipt', () => {
    const { nk, profile, data } = store();
    profile();
    const write = nk.storageWrite;
    nk.storageWrite = (items: any[]) => {
      const p = [...data.values()].find((o) => o.collection === 'pdh_player_profiles');
      p.version = '99';
      return write(items);
    };
    expect(() =>
      rpcFreeTopUp({ userId: 'p1' }, null, nk, JSON.stringify({ requestId: 'request-00000000001' }))
    ).toThrow('version conflict');
    expect(profile().availableChips).toBe(10000);
    expect([...data.values()].filter((o) => o.key.startsWith('topup:'))).toHaveLength(0);
  });

  it('does not publish or retain an in-memory mutation when persistence fails', () => {
    const { nk, profile } = store();
    profile();
    const original = { table: new PokerTable('A').state, stateVersion: 0 };
    const broadcastMessage = vi.fn();
    const callback = (
      _ctx: any,
      _log: any,
      runtime: any,
      dispatcher: any,
      _tick: number,
      state: any
    ) => {
      state.table.seats[0] = { id: 'p1', name: 'Alex', seat: 0, stack: 10000, buyInTotal: 10000 };
      state.stateVersion++;
      runtime.storageWrite([
        {
          collection: 'pdh_match_checkpoints',
          key: 'A',
          userId: '00000000-0000-0000-0000-000000000000',
          value: state,
          permissionRead: 0,
          permissionWrite: 0,
        },
      ]);
      dispatcher.broadcastMessage(2, 'unsafe state');
      return { state };
    };
    nk.storageWrite = () => {
      throw Error('database unavailable');
    };
    const result = withProfileTransaction(callback)(
      { env: { PDH_ENABLE_PLAYER_PROFILES: 'true' } },
      { error: vi.fn() },
      nk,
      { broadcastMessage },
      1,
      original
    );
    expect(result.state).toBe(original);
    expect(original.table.seats[0]).toBeNull();
    expect(broadcastMessage.mock.calls.flat()).not.toContain('unsafe state');
    expect(profile().availableChips).toBe(10000);
  });

  it('restricts operator reports to configured administrators', () => {
    const { nk, profile } = store();
    profile();
    expect(() => rpcPlayerReport({ userId: 'p1' }, null, nk, '{}')).toThrow('administrators');
    const report = JSON.parse(
      rpcPlayerReport({ userId: 'p1', env: { PDH_ADMIN_USER_IDS: 'p1' } }, null, nk, '{}')
    );
    expect(report.players).toHaveLength(1);
    expect(report.players[0].playerId).toBe('p1');
  });
});

describe('code-only table access', () => {
  it('requires code admission before direct match entry', () => {
    const { nk } = store();
    nk.storageWrite([
      {
        collection: 'tables',
        key: 'ABC234',
        userId: '00000000-0000-0000-0000-000000000000',
        value: { isPrivate: true },
      },
    ]);
    expect(canAccessTable(nk, 'p1', 'ABC234')).toBe(false);
    grantTableAccess(nk, 'p1', 'ABC234');
    expect(canAccessTable(nk, 'p1', 'ABC234')).toBe(true);
    expect(canAccessTable(nk, 'p2', 'ABC234')).toBe(false);
  });
  it('blocks direct reads of legacy public metadata and private checkpoints', () => {
    expect(() =>
      protectTableStorageRead(null, null, null, { objectIds: [{ collection: 'tables' }] })
    ).toThrow();
    expect(() =>
      protectTableStorageList(null, null, null, { collection: 'pdh_match_checkpoints' })
    ).toThrow();
    expect(protectTableStorageList(null, null, null, { collection: 'other' })).toEqual({
      collection: 'other',
    });
  });
});
