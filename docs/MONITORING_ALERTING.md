# Monitoring and Alerting

Minimum production monitoring baseline for PDH.

## 1) External Uptime Checks

Create two checks (60-second interval recommended):

- `https://play.bondipoker.online`
- `https://api.bondipoker.online/healthcheck`

Alert target:

- email, Slack, or PagerDuty (pick one and test once).

Suggested tools:

- Uptime Kuma (self-hosted)
- Better Stack Uptime
- Pingdom / StatusCake

## 2) Host Metrics Alerts

Track and alert on:

- disk usage > 80%
- memory usage > 85%
- CPU > 90% sustained for 5m
- service down: `pdh-web`, `caddy`, docker

Suggested tools:

- Netdata
- Grafana Cloud Agent + Prometheus Node Exporter

## 3) Service-Level Checks (local cron)

Create `/usr/local/bin/pdh-healthcheck.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
curl -fsS https://api.bondipoker.online/healthcheck >/dev/null
curl -fsS https://play.bondipoker.online >/dev/null
```

Run every 5 minutes via cron and notify on failure.

## 4) Logs to Watch

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f nakama
journalctl -u pdh-web -f
journalctl -u caddy -f
```

## 5) Monthly Ops Drill

Once per month:

1. Break one service intentionally (in staging).
2. Confirm alert fires.
3. Recover and verify alert closes.
