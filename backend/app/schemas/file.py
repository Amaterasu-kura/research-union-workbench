from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import FileStatus, KnowledgeStatus, KnowledgeType


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    original_name: str
    mime_type: str
    size_bytes: int
    file_type: str
    status: FileStatus
    project_id: uuid.UUID | None = None
    uploaded_by: uuid.UUID | None = None
    error: str | None = None
    created_at: datetime


class KnowledgeCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    content: str = Field(min_length=2)
    knowledge_type: KnowledgeType = KnowledgeType.EXPERIENCE
    project_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    tags: list[str] = []


class KnowledgeUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    knowledge_type: KnowledgeType | None = None
    status: KnowledgeStatus | None = None


class KnowledgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    content: str
    knowledge_type: KnowledgeType
    status: KnowledgeStatus
    confidence: float
    project_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    created_at: datetime


class SearchHit(BaseModel):
    id: uuid.UUID
    kind: str = "chunk"
    title: str
    content: str
    score: float
    file_id: uuid.UUID | None = None
    file_name: str | None = None
    page_no: int | None = None
    knowledge_id: uuid.UUID | None = None


class SearchIn(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    project_id: uuid.UUID | None = None
    limit: int = Field(default=8, ge=1, le=30)
