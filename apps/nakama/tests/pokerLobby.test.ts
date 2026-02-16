import { describe, expect, it, vi } from 'vitest';
import { isValidTableCodeFormat } from '@pdh/protocol';
import {
  LOBBY_GAMEPLAY_MATCH_MODULE,
  pokerTableMatchHandler,
  rpcCreateTable,
  rpcJoinByCode,
} from '../src/pokerLobby';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

interface MockMatchRecord {
  matchId: string;
  label: string;
  size: number;
}

function makeNakamaMock() {
  const storage = new Map<string, Record<string, unknown>>();
  const matches = new Map<string, MockMatchRecord>();
  let nextMatchId = 1;

  const nk = {
    binaryToString: (data: Uint8Array) => new TextDecoder().decode(data),
    matchCreate: vi.fn((module: string, params: Record<string, unknown>) => {
      if (module !== LOBBY_GAMEPLAY_MATCH_MODULE) {
        throw new Error(`Unexpected module: ${module}`);
      }
      const matchId = `match-${nextMatchId}`;
      nextMatchId += 1;
      const tableId = typeof params.tableId === 'string' ? params.tableId : 'main';
      const init = { label: JSON.stringify({ tableId }) };
      matches.set(matchId, {
        matchId,
        label: init.label,
        size: 0,
      });
      return matchId;
    }),
    matchList: vi.fn(
      (limit: number, authoritative: boolean, label: string, minSize: number, maxSize: number) => {
        return [...matches.values()]
          .filter((match) => (label ? match.label === label : true))
          .filter((match) => match.size >= minSize && match.size <= maxSize)
          .map((match) => ({
            matchId: match.matchId,
            label: match.label,
            size: match.size,
            authoritative: true,
          }));
      }
    ),
    matchGet: vi.fn((matchId: string) => {
      const match = matches.get(matchId);
      if (!match) {
        return null;
      }
      return {
        matchId: match.matchId,
        label: match.label,
        size: match.size,
      };
    }),
    storageRead: vi.fn((objects: Array<{ key: string; collection: string; userId: string }>) => {
      return objects
        .map((object) => {
          const value = storage.get(object.key);
          if (!value) {
            return null;
          }
          return {
            collection: object.collection,
            key: object.key,
            userId: object.userId,
            value,
          };
        })
        .filter((value): value is { collection: string; key: string; userId: string; value: object } =>
          Boolean(value)
        );
    }),
    storageWrite: vi.fn(
      (
        objects: Array<{
          key: string;
          collection: string;
          userId: string;
          value: Record<string, unknown>;
        }>
      ) => {
        for (const object of objects) {
          storage.set(object.key, object.value);
        }
        return objects.map((object) => ({
          collection: object.collection,
          key: object.key,
          userId: object.userId,
          value: object.value,
        }));
      }
    ),
  };

  return {
    nk,
    storage,
    matches,
    setMatchSize(matchId: string, size: number) {
      const existing = matches.get(matchId);
      if (!existing) {
        throw new Error(`Unknown match id: ${matchId}`);
      }
      existing.size = size;
      matches.set(matchId, existing);
    },
  };
}

describe('poker lobby RPCs', () => {
  it('creates a table, allocates a code, and stores metadata', () => {
    const { nk, storage } = makeNakamaMock();

    const response = rpcCreateTable(
      {},
      logger as any,
      nk as any,
      JSON.stringify({ name: 'Bondi Main', maxPlayers: 6, isPrivate: true })
    );

    const parsed = JSON.parse(response) as { code: string; matchId: string };
    expect(isValidTableCodeFormat(parsed.code)).toBe(true);
    expect(parsed.matchId).toBe('match-1');

    const stored = storage.get(parsed.code) as any;
    expect(stored).toBeTruthy();
    expect(stored.matchId).toBe(parsed.matchId);
    expect(stored.name).toBe('Bondi Main');
    expect(stored.maxPlayers).toBe(6);
    expect(stored.isPrivate).toBe(true);
    expect(typeof stored.createdAt).toBe('string');
  });

  it('normalizes join code input before resolving match id', () => {
    const { nk } = makeNakamaMock();

    const createResponse = rpcCreateTable(
      {},
      logger as any,
      nk as any,
      JSON.stringify({ name: 'Late Night', maxPlayers: 5, isPrivate: false })
    );
    const created = JSON.parse(createResponse) as { code: string; matchId: string };

    const noisyCode = `${created.code.slice(0, 3)}-${created.code.slice(3)}`.toLowerCase();
    const joinResponse = rpcJoinByCode(
      {},
      logger as any,
      nk as any,
      JSON.stringify({ code: `  ${noisyCode}  ` })
    );

    const joined = JSON.parse(joinResponse) as { matchId: string };
    expect(joined.matchId).toBe(created.matchId);
  });

  it('rejects join when table is full', () => {
    const { nk, setMatchSize } = makeNakamaMock();

    const createResponse = rpcCreateTable(
      {},
      logger as any,
      nk as any,
      JSON.stringify({ name: 'Heads Up', maxPlayers: 2, isPrivate: true })
    );
    const created = JSON.parse(createResponse) as { code: string; matchId: string };

    setMatchSize(created.matchId, 2);

    expect(() =>
      rpcJoinByCode({}, logger as any, nk as any, JSON.stringify({ code: created.code }))
    ).toThrow(/already full/i);
  });
});

describe('poker_table match handler', () => {
  it('rejects new joins when max players reached', () => {
    const { nk } = makeNakamaMock();
    const dispatcher = { broadcastMessage: vi.fn() };

    const init = pokerTableMatchHandler.matchInit(
      {},
      logger as any,
      nk as any,
      { code: 'ABC234', maxPlayers: 2, name: 'Two Seat' }
    );
    const state = init.state as any;

    const p1 = { userId: 'u1' };
    const p2 = { userId: 'u2' };

    pokerTableMatchHandler.matchJoin({}, logger as any, nk as any, dispatcher as any, 1, state, [p1]);
    pokerTableMatchHandler.matchJoin({}, logger as any, nk as any, dispatcher as any, 1, state, [p2]);

    const attempt = pokerTableMatchHandler.matchJoinAttempt(
      {},
      logger as any,
      nk as any,
      dispatcher as any,
      2,
      state,
      { userId: 'u3' },
      {}
    ) as { accept: boolean; rejectMessage?: string };

    expect(attempt.accept).toBe(false);
    expect(attempt.rejectMessage).toMatch(/full/i);
  });
});
