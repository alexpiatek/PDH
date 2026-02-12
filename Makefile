SHELL := /usr/bin/env bash

ENV_FILE ?= .env
COMPOSE_DEV := docker compose --env-file $(ENV_FILE) -f docker-compose.dev.yml
COMPOSE_PROD := docker compose --env-file $(ENV_FILE) -f docker-compose.prod.yml
WEB_PORT ?= 3001

.PHONY: up dev down logs test lint typecheck build smoke prod-up prod-down check dev-up dev-down

up: dev-up

dev: up
	./scripts/run-pnpm.sh -C apps/web dev --port $(WEB_PORT)

dev-up:
	./scripts/dev-up.sh

down: dev-down

dev-down:
	./scripts/dev-down.sh

logs:
	./scripts/dev-logs.sh

test:
	./scripts/test.sh

lint:
	./scripts/lint.sh

typecheck:
	./scripts/typecheck.sh

build:
	./scripts/run-pnpm.sh build

smoke:
	./scripts/smoke.sh

prod-up:
	./scripts/run-pnpm.sh -C apps/nakama build
	$(COMPOSE_PROD) up -d

prod-down:
	$(COMPOSE_PROD) down --remove-orphans

check:
	./scripts/check.sh
