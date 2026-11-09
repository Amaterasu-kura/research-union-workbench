from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import delete

from app.core.config import settings
from app.core.db import SessionLocal
from app.document.chunker import chunk_blocks
from app.document.parser import parse_file
from app.models import DocumentChunk, File, FileProcessingRun, FileStatus
from app.services.agent import embed_texts
from app.services.knowledge import tokenize

logger = logging.getLogger(__name__)


def process_file(file_id: str) -> dict:
    session = SessionLocal()
    run = None
    try:
        file = session.get(File, uuid.UUID(file_id))
        if file is None:
            return {"ok": False, "error": "file not found"}

        file.status = FileStatus.PARSING
        file.error = None
        run = FileProcessingRun(
            file_id=file.id,
            job_id=file_id,
            status="running",
            started_at=datetime.now(UTC),
        )
        session.add(run)
        session.commit()

        path = settings.storage_root / file.storage_path
        suffix = Path(file.original_name).suffix.lower()
        parser = "pymupdf" if suffix == ".pdf" else "python-docx" if suffix == ".docx" else "text"
        run.parser = parser

        blocks = parse_file(path, suffix)
        chunks = chunk_blocks(blocks)
        session.execute(delete(DocumentChunk).where(DocumentChunk.file_id == file.id))

        texts = [chunk.content for chunk in chunks]
        vectors = embed_texts(texts) if texts else []

        for index, chunk in enumerate(chunks):
            embedding = vectors[index] if index < len(vectors) else None
            session.add(
                DocumentChunk(
                    file_id=file.id,
                    project_id=file.project_id,
                    chunk_index=index,
                    content=chunk.content,
                    content_tokens=tokenize(chunk.content),
                    page_no=chunk.page_no,
                    bbox=chunk.bbox,
                    heading_path=chunk.heading_path,
                    token_count=chunk.token_count,
                    embedding=embedding,
                )
            )

        file.status = FileStatus.READY
        run.status = "succeeded"
        run.finished_at = datetime.now(UTC)
        session.commit()
        return {"ok": True, "chunks": len(chunks), "embedded": len(vectors)}
    except Exception as exc:  # noqa: BLE001 - 任务失败需要落库
        logger.exception("process_file failed: %s", exc)
        session.rollback()
        file = session.get(File, uuid.UUID(file_id))
        if file is not None:
            file.status = FileStatus.FAILED
            file.error = str(exc)[:1000]
            if run is not None:
                run.status = "failed"
                run.error = str(exc)[:1000]
                run.finished_at = datetime.now(UTC)
            session.commit()
        return {"ok": False, "error": str(exc)}
    finally:
        session.close()
