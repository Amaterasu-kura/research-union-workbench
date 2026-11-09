#!/bin/sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -x /opt/homebrew/opt/redis/bin/redis-cli ]; then
  REDIS_CLI=/opt/homebrew/opt/redis/bin/redis-cli
else
  REDIS_CLI="$(command -v redis-cli)"
fi

if "$REDIS_CLI" -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
  "$REDIS_CLI" -h 127.0.0.1 -p 6379 shutdown nosave 2>/dev/null || true
fi
rm -f .runtime/redis.pid

if [ -x /opt/homebrew/opt/postgresql@17/bin/pg_ctl ]; then
  /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D .runtime/pgdata stop -m fast || true
fi

echo "本地开发服务已停止。"
