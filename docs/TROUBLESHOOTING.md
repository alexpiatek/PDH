# PDH Troubleshooting

Use this page when production is broken and you need fast diagnosis.

## 0) Quick Triage

Run these first on the server:

```bash
SERVICE_DIR=$(systemctl show -p WorkingDirectory --value pdh-web)
cd "$SERVICE_DIR"
docker compose --env-file .env -f docker-compose.prod.yml ps
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=120 nakama postgres
systemctl status pdh-web --no-pager
systemctl status caddy --no-pager
curl -i http://127.0.0.1:7350/healthcheck
curl -I http://127.0.0.1:3001
curl -i https://api.<domain>/healthcheck
curl -I https://play.<domain>
```

Fast safe redeploy (recommended):

```bash
cd "$SERVICE_DIR"
./scripts/deploy-web-prod.sh
```

## 1) Nakama Not Starting

### Symptom

- `curl http://127.0.0.1:7350/healthcheck` fails.
- `nakama` container restarts repeatedly.

### Check

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps -a
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=200 nakama
```

### Common causes

1. Missing runtime bundle:

- Error: `JavaScript entrypoint must be a valid path ... /nakama/data/modules/pdh.js`
- Fix:

```bash
./scripts/run-pnpm.sh -C packages/engine build
./scripts/run-pnpm.sh -C apps/nakama build
ls -la apps/nakama/dist/pdh.js
docker compose --env-file .env -f docker-compose.prod.yml up -d --force-recreate nakama
```

2. Bad DB address or credentials:

- Error around `nakama-migrate` DB auth/host resolution.
- Fix:

```bash
grep -nE '^(POSTGRES_USER|POSTGRES_PASSWORD|NAKAMA_DATABASE_ADDRESS)=' .env
```

Ensure only one `NAKAMA_DATABASE_ADDRESS` exists and format is:

```env
NAKAMA_DATABASE_ADDRESS=nakama:<password>@postgres:5432/nakama?sslmode=disable
```

## 2) `nakama-migrate` Fails

### Symptom

- `service "nakama-migrate" didn't complete successfully`.

### Check

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs --tail=200 nakama-migrate postgres
```

### Fix pattern

```bash
docker compose --env-file .env -f docker-compose.prod.yml down --remove-orphans --volumes
docker compose --env-file .env -f docker-compose.prod.yml up -d postgres
docker compose --env-file .env -f docker-compose.prod.yml run --rm nakama-migrate
docker compose --env-file .env -f docker-compose.prod.yml up -d nakama
```

## 3) Web App (Next.js) Not Reachable

### Symptom

- `play.<domain>` gives 502/timeout.

### Check

```bash
systemctl status pdh-web --no-pager
journalctl -u pdh-web -n 120 --no-pager
ss -ltnp | grep ':3001'
```

### Fix

```bash
SERVICE_DIR=$(systemctl show -p WorkingDirectory --value pdh-web)
cd "$SERVICE_DIR"
./scripts/run-pnpm.sh -C apps/web build
systemctl restart pdh-web
systemctl status pdh-web --no-pager
curl -I http://127.0.0.1:3001
```

## 4) Caddy / TLS Problems

### Symptom

- Domain does not connect or certificate errors.

### Check

```bash
systemctl status caddy --no-pager
journalctl -u caddy -n 200 --no-pager
caddy validate --config /etc/caddy/Caddyfile
cat /etc/caddy/Caddyfile
```

### Typical causes

- DNS `A` records not pointing at server.
- Ports `80/443` blocked in cloud firewall or UFW.
- Wrong upstream port in Caddyfile.

### Network checks

```bash
ufw status verbose
ss -ltnp | grep -E ':80|:443|:3001|:7350'
```

## 5) Browser Connects But Gameplay Fails

### Check frontend env

```bash
SERVICE_DIR=$(systemctl show -p WorkingDirectory --value pdh-web)
cat "$SERVICE_DIR/apps/web/.env.local"
```

Must match:

- `NEXT_PUBLIC_NAKAMA_HOST=api.<domain>`
- `NEXT_PUBLIC_NAKAMA_PORT=443`
- `NEXT_PUBLIC_NAKAMA_USE_SSL=true`
- `NEXT_PUBLIC_NAKAMA_SERVER_KEY` equals backend `NAKAMA_SOCKET_SERVER_KEY`

After edits:

```bash
cd "$SERVICE_DIR"
./scripts/run-pnpm.sh -C apps/web build
systemctl restart pdh-web
```

## 6) Smoke Test Fails

Run:

```bash
SMOKE_SERVER_KEY='<nakama_socket_server_key>' ./scripts/remote-smoke.sh --url https://api.<domain> --ssl true --clients 4
```

If it fails:

- Re-check `NAKAMA_SOCKET_SERVER_KEY`.
- Verify `api.<domain>/healthcheck` returns 200.
- Tail Nakama logs during smoke run:

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f nakama
```

## 7) PowerShell Curl Quirk (Windows)

In PowerShell, `curl` maps to `Invoke-WebRequest`. Use:

```powershell
curl.exe -i https://api.<domain>/healthcheck
```

## 8) Emergency Restart Sequence

```bash
SERVICE_DIR=$(systemctl show -p WorkingDirectory --value pdh-web)
cd "$SERVICE_DIR"
docker compose --env-file .env -f docker-compose.prod.yml up -d postgres
docker compose --env-file .env -f docker-compose.prod.yml run --rm nakama-migrate
docker compose --env-file .env -f docker-compose.prod.yml up -d nakama
systemctl restart pdh-web
systemctl restart caddy
```

## 9) Logs Cheat Sheet

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f nakama
docker compose --env-file .env -f docker-compose.prod.yml logs -f postgres
journalctl -u pdh-web -f
journalctl -u caddy -f
```
