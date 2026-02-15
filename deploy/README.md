# Deployment Proxy Note

This note defines expected production routing for Next.js + Nakama behind Caddy.

## Expected Local Services

- `127.0.0.1:3001` -> Next.js (`pdh-web` systemd service)
- `127.0.0.1:7350` -> Nakama HTTP + websocket endpoint (Docker container)
- `127.0.0.1:7351` -> Nakama console (keep private, no public proxy)
- `127.0.0.1:5432` -> Postgres (keep private, no public proxy)

## Public Routes

- `https://<root-domain>` -> Next.js
- `https://www.<root-domain>` -> Next.js
- `https://play.<root-domain>` -> Next.js
- `https://api.<root-domain>` -> Nakama (`/healthcheck`, `/v2/*`, `/ws`)

## Websocket Proxying

Caddy `reverse_proxy` supports websocket upgrades automatically; no separate `ws://` block is required.

For realtime stability:

- keep `api.<root-domain>` on TLS/WSS only (avoid mixed `ws://` and `wss://` clients)
- avoid middle proxies/load balancers with aggressive idle websocket timeouts

## Common Disconnect Misconfigs

- Client points to `ws://` while site is on HTTPS (`wss://` required by browsers and proxies).
- Browser targets Nakama direct host/port instead of `api.<root-domain>` (bypasses Caddy TLS/proxy behavior).
- Caddy config reload/restart without stream grace can drop active websocket connections.
- CORS allowlist excludes active web origin (`play.*` or apex), causing auth/match REST calls to fail and trigger reconnect loops.
- Duplicate `Access-Control-Allow-Origin` values (for example allowlist origin + upstream `*`) make browser auth calls fail.
- Multiple front doors (e.g., CDN/LB + Caddy) with conflicting timeout policies.

## Compression and Websockets

- Compression (`encode zstd gzip`) is enabled for Next.js responses.
- Compression is intentionally not configured on the Nakama API site.
- Websocket upgraded streams are not gzip/brotli encoded by Caddy.

## CORS Baseline for Nakama

The Caddy baseline only allows browser origins:

- `https://<root-domain>`
- `https://www.<root-domain>`
- `https://play.<root-domain>`

If you add additional UI origins, explicitly add them to CORS allowlist in `deploy/Caddyfile.example`.

## Security Headers Baseline

`deploy/Caddyfile.example` sets:

- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- a conservative CSP tuned for Next.js and `api.<root-domain>` websocket/API calls

## Validate Before Restart

```bash
export ROOT_DOMAIN=example.com
envsubst < deploy/Caddyfile.example | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Quick checks:

```bash
curl -I https://play.example.com
curl -i https://api.example.com/healthcheck
curl -i -X OPTIONS https://api.example.com/v2/account/authenticate/device \
  -H 'Origin: https://play.example.com' \
  -H 'Access-Control-Request-Method: POST'
```
