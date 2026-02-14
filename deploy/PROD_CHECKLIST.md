# Production Checklist

## Network and Ports

- `80/443` public only (Caddy).
- `3001/7350/7351/5432` not publicly exposed.
- `api.<root-domain>` and `play.<root-domain>` DNS point to same host.

## Services

- `docker compose --env-file .env -f docker-compose.prod.yml ps` is healthy.
- `nakama` and `postgres` are up; `nakama-migrate` completed successfully.
- `systemctl is-active pdh-web` and `systemctl is-active caddy` return `active`.

## Caddy

- `/etc/caddy/Caddyfile` is based on `deploy/Caddyfile.example`.
- `ROOT_DOMAIN` is set correctly before rendering the file.
- `caddy validate --config /etc/caddy/Caddyfile` passes.

## Security Headers and TLS

- `curl -I https://play.<root-domain>` includes:
  - `strict-transport-security`
  - `x-content-type-options: nosniff`
  - `x-frame-options: DENY`
  - `content-security-policy`

## CORS (Nakama API)

- Preflight from play origin returns expected allow headers:

```bash
curl -i -X OPTIONS https://api.<root-domain>/v2/account/authenticate/device \
  -H 'Origin: https://play.<root-domain>' \
  -H 'Access-Control-Request-Method: POST'
```

- Disallowed origin does not receive `Access-Control-Allow-Origin`.

## Realtime Stability

- Smoke test passes:

```bash
SMOKE_SERVER_KEY='<nakama_socket_server_key>' ./scripts/remote-smoke.sh --url https://api.<root-domain> --ssl true --clients 4
```

- During deployment/restart windows, verify no repeated reconnect loops in browser console.
- Tail logs for disconnect spikes:

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f nakama
journalctl -u caddy -f
```

## Final Sanity

- `https://play.<root-domain>` loads.
- `https://api.<root-domain>/healthcheck` returns `200`.
- New players can join and complete at least one full hand end-to-end.
