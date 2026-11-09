from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models import ConversationScope, Message, MessageRole, User
from app.schemas.conversation import (
    AgentActionOut,
    ChatOut,
    ConversationCreate,
    ConversationOut,
    MessageCreate,
    MessageOut,
)
from app.services import agent as agent_service
from app.services import conversations as conversation_service
from app.services.projects import get_project, is_project_manager

router = APIRouter(prefix="/conversations", tags=["对话"])


@router.get("", response_model=list[ConversationOut])
def list_conversations(
    scope: ConversationScope = ConversationScope.GLOBAL,
    project_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ConversationOut]:
    items = conversation_service.list_conversations(db, user, scope, project_id)
    return [ConversationOut.model_validate(item) for item in items]


@router.post("", response_model=ConversationOut, status_code=201)
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ConversationOut:
    conversation = conversation_service.create_conversation(db, user, payload)
    return ConversationOut.model_validate(conversation)


@router.get("/{conversation_id}", response_model=ConversationOut)
def get_conversation(
    conversation_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ConversationOut:
    conversation = conversation_service.require_access(db, user, conversation_id)
    return ConversationOut.model_validate(conversation)


@router.patch("/{conversation_id}", response_model=ConversationOut)
def rename_conversation(
    conversation_id: uuid.UUID,
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ConversationOut:
    conversation = conversation_service.require_access(db, user, conversation_id)
    title = str(payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    if conversation.created_by != user.id and not user.is_chair:
        if conversation.project_id:
            project = get_project(db, conversation.project_id)
            if not is_project_manager(user, project):
                raise HTTPException(status_code=403, detail="只有创建者、负责人或主席团可以改标题")
        else:
            raise HTTPException(status_code=403, detail="只有创建者可以改标题")
    conversation.title = title[:200]
    db.commit()
    db.refresh(conversation)
    return ConversationOut.model_validate(conversation)


@router.delete("/{conversation_id}")
def delete_conversation(
    conversation_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    conversation = conversation_service.require_access(db, user, conversation_id)
    allowed = conversation.created_by == user.id or user.is_chair
    if conversation.project_id:
        project = get_project(db, conversation.project_id)
        allowed = allowed or is_project_manager(user, project)
    if not allowed:
        raise HTTPException(status_code=403, detail="只有负责人或主席团可以删除项目对话")
    if conversation.is_default:
        raise HTTPException(status_code=400, detail="主对话不能删除，请先指定新的主对话")
    conversation.deleted_at = datetime.now(UTC)
    db.commit()
    return {"status": "deleted"}


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(
    conversation_id: uuid.UUID,
    limit: int = Query(default=80, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[MessageOut]:
    conversation_service.require_access(db, user, conversation_id)
    rows = list(
        db.scalars(
            select(Message)
            .where(Message.conversation_id == conversation_id, Message.deleted_at.is_(None))
            .order_by(Message.created_at.asc())
            .limit(limit)
        ).all()
    )
    return [MessageOut.model_validate(item) for item in rows]


@router.post("/{conversation_id}/messages", response_model=MessageOut, status_code=201)
def create_message(
    conversation_id: uuid.UUID,
    payload: MessageCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MessageOut:
    conversation = conversation_service.require_access(db, user, conversation_id)
    message = conversation_service.add_message(
        db,
        conversation=conversation,
        role=MessageRole.USER,
        content=payload.content,
        user_id=user.id,
        parent_id=payload.parent_id,
        attachments=[{"file_id": str(file_id)} for file_id in payload.file_ids],
    )
    return MessageOut.model_validate(message)


@router.post("/{conversation_id}/chat", response_model=ChatOut)
def chat(
    conversation_id: uuid.UUID,
    payload: MessageCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ChatOut:
    conversation = conversation_service.require_access(db, user, conversation_id)
    user_message, assistant, run, actions = agent_service.respond(
        db,
        conversation=conversation,
        user=user,
        content=payload.content,
        parent_id=payload.parent_id,
        file_ids=payload.file_ids,
    )
    return ChatOut(
        user_message=MessageOut.model_validate(user_message),
        assistant_message=MessageOut.model_validate(assistant),
        agent_run_id=run.id,
        actions=[AgentActionOut.model_validate(item) for item in actions],
    )
