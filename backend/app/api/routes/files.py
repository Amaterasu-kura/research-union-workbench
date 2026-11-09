from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi import File as UploadFileParam
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user
from app.models import DocumentChunk, User
from app.schemas.file import FileOut
from app.services import files as file_service

router = APIRouter(prefix="/files", tags=["文件"])


@router.get("", response_model=list[FileOut])
def list_files(
    project_id: uuid.UUID | None = None,
    include_global: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[FileOut]:
    return [
        FileOut.model_validate(item)
        for item in file_service.list_files(db, user, project_id=project_id, include_global=include_global)
    ]


@router.post("", response_model=FileOut, status_code=201)
async def upload_file(
    file: UploadFile = UploadFileParam(...),
    project_id: uuid.UUID | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileOut:
    saved = await file_service.save_upload(db, user=user, upload=file, project_id=project_id)
    return FileOut.model_validate(saved)


@router.get("/{file_id}", response_model=FileOut)
def get_file(
    file_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileOut:
    file = file_service.get_file(db, file_id)
    file_service.require_file_view(db, user, file)
    return FileOut.model_validate(file)


@router.get("/{file_id}/download")
def download_file(
    file_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileResponse:
    file = file_service.get_file(db, file_id)
    file_service.require_file_view(db, user, file)
    path = file_service.absolute_path(file)
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件内容已丢失")
    return FileResponse(path, filename=file.original_name, media_type=file.mime_type)


@router.get("/{file_id}/chunks")
def list_chunks(
    file_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    file = file_service.get_file(db, file_id)
    file_service.require_file_view(db, user, file)
    chunks = db.scalars(
        select(DocumentChunk)
        .where(DocumentChunk.file_id == file_id)
        .order_by(DocumentChunk.chunk_index.asc())
    ).all()
    return [
        {
            "id": str(chunk.id),
            "index": chunk.chunk_index,
            "content": chunk.content,
            "page_no": chunk.page_no,
            "heading_path": chunk.heading_path,
        }
        for chunk in chunks
    ]


@router.post("/{file_id}/reprocess", response_model=FileOut)
def reprocess_file(
    file_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileOut:
    file = file_service.get_file(db, file_id)
    file_service.require_file_view(db, user, file)
    file_service.enqueue_file(file.id)
    return FileOut.model_validate(file)


@router.delete("/{file_id}")
def delete_file(
    file_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    file = file_service.get_file(db, file_id)
    file_service.delete_file(db, user, file)
    return {"status": "deleted"}


@router.get("/{file_id}/text")
def preview_text(
    file_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    file = file_service.get_file(db, file_id)
    file_service.require_file_view(db, user, file)
    chunks = db.scalars(
        select(DocumentChunk)
        .where(DocumentChunk.file_id == file_id)
        .order_by(DocumentChunk.chunk_index.asc())
        .limit(20)
    ).all()
    return {
        "file_id": str(file.id),
        "name": file.original_name,
        "text": "\n\n".join(chunk.content for chunk in chunks),
        "storage": str(Path(settings.storage_root) / file.storage_path),
    }
