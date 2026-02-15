# PDH Quick Fix

Use this when production suddenly shows connection failures (for example, `Connection failed` in the browser).

This page is optimized for fast recovery, not deep analysis.

## 1) One-Command Safe Deploy

Run from the active service checkout (the same path used by `pdh-web`):

```bash
cd "$(systemctl show -p WorkingDirectory --value pdh-web)"
./scripts/deploy-web-prod.sh
```

What it checks before build/restart:

- You are in the same repo path as `pdh-web` `WorkingDirectory`.
- `NAKAMA_SOCKET_SERVER_KEY` matches `NEXT_PUBLIC_NAKAMA_SERVER_KEY`.
- Frontend production values are correct:
  - `NEXT_PUBLIC_NAKAMA_HOST=api.bondipoker.online`
  - `NEXT_PUBLIC_NAKAMA_PORT=443`
  - `NEXT_PUBLIC_NAKAMA_USE_SSL=true`
- Startup sanity-check code exists in the built bundle.
- Live deployed bundle includes the expected socket server key.

## 2) 60-Second Diagnosis

If recovery fails, run:

```bash
systemctl cat pdh-web | sed -n '1,40p'
systemctl show -p WorkingDirectory --value pdh-web

grep -n '^NAKAMA_SOCKET_SERVER_KEY=' .env
grep -n '^NEXT_PUBLIC_NAKAMA_SERVER_KEY=' apps/web/.env.local
grep -n '^NEXT_PUBLIC_NAKAMA_HOST=' apps/web/.env.local
grep -n '^NEXT_PUBLIC_NAKAMA_PORT=' apps/web/.env.local
grep -n '^NEXT_PUBLIC_NAKAMA_USE_SSL=' apps/web/.env.local

CHUNK=$(curl -sS https://play.bondipoker.online | grep -oE '/_next/static/chunks/pages/(play|index)-[^"]+\.js' | head -n1)
JS=$(curl -sS "https://play.bondipoker.online$CHUNK")
echo "$JS" | grep -oE '37ba066c[0-9a-f]*|88f89fa2[0-9a-f]*' | sort -u
echo "$JS" | grep -q 'Startup sanity check failed' && echo 'STARTUP_SANITY_CODE=present'

curl -i -X POST 'https://api.bondipoker.online/v2/account/authenticate/device?create=true' \
  -H 'Origin: https://play.bondipoker.online' \
  -H 'Content-Type: application/json' \
  --data '{"id":"cors-check"}' | rg -i '^access-control-allow-origin:'
```

Interpretation:

- If old key appears in live chunk, frontend was built from wrong repo path or stale env.
- `STARTUP_SANITY_CODE=present` means the startup-check logic is in the deployed bundle.
- If `pdh-web` `WorkingDirectory` is not your current repo, deploy from the service path.
- If keys differ between `.env` and `apps/web/.env.local`, fix that first, then rebuild/restart.
- `Access-Control-Allow-Origin` must appear once. If both origin and `*` appear, strip upstream CORS headers in Caddy.

## 3) Never Repeat This Issue

- Always deploy web from the `pdh-web` `WorkingDirectory`.
- Never run production deploy from a second clone path.
- Use `./scripts/deploy-web-prod.sh` instead of ad-hoc manual commands.
