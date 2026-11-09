from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, require_chair_or_lead
from app.models import TaskExchangeRequest, TaskStatus, User
from app.schemas.task import (
    TaskCreate,
    TaskExchangeCreate,
    TaskExchangeOut,
    TaskHistoryOut,
    TaskOut,
    TaskUpdate,
)
from app.services import tasks as task_service

router = APIRouter(prefix="/tasks", tags=["任务"])
exchange_router = APIRouter(prefix="/task-exchanges", tags=["任务交换"])


@router.get("", response_model=list[TaskOut])
def list_tasks(
    project_id: uuid.UUID | None = None,
    mine: bool = False,
    status: TaskStatus | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TaskOut]:
    return [
        TaskOut.model_validate(item)
        for item in task_service.list_tasks(db, user, project_id=project_id, mine=mine, task_status=status)
    ]


@router.post("", response_model=TaskOut, status_code=201)
def create_task(
    payload: TaskCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_chair_or_lead()),
) -> TaskOut:
    return TaskOut.model_validate(task_service.create_task(db, user, payload))


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TaskOut:
    return TaskOut.model_validate(task_service.require_task_view(db, user, task_id))


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TaskOut:
    return TaskOut.model_validate(task_service.update_task(db, user, task_id, payload))


@router.get("/{task_id}/history", response_model=list[TaskHistoryOut])
def task_history(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TaskHistoryOut]:
    return [TaskHistoryOut.model_validate(item) for item in task_service.list_history(db, user, task_id)]


@router.post("/{task_id}/exchange", response_model=TaskExchangeOut, status_code=201)
def create_exchange(
    task_id: uuid.UUID,
    payload: TaskExchangeCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TaskExchangeOut:
    request = task_service.create_exchange(db, user, task_id, payload.to_task_id, payload.message)
    return TaskExchangeOut.model_validate(request)


@exchange_router.get("", response_model=list[TaskExchangeOut])
def list_exchanges(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TaskExchangeOut]:
    rows = db.scalars(
        select(TaskExchangeRequest)
        .where(
            or_(
                TaskExchangeRequest.from_user_id == user.id,
                TaskExchangeRequest.to_user_id == user.id,
            )
        )
        .order_by(TaskExchangeRequest.created_at.desc())
    ).all()
    return [TaskExchangeOut.model_validate(item) for item in rows]


@exchange_router.post("/{exchange_id}/accept", response_model=TaskExchangeOut)
def accept_exchange(
    exchange_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TaskExchangeOut:
    return TaskExchangeOut.model_validate(task_service.respond_exchange(db, user, exchange_id, accept=True))


@exchange_router.post("/{exchange_id}/reject", response_model=TaskExchangeOut)
def reject_exchange(
    exchange_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TaskExchangeOut:
    return TaskExchangeOut.model_validate(task_service.respond_exchange(db, user, exchange_id, accept=False))
