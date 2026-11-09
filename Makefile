SHELL := /bin/bash
ROOT := $(CURDIR)
UV_CACHE_DIR := $(ROOT)/.runtime/uv-cache
PYTHON := /opt/homebrew/bin/python3.13

.PHONY: install services stop migrate seed backend worker frontend test lint compose-up compose-down logs

install:
	cd backend && UV_CACHE_DIR=$(UV_CACHE_DIR) uv sync --python $(PYTHON)
	cd frontend && pnpm install --store-dir ../.runtime/pnpm-store

services:
	./scripts/dev-services.sh

stop:
	./scripts/stop-services.sh

migrate:
	cd backend && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run alembic upgrade head

seed:
	cd backend && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python scripts/seed.py

backend:
	cd backend && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

worker:
	cd backend && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run rq worker -u redis://127.0.0.1:6379/0 default

frontend:
	cd frontend && pnpm dev

test:
	cd backend && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run pytest

lint:
	cd backend && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run ruff check .
	cd frontend && pnpm typecheck

compose-up:
	docker compose up -d --build

compose-down:
	docker compose down

logs:
	docker compose logs -f --tail=100
