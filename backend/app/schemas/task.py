from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import TaskExchangeStatus, TaskPriority, TaskStatus
from app.schemas.auth import UserOut


class TaskCreate(BaseModel):
    project_id: uuid.UUID
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    priority: TaskPriority = TaskPriority.MEDIUM
    due_at: datetime | None = None
    assignee_id: uuid.UUID | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = None
    priority: TaskPriority | None = None
    status: TaskStatus | None = None
    due_at: datetime | None = None
    assignee_id: uuid.UUID | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    description: str | None = None
    priority: TaskPriority
    status: TaskStatus
    due_at: datetime | None = None
    current_assignee_id: uuid.UUID | None = None
    assignee: UserOut | None = None
    created_by: uuid.UUID | None = None
    source: str
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class TaskHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    action: str
    field: str | None = None
    old_value: str | None = None
    new_value: str | None = None
    actor_id: uuid.UUID | None = None
    created_at: datetime


class TaskExchangeCreate(BaseModel):
    to_task_id: uuid.UUID
    message: str | None = None


class TaskExchangeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    from_task_id: uuid.UUID
    to_task_id: uuid.UUID
    status: TaskExchangeStatus
    message: str | None = None
    created_at: datetime
    responded_at: datetime | None = None
