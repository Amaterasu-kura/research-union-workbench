#!/bin/sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -x /opt/homebrew/opt/postgresql@17/bin/pg_ctl ]; then
  PGBIN=/opt/homebrew/opt/postgresql@17/bin
elif command -v pg_ctl >/dev/null 2>&1; then
  PGBIN="$(dirname "$(command -v pg_ctl)")"
else
  echo "找不到 PostgreSQL，请先 brew install postgresql@17 pgvector" >&2
  exit 1
fi

mkdir -p .runtime/pgdata .runtime/redis .runtime/logs

if [ ! -f .runtime/pgdata/PG_VERSION ]; then
  echo "初始化本地 PostgreSQL 集群（trust 认证，仅监听 127.0.0.1）..."
  "$PGBIN/initdb" -D .runtime/pgdata -U research --auth=trust --encoding=UTF8 --locale=C >/dev/null
fi

if ! "$PGBIN/pg_ctl" -D .runtime/pgdata status >/dev/null 2>&1; then
  "$PGBIN/pg_ctl" -D .runtime/pgdata \
    -l .runtime/logs/postgres.log \
    -o "-p 5432 -c listen_addresses=127.0.0.1 -c shared_buffers=512MB -c max_connections=50" \
    start
else
  echo "PostgreSQL 已在运行。"
fi

"$PGBIN/createdb" -h 127.0.0.1 -p 5432 -U research research_union 2>/dev/null || true
"$PGBIN/psql" -h 127.0.0.1 -p 5432 -U research -d research_union \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

if [ -x /opt/homebrew/opt/redis/bin/redis-server ]; then
  REDIS_SERVER=/opt/homebrew/opt/redis/bin/redis-server
  REDIS_CLI=/opt/homebrew/opt/redis/bin/redis-cli
else
  REDIS_SERVER="$(command -v redis-server)"
  REDIS_CLI="$(command -v redis-cli)"
fi

if ! "$REDIS_CLI" -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
  "$REDIS_SERVER" --port 6379 --bind 127.0.0.1 \
    --dir "$ROOT/.runtime/redis" \
    --pidfile "$ROOT/.runtime/redis.pid" \
    --logfile "$ROOT/.runtime/logs/redis.log" \
    --daemonize yes
else
  echo "Redis 已在运行。"
fi

echo "PostgreSQL: 127.0.0.1:5432/research_union"
echo "Redis:      127.0.0.1:6379"
