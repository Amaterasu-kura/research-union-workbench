from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import File, FileStatus, Project, ProjectMember, ProjectMemberStatus, User
from app.services.projects import can_view_project, get_project

ALLOWED_EXTENSIONS = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".doc": "doc",
    ".txt": "text",
    ".md": "text",
    ".markdown": "text",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".webp": "image",
}

MIME_BY_EXT = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def file_type_for(name: str) -> str:
    suffix = Path(name).suffix.lower()
    return ALLOWED_EXTENSIONS.get(suffix, "other")


def enqueue_file(file_id: uuid.UUID) -> None:
    if settings.env == "test":
        return
    try:
        from app.tasks.queue import queue

        queue.enqueue("app.tasks.jobs.process_file", str(file_id), job_timeout=900)
    except Exception:  # noqa: BLE001 - Redis 不可用时保留 pending，后续可重试
        return


async def save_upload(
    db: Session,
    *,
    user: User,
    upload: UploadFile,
    project_id: uuid.UUID | None,
) -> File:
    if project_id:
        project = get_project(db, project_id)
        if not can_view_project(db, user, project):
            raise HTTPException(status_code=403, detail="你不是该项目成员，不能上传文件")

    original_name = upload.filename or "未命名文件"
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"暂不支持 {suffix or '该'} 文件类型，请上传 PDF/Word/文本/图片",
        )

    now = datetime.now(UTC)
    relative_dir = Path("original") / str(now.year) / f"{now.month:02d}"
    target_dir = settings.storage_root / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    target_path = target_dir / stored_name

    hasher = hashlib.sha256()
    size = 0
    limit = settings.max_upload_mb * 1024 * 1024
    with target_path.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                output.close()
                target_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"文件不能超过 {settings.max_upload_mb}MB",
                )
            hasher.update(chunk)
            output.write(chunk)

    digest = hasher.hexdigest()
    existing = db.scalar(
        select(File).where(
            File.sha256 == digest,
            File.project_id == project_id,
            File.deleted_at.is_(None),
        )
    )
    if existing is not None:
        target_path.unlink(missing_ok=True)
        return existing

    file = File(
        filename=stored_name,
        original_name=original_name,
        mime_type=upload.content_type or MIME_BY_EXT.get(suffix, "application/octet-stream"),
        size_bytes=size,
        sha256=digest,
        storage_path=str(relative_dir / stored_name),
        file_type=file_type_for(original_name),
        uploaded_by=user.id,
        project_id=project_id,
        status=FileStatus.PENDING,
        is_temporary=project_id is None,
    )
    db.add(file)
    db.commit()
    db.refresh(file)
    enqueue_file(file.id)
    return file


def get_file(db: Session, file_id: uuid.UUID) -> File:
    file = db.get(File, file_id)
    if file is None or file.deleted_at is not None:
        raise HTTPException(status_code=404, detail="文件不存在")
    return file


def require_file_view(db: Session, user: User, file: File) -> None:
    if file.uploaded_by == user.id:
        return
    if file.project_id:
        project = get_project(db, file.project_id)
        if can_view_project(db, user, project):
            return
    if user.is_chair:
        return
    raise HTTPException(status_code=403, detail="无权访问该文件")


def list_files(
    db: Session,
    user: User,
    *,
    project_id: uuid.UUID | None = None,
    include_global: bool = False,
) -> list[File]:
    query = select(File).where(File.deleted_at.is_(None))
    if project_id:
        project = get_project(db, project_id)
        if not can_view_project(db, user, project):
            raise HTTPException(status_code=403, detail="无权查看该项目文件")
        query = query.where(File.project_id == project_id)
    elif include_global:
        own_global = and_(File.project_id.is_(None), File.uploaded_by == user.id)
        if user.is_chair:
            query = query.where(or_(own_global, File.project_id.isnot(None)))
        else:
            member_projects = select(ProjectMember.project_id).where(
                ProjectMember.user_id == user.id,
                ProjectMember.status == ProjectMemberStatus.ACTIVE,
            )
            managed_projects = select(Project.id).where(Project.lead_user_id == user.id)
            query = query.where(
                or_(own_global, File.project_id.in_(member_projects), File.project_id.in_(managed_projects))
            )
    else:
        query = query.where(File.uploaded_by == user.id)
    return list(db.scalars(query.order_by(File.created_at.desc())).all())


def absolute_path(file: File) -> Path:
    return settings.storage_root / file.storage_path


def delete_file(db: Session, user: User, file: File) -> None:
    if file.uploaded_by != user.id and not user.is_chair:
        if not file.project_id:
            raise HTTPException(status_code=403, detail="无权删除该文件")
        project = get_project(db, file.project_id)
        if not can_view_project(db, user, project):
            raise HTTPException(status_code=403, detail="无权删除该文件")
    file.deleted_at = datetime.now(UTC)
    db.commit()


def project_for_file(db: Session, file: File) -> Project | None:
    return db.get(Project, file.project_id) if file.project_id else None
