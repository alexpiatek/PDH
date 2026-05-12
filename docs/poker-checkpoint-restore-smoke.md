# Poker Checkpoint Restore Smoke

This smoke verifies the Nakama authoritative poker checkpoint restore path without requiring a real Nakama process restart. It uses the Nakama match handler and lobby RPCs with an in-memory Nakama runtime mock, then simulates stale lobby metadata by removing the original match record and rejoining by table code.

Run it from the repo root:

```powershell
pnpm -C apps/nakama exec vitest run tests/pdhCheckpointRestoreSmoke.test.ts
```

The same command works from `cmd`, PowerShell, Git Bash, and CI shells as long as `pnpm` is available.

The smoke covers:

- create a private lobby table and start an authoritative two-player hand
- verify the active betting hand wrote a checkpoint
- simulate match interruption by removing the original live match
- rejoin by table code and verify the replacement match id is used
- restore the hand from the checkpoint with a higher `stateVersion`
- preserve seat ownership across restore
- verify private hole cards are only visible to their owner and the deck is not sent to clients
- verify personalized `legalActions` after restore
- play the restored hand through showdown
- enter between-hand state and start the next hand

This is a local/staging confidence check, not a distributed-systems proof. It does not validate real process supervision, multi-node races, storage outages, or production Nakama/Postgres durability.
