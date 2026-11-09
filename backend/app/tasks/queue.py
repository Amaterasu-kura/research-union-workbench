from __future__ import annotations

from redis import Redis
from rq import Queue

from app.core.config import settings

redis_conn = Redis.from_url(settings.redis_url)
queue = Queue("default", connection=redis_conn)
