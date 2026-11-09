from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, require_chair_or_lead
from app.models import Knowledge, KnowledgeStatus, User
from app.schemas.file import (
    KnowledgeCreate,
    KnowledgeOut,
    KnowledgeUpdate,
    SearchHit,
    SearchIn,
)
from app.services import knowledge as knowledge_service

router = APIRouter(prefix="/knowledge", tags=["知识库"])


@router.post("/search", response_model=list[SearchHit])
def search_knowledge(
    payload: SearchIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SearchHit]:
    return knowledge_service.search(
        db, query=payload.query, user=user, project_id=payload.project_id, limit=payload.limit
    )


@router.get("", response_model=list[KnowledgeOut])
def list_knowledge(
    status: KnowledgeStatus | None = None,
    project_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[KnowledgeOut]:
    return [
        KnowledgeOut.model_validate(item)
        for item in knowledge_service.list_knowledge(db, status=status, project_id=project_id)
    ]


@router.get("/{knowledge_id}", response_model=KnowledgeOut)
def get_knowledge(
    knowledge_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> KnowledgeOut:
    item = db.get(Knowledge, knowledge_id)
    if item is None or item.deleted_at is not None:
        raise HTTPException(status_code=404, detail="知识条目不存在")
    return KnowledgeOut.model_validate(item)


@router.post("", response_model=KnowledgeOut, status_code=201)
def create_knowledge(
    payload: KnowledgeCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> KnowledgeOut:
    item = knowledge_service.create_knowledge(db, user, payload)
    return KnowledgeOut.model_validate(item)


@router.patch("/{knowledge_id}", response_model=KnowledgeOut)
def update_knowledge(
    knowledge_id: uuid.UUID,
    payload: KnowledgeUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_chair_or_lead()),
) -> KnowledgeOut:
    item = knowledge_service.update_knowledge(db, user, knowledge_id, payload)
    return KnowledgeOut.model_validate(item)
