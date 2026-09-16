import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@heroiclabs/nakama-js';
import WebSocket from 'ws';

const enabled = process.env.ITEST_PLAYER_PROFILES === 'true';
const host = process.env.ITEST_NAKAMA_HOST ?? '127.0.0.1';
const port = process.env.ITEST_NAKAMA_PORT ?? '17350';
const client = new Client(
  process.env.ITEST_NAKAMA_SERVER_KEY ?? 'dev_socket_server_key_change_me',
  host,
  port,
  false
);
const sockets: WebSocket[] = [];
const wait = async (check: () => boolean, timeout = 20000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw Error('Timed out waiting for game state');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
async function connection(token: string) {
  const ws = new WebSocket(
    `ws://${host}:${port}/ws?lang=en&status=false&token=${encodeURIComponent(token)}`
  );
  sockets.push(ws);
  const received: any[] = [];
  const states: any[] = [];
  ws.on('message', (bytes) => {
    const msg = JSON.parse(bytes.toString());
    received.push(msg);
    if (msg.match_data?.data)
      states.push(JSON.parse(Buffer.from(msg.match_data.data, 'base64').toString()));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return {
    ws,
    states,
    received,
    join: async (matchId: string) => {
      const cid = randomUUID();
      ws.send(JSON.stringify({ cid, match_join: { match_id: matchId } }));
      await wait(() => received.some((m) => m.cid === cid));
      const response = received.find((m) => m.cid === cid);
      if (response.error) throw Error(response.error.message);
    },
    send: (matchId: string, data: object) =>
      ws.send(
        JSON.stringify({
          match_data_send: {
            match_id: matchId,
            op_code: '1',
            data: Buffer.from(JSON.stringify({ v: 1, ...data })).toString('base64'),
            reliable: true,
          },
        })
      ),
    latest: () => states.filter((s) => s.type === 'state').at(-1)?.state,
  };
}
afterEach(() => {
  for (const ws of sockets.splice(0)) ws.close();
});

(enabled ? describe : describe.skip)('email accounts and durable free chips', () => {
  it('enforces email, deduplicates top-ups, persists funded play and recovers login on another device', async () => {
    const email = `pdh-${randomUUID()}@example.test`;
    const password = randomUUID();
    const a = await client.authenticateEmail(email, password, true);
    const b = await client.authenticateEmail(
      `pdh-${randomUUID()}@example.test`,
      randomUUID(),
      true
    );
    const rpc = async (session: any, name: string, value = {}) => {
      const result = await client.rpc(session, name, value);
      return typeof result.payload === 'string' ? JSON.parse(result.payload) : result.payload;
    };
    expect((await rpc(a, 'pdh_player_profile', { displayName: 'Alice' })).availableChips).toBe(
      10000
    );
    await rpc(b, 'pdh_player_profile', { displayName: 'Bob' });
    const requestId = randomUUID();
    await rpc(a, 'pdh_free_top_up', { requestId });
    expect(await rpc(a, 'pdh_free_top_up', { requestId })).toMatchObject({
      availableChips: 20000,
      freeTopUps: 1,
    });
    const guest = await client.authenticateDevice(randomUUID(), true);
    await expect(rpc(guest, 'rpc_quick_play')).rejects.toBeTruthy();
    const table = await rpc(a, 'rpc_create_table', {
      name: 'Profile test',
      maxPlayers: 2,
      isPrivate: true,
    });
    expect((await rpc(b, 'rpc_list_tables', { includePrivate: true })).tables).toEqual([]);
    const sa = await connection(a.token);
    const sb = await connection(b.token);
    await expect(sb.join(table.matchId)).rejects.toThrow();
    await rpc(b, 'rpc_join_by_code', { code: table.code });
    await sa.join(table.matchId);
    await sb.join(table.matchId);
    sa.send(table.matchId, { type: 'join', name: 'Alice', buyIn: 10000 });
    sb.send(table.matchId, { type: 'join', name: 'Bob', buyIn: 10000 });
    await wait(() => sa.latest()?.seats?.filter(Boolean).length === 2);
    expect(await rpc(a, 'pdh_player_profile')).toMatchObject({
      availableChips: 10000,
      tableSessions: 1,
      allocation: { chips: 10000 },
    });
    sa.send(table.matchId, { type: 'readyForHand', ready: true, seq: 1 });
    sb.send(table.matchId, { type: 'readyForHand', ready: true, seq: 1 });
    await wait(() => sa.latest()?.hand?.phase === 'betting');
    const hand = sa.latest().hand;
    const actor = hand.players.find((p: any) => p.seat === hand.actionOnSeat);
    (actor.id === a.user_id ? sa : sb).send(table.matchId, {
      type: 'action',
      action: 'fold',
      seq: 2,
    });
    await wait(() => sa.latest()?.hand?.phase === 'showdown');
    const pa = await rpc(a, 'pdh_player_profile');
    const pb = await rpc(b, 'pdh_player_profile');
    expect(pa.handsCompleted).toBe(1);
    expect(pb.handsCompleted).toBe(1);
    expect(pa.netWinnings + pb.netWinnings).toBe(0);
    expect(pa.availableChips + pa.allocation.chips + pb.availableChips + pb.allocation.chips).toBe(
      30000
    );
    const login = await client.authenticateEmail(email, password, false);
    expect(login.user_id).toBe(a.user_id);
    expect(await rpc(login, 'pdh_player_profile')).toMatchObject({
      freeTopUps: 1,
      tableSessions: 1,
      handsCompleted: 1,
    });
    expect(sa.states.filter((s) => s.type === 'error')).toEqual([]);
    expect(sb.states.filter((s) => s.type === 'error')).toEqual([]);
    // Restart only the disposable server created for this test run.
    const project = process.env.ITEST_COMPOSE_PROJECT;
    if (!project || !/^pdh_itest_[0-9]+$/.test(project))
      throw Error('Expected isolated integration project');
    execFileSync('docker', ['restart', `${project}-nakama-1`], { timeout: 30000 });
    let healthy = false;
    for (let i = 0; i < 100; i++) {
      try {
        healthy = (await fetch(`http://${host}:${port}/healthcheck`)).ok;
      } catch {}
      if (healthy) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(healthy).toBe(true);
    const afterRestart = await client.authenticateEmail(email, password, false);
    const recovered = await rpc(afterRestart, 'rpc_join_by_code', { code: table.code });
    const resumed = await connection(afterRestart.token);
    await resumed.join(recovered.matchId);
    await wait(() => Boolean(resumed.latest()?.seats?.some((seat: any) => seat?.id === a.user_id)));
    expect(await rpc(afterRestart, 'pdh_player_profile')).toMatchObject({
      availableChips: pa.availableChips,
      allocation: pa.allocation,
      handsCompleted: 1,
      tableSessions: 1,
    });
    resumed.ws.close();
    let released: any;
    for (let i = 0; i < 200; i++) {
      released = await rpc(afterRestart, 'pdh_player_profile');
      if (released.allocation === null) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(released).toMatchObject({
      allocation: null,
      availableChips: pa.availableChips + pa.allocation.chips,
      tableSessions: 1,
    });
  }, 60000);
});
