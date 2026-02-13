# Deploy to Oracle Cloud (OCI)

For the full production flow (including Next.js + Caddy + troubleshooting),
see `docs/PROD_RUNBOOK.md`.

This runbook deploys Nakama + Postgres on one OCI VM using `docker-compose.prod.yml`.

## 1) Build Runtime Module

Run on your workstation or directly on the OCI VM:

```bash
./scripts/run-pnpm.sh -C apps/nakama build
```

## 2) Prepare Production Env File

Create `.env` from template and set secure values:

```bash
cp .env.example .env
```

Generate secure keys (example with OpenSSL):

```bash
openssl rand -hex 32
```

Set all of these to non-default random strings:

- `NAKAMA_SOCKET_SERVER_KEY`
- `NAKAMA_SESSION_ENCRYPTION_KEY`
- `NAKAMA_SESSION_REFRESH_ENCRYPTION_KEY`
- `NAKAMA_RUNTIME_HTTP_KEY`
- `NAKAMA_CONSOLE_SIGNING_KEY`
- `NAKAMA_CONSOLE_PASSWORD`
- `POSTGRES_PASSWORD`

## 3) Deploy on OCI VM

From repo root on server:

```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d
```

This starts:

- `postgres` (persistent volume)
- `nakama-migrate` (one-shot migration)
- `nakama` (restart policy enabled)

## 4) OCI Network Rules (Ingress)

Use either Security List or NSG for the VM subnet.

Recommended public ingress:

- `443/tcp` from `0.0.0.0/0` (if using reverse proxy TLS endpoint)
- `80/tcp` from `0.0.0.0/0` (only if needed for ACME HTTP challenge)

If exposing Nakama directly (not recommended):

- `7350/tcp` from trusted CIDRs only

Do not expose by default:

- `7351/tcp` (Nakama console)
- `5432/tcp` (Postgres)

## 5) Host Firewall (Ubuntu UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp
sudo ufw deny 7351/tcp
sudo ufw deny 5432/tcp
sudo ufw enable
sudo ufw status verbose
```

If directly exposing 7350 (temporary):

```bash
sudo ufw allow from <your-ip-or-cidr> to any port 7350 proto tcp
```

## 6) Verify Connectivity From Public Internet

```bash
curl -i https://<your-domain>/healthcheck
```

If direct 7350 exposure:

```bash
curl -i http://<public-ip>:7350/healthcheck
```

Run smoke test from any machine with repo checkout:

```bash
./scripts/remote-smoke.sh --url https://<your-domain> --clients 4 --ssl true --server-key "$NAKAMA_SOCKET_SERVER_KEY"
```

## 7) Recommended TLS Front Door (Caddy)

Expose only `443` publicly and proxy:

- `play.<domain>` -> Next.js on `127.0.0.1:3001`
- `api.<domain>` -> Nakama on `127.0.0.1:7350`

Example `Caddyfile`:

```caddy
play.example.com {
  encode gzip
  reverse_proxy 127.0.0.1:3001
}

api.example.com {
  encode gzip
  reverse_proxy 127.0.0.1:7350
}
```

Run Caddy container (example):

```bash
docker run -d --name caddy \
  --restart unless-stopped \
  -p 80:80 -p 443:443 \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v caddy_data:/data -v caddy_config:/config \
  caddy:2
```

## 8) Keep Nakama Console Private

`docker-compose.prod.yml` does not publish `7351`.

Preferred admin access:

- SSH tunnel only:

```bash
ssh -L 7351:127.0.0.1:7351 ubuntu@<server-ip>
```

Optional IP allowlist (if you must expose console):

```bash
sudo ufw allow from <admin-ip>/32 to any port 7351 proto tcp
```

## 9) Logs + Health + Rotation

Basic ops commands:

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
docker compose --env-file .env -f docker-compose.prod.yml logs -f nakama
docker compose --env-file .env -f docker-compose.prod.yml logs -f postgres
curl -fsS http://127.0.0.1:7350/healthcheck
./scripts/check.sh
```

### Secret rotation

1. Generate new key values.
2. Update `.env`.
3. Restart services:

```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d --force-recreate nakama
```

Notes:

- Rotating session-related keys invalidates active sessions/tokens.
- Rotate during maintenance windows and inform players.
