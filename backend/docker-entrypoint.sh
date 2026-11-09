#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS:-1}" = "1" ] && [ "${1:-}" = "uvicorn" ]; then
  echo "Running database migrations..."
  alembic upgrade head
fi

exec "$@"
