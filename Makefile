SHELL := /usr/bin/env bash

ENV_FILE ?= .env
COMPOSE_DEV := docker compose --env-file $(ENV_FILE) -f docker-compose.dev.yml
COMPOSE_PROD := docker compose --env-file $(ENV_FILE) -f docker-compose.prod.yml

.PHONY: dev-up dev-down logs test smoke prod-up prod-down check

dev-up:
	./scripts/dev-up.sh

dev-down:
	./scripts/dev-down.sh

logs:
	./scripts/dev-logs.sh

test:
	./scripts/test.sh

smoke:
	./scripts/smoke.sh

prod-up:
	./scripts/run-pnpm.sh -C apps/nakama build
	$(COMPOSE_PROD) up -d

prod-down:
	$(COMPOSE_PROD) down --remove-orphans

check:
	./scripts/check.sh
