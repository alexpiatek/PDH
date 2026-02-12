# Backup and Restore

This project includes:

- `scripts/prod-backup.sh`
- `scripts/prod-restore.sh`

Both expect production compose files at repo root and use `.env`.

## Daily Backup

Run manually:

```bash
cd /home/pdh/PDH
./scripts/prod-backup.sh
```

Custom destination:

```bash
OUT_DIR=/home/pdh/db-backups ./scripts/prod-backup.sh
```

Retention (days):

```bash
RETENTION_DAYS=30 ./scripts/prod-backup.sh
```

## Cron Setup

Run daily at 02:30 UTC:

```bash
crontab -e
```

Add:

```cron
30 2 * * * cd /home/pdh/PDH && /home/pdh/PDH/scripts/prod-backup.sh >> /var/log/pdh-backup.log 2>&1
```

## Restore Drill

Choose a backup file:

```bash
ls -lah /home/pdh/PDH/backups/postgres
```

Restore:

```bash
cd /home/pdh/PDH
./scripts/prod-restore.sh /home/pdh/PDH/backups/postgres/<file>.sql.gz
```

Then verify:

```bash
curl -i http://127.0.0.1:7350/healthcheck
SMOKE_SERVER_KEY='<nakama_socket_server_key>' ./scripts/remote-smoke.sh --url https://api.bondipoker.online --ssl true --clients 4
```

## Important

- Restore script drops and recreates the target DB.
- Practice in staging first.
- Keep off-server copies of backups.
