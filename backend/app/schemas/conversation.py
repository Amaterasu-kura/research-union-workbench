from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import AgentActionStatus, ConversationScope, MessageRole
from app.schemas.auth import UserOut


class ConversationCreate(BaseModel):
    scope: ConversationScope = ConversationScope.GLOBAL
    project_id: uuid.UUID | None = None
    title: str | None = Field(default=None, max_length=200)
    is_default: bool = False


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    scope: ConversationScope
    project_id: uuid.UUID | None = None
    title: str
    is_default: bool
    created_by: uuid.UUID | None = None
    creator: UserOut | None = None
    created_at: datetime
    updated_at: datetime


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
    parent_id: uuid.UUID | None = None
    file_ids: list[uuid.UUID] = []


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    conversation_id: uuid.UUID
    role: MessageRole
    content: str
    parent_id: uuid.UUID | None = None
    attachments: list[dict[str, Any]] = []
    meta: dict[str, Any] = {}
    created_by: uuid.UUID | None = None
    created_at: datetime


class ChatOut(BaseModel):
    user_message: MessageOut
    assistant_message: MessageOut | None = None
    agent_run_id: uuid.UUID | None = None
    actions: list[AgentActionOut] = []


class AgentActionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    agent_run_id: uuid.UUID | None = None
    action_type: str
    payload: dict[str, Any]
    status: AgentActionStatus
    created_at: datetime


ChatOut.model_rebuild()
