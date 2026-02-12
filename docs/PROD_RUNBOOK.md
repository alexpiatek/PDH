# PDH Production Runbook

This is the exact deployment pattern used for:

- `bondipoker.online` (landing page)
- `play.bondipoker.online` (web client)
- `api.bondipoker.online` (Nakama API)

## Topology

- Caddy terminates TLS on `:443`.
- Caddy routes:
  - apex + `www.*` -> `127.0.0.1:3001` (Next.js landing page)
  - `play.*` -> `127.0.0.1:3001` (Next.js)
  - `api.*` -> `127.0.0.1:7350` (Nakama)
- Nakama and Postgres run via `docker-compose.prod.yml`.
- Public ports should be `80` and `443` only.

## Prerequisites

- Ubuntu VPS with Docker + Docker Compose plugin.
- Node.js + pnpm installed on VPS.
- DNS `A` records:
  - `<domain>` -> VPS IP
  - `www.<domain>` -> VPS IP
  - `play.<domain>` -> VPS IP
  - `api.<domain>` -> VPS IP
- Firewall/Security group:
  - allow `22`, `80`, `443`
  - deny public `5432`, `7350`, `7351`

## 1) Sync Repo

```bash
cd /root/PDH
git fetch --all
git checkout main
git pull origin main
chmod +x scripts/*.sh
```

## 2) Configure Backend Env

```bash
cd /root/PDH
cp .env.example .env
```

Set secure non-default values in `.env`:

- `POSTGRES_PASSWORD`
- `NAKAMA_SOCKET_SERVER_KEY`
- `NAKAMA_SESSION_ENCRYPTION_KEY`
- `NAKAMA_SESSION_REFRESH_ENCRYPTION_KEY`
- `NAKAMA_RUNTIME_HTTP_KEY`
- `NAKAMA_CONSOLE_SIGNING_KEY`
- `NAKAMA_CONSOLE_PASSWORD`

Critical DB line format:

```env
POSTGRES_USER=nakama
POSTGRES_PASSWORD=<same-password>
NAKAMA_DATABASE_ADDRESS=nakama:<same-password>@postgres:5432/nakama?sslmode=disable
```

Recommended behind Caddy:

```env
NAKAMA_HTTP_PORT=127.0.0.1:7350
```

## 3) Build Runtime Modules

Build engine first, then Nakama runtime:

```bash
cd /root/PDH
./scripts/run-pnpm.sh install
./scripts/run-pnpm.sh -C packages/engine build
./scripts/run-pnpm.sh -C apps/nakama build
ls -la apps/nakama/dist/pdh.js
```

If `pdh.js` is missing, Nakama will restart with:
`JavaScript entrypoint must be a valid path`.

## 4) Start Backend

```bash
cd /root/PDH
docker compose --env-file .env -f docker-compose.prod.yml down --remove-orphans
docker compose --env-file .env -f docker-compose.prod.yml up -d postgres
docker compose --env-file .env -f docker-compose.prod.yml run --rm nakama-migrate
docker compose --env-file .env -f docker-compose.prod.yml up -d nakama
docker compose --env-file .env -f docker-compose.prod.yml ps
curl -i http://127.0.0.1:7350/healthcheck
```

## 5) Configure and Build Web

Create `apps/web/.env.local`:

```env
NEXT_PUBLIC_NETWORK_BACKEND=nakama
NEXT_PUBLIC_NAKAMA_HOST=api.<your-domain>
NEXT_PUBLIC_NAKAMA_PORT=443
NEXT_PUBLIC_NAKAMA_USE_SSL=true
NEXT_PUBLIC_NAKAMA_SERVER_KEY=<same as NAKAMA_SOCKET_SERVER_KEY>
NEXT_PUBLIC_NAKAMA_MATCH_MODULE=pdh
NEXT_PUBLIC_NAKAMA_TABLE_ID=main
```

Build web:

```bash
cd /root/PDH
./scripts/run-pnpm.sh -C apps/web build
```

## 6) Run Web as a Service

Create `/etc/systemd/system/pdh-web.service`:

```ini
[Unit]
Description=PDH Web (Next.js)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/PDH
Environment=NODE_ENV=production
ExecStart=/usr/bin/env pnpm -C apps/web start --port 3001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable pdh-web
systemctl restart pdh-web
systemctl status pdh-web --no-pager
curl -I http://127.0.0.1:3001
```

## 7) Configure Caddy

Install:

```bash
apt update
apt install -y caddy
```

Set `/etc/caddy/Caddyfile`:

```caddy
<your-domain>, www.<your-domain> {
  reverse_proxy 127.0.0.1:3001
}

play.<your-domain> {
  reverse_proxy 127.0.0.1:3001
}

api.<your-domain> {
  reverse_proxy 127.0.0.1:7350
}
```

Note:

- The app middleware serves the landing page on apex/`www` and rewrites `play.*` root requests to `/play`.

Validate + restart:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl restart caddy
systemctl status caddy --no-pager
```

## 8) Verify Public Endpoints

From VPS and local machine:

```bash
curl -I https://<your-domain>
curl -I https://play.<your-domain>
curl -i https://api.<your-domain>/healthcheck
```

Smoke test:

```bash
SMOKE_SERVER_KEY='<nakama_socket_server_key>' ./scripts/remote-smoke.sh --url https://api.<your-domain> --ssl true --clients 4
```

## Common Failures

### `service "nakama-migrate" didn't complete successfully`

- Check `.env` for malformed or duplicate `NAKAMA_DATABASE_ADDRESS`.
- Ensure password in `POSTGRES_PASSWORD` matches the password inside DB address.

### `JavaScript entrypoint ... /nakama/data/modules/pdh.js: no such file`

- Build workspace dependencies + runtime:
  - `./scripts/run-pnpm.sh -C packages/engine build`
  - `./scripts/run-pnpm.sh -C apps/nakama build`
- Ensure `apps/nakama/dist/pdh.js` exists on host.

### PowerShell `curl` prompts for `Uri`

Use:

```powershell
curl.exe -i http://127.0.0.1:7350/healthcheck
```

## Operations

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
docker compose --env-file .env -f docker-compose.prod.yml logs -f nakama
journalctl -u pdh-web -f
journalctl -u caddy -f
```

## Backups

Keep backups of:

- `/root/PDH/.env`
- `/etc/caddy/Caddyfile`
- `/etc/systemd/system/pdh-web.service`
- Postgres volume snapshots/dumps

Rotate any key that was exposed in logs/chat.
