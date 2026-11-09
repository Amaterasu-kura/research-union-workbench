from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import (
    Conversation,
    ConversationScope,
    Message,
    MessageRole,
    User,
)
from app.schemas.conversation import ConversationCreate
from app.services.projects import can_view_project, get_project


def get_conversation(db: Session, conversation_id: uuid.UUID) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="对话不存在")
    return conversation


def can_access(db: Session, user: User, conversation: Conversation) -> bool:
    if conversation.scope == ConversationScope.GLOBAL:
        return conversation.created_by == user.id
    if conversation.project_id is None:
        return False
    project = get_project(db, conversation.project_id)
    return can_view_project(db, user, project)


def require_access(db: Session, user: User, conversation_id: uuid.UUID) -> Conversation:
    conversation = get_conversation(db, conversation_id)
    if not can_access(db, user, conversation):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该对话")
    return conversation


def list_conversations(
    db: Session, user: User, scope: ConversationScope, project_id: uuid.UUID | None
) -> list[Conversation]:
    query = select(Conversation).where(Conversation.deleted_at.is_(None), Conversation.scope == scope)
    if scope == ConversationScope.GLOBAL:
        query = query.where(Conversation.created_by == user.id)
    else:
        if project_id is None:
            raise HTTPException(status_code=400, detail="项目对话需要 project_id")
        project = get_project(db, project_id)
        if not can_view_project(db, user, project):
            raise HTTPException(status_code=403, detail="你不是该项目成员")
        query = query.where(Conversation.project_id == project_id)
    query = query.order_by(Conversation.is_default.desc(), Conversation.updated_at.desc())
    return list(db.scalars(query).all())


def create_conversation(db: Session, user: User, payload: ConversationCreate) -> Conversation:
    if payload.scope == ConversationScope.PROJECT:
        if payload.project_id is None:
            raise HTTPException(status_code=400, detail="项目对话需要 project_id")
        project = get_project(db, payload.project_id)
        if not can_view_project(db, user, project):
            raise HTTPException(status_code=403, detail="你不是该项目成员")
        if payload.is_default:
            db.execute(
                update(Conversation)
                .where(
                    Conversation.project_id == project.id,
                    Conversation.scope == ConversationScope.PROJECT,
                    Conversation.is_default.is_(True),
                )
                .values(is_default=False)
            )
        title = payload.title or "新对话"
    else:
        title = payload.title or "新的全局对话"
        if payload.is_default:
            payload.is_default = False

    conversation = Conversation(
        scope=payload.scope,
        project_id=payload.project_id if payload.scope == ConversationScope.PROJECT else None,
        title=title,
        created_by=user.id,
        is_default=payload.is_default,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


def ensure_default_project_conversation(db: Session, project_id: uuid.UUID, user: User) -> Conversation:
    conversation = db.scalar(
        select(Conversation).where(
            Conversation.project_id == project_id,
            Conversation.is_default.is_(True),
            Conversation.deleted_at.is_(None),
        )
    )
    if conversation:
        return conversation
    conversation = Conversation(
        scope=ConversationScope.PROJECT,
        project_id=project_id,
        title="项目主对话",
        created_by=user.id,
        is_default=True,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


def add_message(
    db: Session,
    *,
    conversation: Conversation,
    role: MessageRole,
    content: str,
    user_id: uuid.UUID | None = None,
    attachments: list[dict] | None = None,
    meta: dict | None = None,
    parent_id: uuid.UUID | None = None,
) -> Message:
    message = Message(
        conversation_id=conversation.id,
        role=role,
        content=content,
        created_by=user_id,
        attachments=attachments or [],
        meta=meta or {},
        parent_id=parent_id,
    )
    db.add(message)
    conversation.updated_at = datetime.now(UTC)
    db.add(conversation)
    db.commit()
    db.refresh(message)
    return message


def recent_messages(db: Session, conversation_id: uuid.UUID, limit: int = 12) -> list[Message]:
    rows = list(
        db.scalars(
            select(Message)
            .where(Message.conversation_id == conversation_id, Message.deleted_at.is_(None))
            .order_by(Message.created_at.desc())
            .limit(limit)
        ).all()
    )
    return list(reversed(rows))
