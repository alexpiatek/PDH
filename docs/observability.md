# Observability Guide

This guide is the first-stop reference when gameplay, match progression, or realtime connectivity breaks.

## Scope

- Nakama authoritative match runtime (`apps/nakama/src/pdhMatch.ts`)
- Browser realtime client (`apps/web/pages/play.tsx`)
- In-memory hand replay debug stream (per-match ring buffer)

## Structured Logs (Nakama)

Nakama runtime logs are JSON records with:

- `event`: stable event name
- `matchId`
- `tableId`
- `tick`
- `userId` (where relevant)
- `handId` (where relevant)
- `actionSeq` (for mutating client intents)

Important event names:

- Lifecycle:
  - `match.init`
  - `match.join_attempt`
  - `match.join`
  - `match.leave`
  - `match.terminate`
- Message quality / safety:
  - `match.invalid_payload`
  - `match.presence_rejected`
  - `match.action.accepted`
  - `match.action.rejected`
  - `match.phase_advanced`
  - `match.auto_discard`
- Replay access:
  - `match.signal.replay_get`
  - `rpc.replay.get`

Tail Nakama logs:

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f nakama
```

## Frontend Runtime Logs

Client logs are written to browser console with prefix `[pdh-client]` and also buffered in memory as:

- `window.__PDH_CLIENT_LOGS__` (last 200 events)

Useful client events:

- `socket.connect.start`
- `socket.connect.success`
- `socket.connect.failed`
- `socket.disconnect`
- `socket.reconnect.scheduled`
- `socket.reconnect.success`
- `socket.send_failed`
- `socket.invalid_payload`
- `ui.error_boundary`

Open browser devtools and filter for `[pdh-client]`.

## Hand Replay Debug Mode

Each PDH match records recent mutating intents (action/discard/nextHand) into an in-memory ring buffer.

Captured fields include:

- `matchId`, `tableId`, `tick`, `userId`
- `handIdBefore` / `handIdAfter`
- `streetBefore` / `streetAfter`
- `phaseBefore` / `phaseAfter`
- `actionSeq`
- action details (`action`, `amount`, `discardIndex`)
- `outcome` (`accepted` or `rejected`) + rejection error message

### Read Replay via Match Signal

`matchSignal` payload:

```json
{ "type": "replay:get", "limit": 50 }
```

Response contains `{ type: "replay", count, events }`.

### Read Replay via RPC (Admin/Trusted Tooling)

RPC id: `pdh_debug_get_replay`

This RPC is disabled by default. For local diagnostics only, enable it in Nakama runtime env with
`PDH_ENABLE_ADMIN_RPCS=true` and set `PDH_ADMIN_USER_IDS` to a comma-separated allowlist of Nakama
user IDs. Production should leave it disabled unless there is a deliberate admin access path.

Example authenticated admin payload:

```json
{ "tableId": "main", "limit": 50 }
```

You can also pass `matchId` directly:

```json
{ "matchId": "YOUR_MATCH_ID", "limit": 100 }
```

## Triage Workflow

1. Confirm server health and websocket reachability.
2. Tail Nakama logs and find `matchId` for affected users.
3. Inspect `match.action.rejected` entries for turn/phase/seq violations.
4. If admin RPCs are explicitly enabled for diagnostics, pull replay stream (`pdh_debug_get_replay`) and verify action ordering.
5. Check browser logs for disconnect/reconnect loops and client parse errors.

## Logging Safety Rules

- Never log auth tokens, cookies, runtime HTTP keys, session encryption keys, or console credentials.
- Log only bounded error text (`message`) and whitelisted metadata.
- Keep action logs to protocol fields, not raw payload dumps.
