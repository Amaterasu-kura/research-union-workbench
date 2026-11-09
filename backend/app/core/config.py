from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ROOT_DIR / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "研究生会 AI 协同工作台"
    env: str = "development"
    api_prefix: str = "/api/v1"
    secret_key: str = "dev-only-change-me-in-production"
    access_token_expire_minutes: int = 60 * 12
    cookie_name: str = "access_token"
    cookie_secure: bool = False
    frontend_origin: str = "http://localhost:3000"

    database_url: str = "postgresql+psycopg://research@127.0.0.1:5432/research_union"
    redis_url: str = "redis://127.0.0.1:6379/0"

    storage_root: Path = ROOT_DIR / "storage"
    max_upload_mb: int = 25

    llm_api_key: str = ""
    llm_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    llm_model: str = "qwen-plus"
    embedding_model: str = "text-embedding-v4"
    embedding_dim: int = 1024

    @property
    def storage_dirs(self) -> dict[str, Path]:
        return {
            "original": self.storage_root / "original",
            "projects": self.storage_root / "projects",
            "outputs": self.storage_root / "outputs",
            "temporary": self.storage_root / "temporary",
            "knowledge": self.storage_root / "knowledge",
        }


settings = Settings()
for _dir in settings.storage_dirs.values():
    _dir.mkdir(parents=True, exist_ok=True)
