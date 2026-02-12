# Non-Root Migration Guide

Move production from `root` to a dedicated deploy user (`pdh`).

## 1) Create User and Docker Access

```bash
sudo adduser --disabled-password --gecos "" pdh
sudo usermod -aG docker pdh
```

## 2) Move Repo

```bash
sudo rsync -a --delete /root/PDH/ /home/pdh/PDH/
sudo chown -R pdh:pdh /home/pdh/PDH
```

## 3) Ensure Runtime Files Exist

```bash
sudo -u pdh -H bash -lc 'cd /home/pdh/PDH && ./scripts/run-pnpm.sh install && ./scripts/run-pnpm.sh -C packages/engine build && ./scripts/run-pnpm.sh -C apps/nakama build && ./scripts/run-pnpm.sh -C apps/web build'
```

## 4) Replace Web Service User

Edit `/etc/systemd/system/pdh-web.service`:

```ini
[Service]
User=pdh
WorkingDirectory=/home/pdh/PDH
Environment=NODE_ENV=production
ExecStart=/usr/bin/env pnpm -C apps/web start --port 3001
Restart=always
RestartSec=5
```

Apply:

```bash
sudo systemctl daemon-reload
sudo systemctl restart pdh-web
sudo systemctl status pdh-web --no-pager
```

## 5) Run Docker Compose as `pdh`

Use:

```bash
sudo -u pdh -H bash -lc 'cd /home/pdh/PDH && docker compose --env-file .env -f docker-compose.prod.yml ps'
```

If needed, stop old root-started stack and restart as `pdh`:

```bash
cd /home/pdh/PDH
docker compose --env-file .env -f docker-compose.prod.yml up -d
```

## 6) Verify

```bash
curl -I https://play.bondipoker.online
curl -i https://api.bondipoker.online/healthcheck
```

## Notes

- Keep Caddy managed by root/systemd.
- Keep app code and `.env` owned by `pdh`.
- Do not run day-to-day deploys as root.
