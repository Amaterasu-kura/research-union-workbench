from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis import Redis
from sqlalchemy import text

from app.api.router import api_router
from app.core.config import settings
from app.core.db import engine

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="研究生会 AI 协同工作台 API",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://127.0.0.1:3000", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/health")
def health() -> dict:
    database = "ok"
    redis_status = "ok"
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        database = f"error: {exc}"
    try:
        Redis.from_url(settings.redis_url, socket_connect_timeout=2).ping()
    except Exception as exc:  # noqa: BLE001
        redis_status = f"error: {exc}"
    return {
        "status": "ok" if database == "ok" and redis_status == "ok" else "degraded",
        "database": database,
        "redis": redis_status,
        "llm_configured": bool(settings.llm_api_key),
    }


@app.get("/")
def root() -> dict:
    return {"name": settings.app_name, "docs": "/docs", "api": settings.api_prefix}
