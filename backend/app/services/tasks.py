from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Task,
    TaskAssignment,
    TaskExchangeRequest,
    TaskExchangeStatus,
    TaskHistory,
    TaskStatus,
    User,
)
from app.schemas.task import TaskCreate, TaskUpdate
from app.services.projects import (
    active_member,
    can_view_project,
    get_project,
    is_project_manager,
    list_projects,
)
from app.services.users import notify


def _visible_project_ids(db: Session, user: User) -> list[uuid.UUID] | None:
    if user.is_chair:
        return None
    return [project.id for project in list_projects(db, user)]


def list_tasks(
    db: Session,
    user: User,
    *,
    project_id: uuid.UUID | None = None,
    mine: bool = False,
    task_status: TaskStatus | None = None,
) -> list[Task]:
    query = select(Task).where(Task.deleted_at.is_(None))
    if project_id:
        project = get_project(db, project_id)
        if not can_view_project(db, user, project):
            raise HTTPException(status_code=403, detail="无权查看该项目任务")
        query = query.where(Task.project_id == project_id)
    elif not user.is_chair:
        visible = _visible_project_ids(db, user) or []
        query = query.where(Task.project_id.in_(visible))
    if mine:
        query = query.where(Task.current_assignee_id == user.id)
    if task_status:
        query = query.where(Task.status == task_status)
    return list(db.scalars(query.order_by(Task.status.asc(), Task.due_at.asc().nullslast())).all())


def require_task_view(db: Session, user: User, task_id: uuid.UUID) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="任务不存在")
    project = get_project(db, task.project_id)
    if not can_view_project(db, user, project):
        raise HTTPException(status_code=403, detail="无权查看该任务")
    return task


def _validate_assignee(db: Session, project_id: uuid.UUID, assignee_id: uuid.UUID) -> User:
    target = db.get(User, assignee_id)
    if target is None or target.deleted_at is not None:
        raise HTTPException(status_code=404, detail="负责人不存在")
    if active_member(db, project_id, assignee_id) is None:
        raise HTTPException(status_code=400, detail="负责人必须是项目成员")
    return target


def _record_assignment(db: Session, task: Task, assignee_id: uuid.UUID | None, actor_id: uuid.UUID) -> None:
    now = datetime.now(UTC)
    for old in db.scalars(
        select(TaskAssignment).where(TaskAssignment.task_id == task.id, TaskAssignment.is_current.is_(True))
    ).all():
        old.is_current = False
        old.unassigned_at = now
    if assignee_id:
        db.add(
            TaskAssignment(
                task_id=task.id,
                user_id=assignee_id,
                assigned_by=actor_id,
                assigned_at=now,
                is_current=True,
            )
        )


def create_task(db: Session, actor: User, payload: TaskCreate) -> Task:
    project = get_project(db, payload.project_id)
    if not is_project_manager(actor, project):
        raise HTTPException(status_code=403, detail="只有项目负责人或主席团可以发布任务")
    if payload.assignee_id:
        _validate_assignee(db, project.id, payload.assignee_id)

    task = Task(
        project_id=project.id,
        title=payload.title.strip(),
        description=payload.description,
        priority=payload.priority,
        status=TaskStatus.TODO,
        due_at=payload.due_at,
        current_assignee_id=payload.assignee_id,
        created_by=actor.id,
        source="manual",
    )
    db.add(task)
    db.flush()
    _record_assignment(db, task, payload.assignee_id, actor.id)
    db.add(
        TaskHistory(
            task_id=task.id,
            actor_id=actor.id,
            action="created",
            field="title",
            new_value=task.title,
        )
    )
    if payload.assignee_id:
        notify(
            db,
            user_id=payload.assignee_id,
            type_="task_assigned",
            title=f"你收到新任务「{task.title}」",
            target_type="task",
            target_id=task.id,
        )
    db.commit()
    db.refresh(task)
    return task


def update_task(db: Session, actor: User, task_id: uuid.UUID, payload: TaskUpdate) -> Task:
    task = require_task_view(db, actor, task_id)
    project = get_project(db, task.project_id)
    manager = is_project_manager(actor, project)
    assignee = task.current_assignee_id == actor.id

    if not manager and not assignee:
        raise HTTPException(status_code=403, detail="只有负责人、任务执行人或主席团可以修改任务")

    data = payload.model_dump(exclude_unset=True)
    if not manager:
        allowed = {"status"}
        if set(data) - allowed:
            raise HTTPException(status_code=403, detail="普通成员只能更新任务状态")

    if "assignee_id" in data and data["assignee_id"] != task.current_assignee_id:
        if not manager:
            raise HTTPException(status_code=403, detail="只有负责人可以改派任务")
        if data["assignee_id"]:
            _validate_assignee(db, project.id, data["assignee_id"])
        old_assignee = task.current_assignee_id
        _record_assignment(db, task, data["assignee_id"], actor.id)
        new_assignee = data["assignee_id"]
        db.add(
            TaskHistory(
                task_id=task.id,
                actor_id=actor.id,
                action="reassigned",
                field="assignee_id",
                old_value=str(old_assignee) if old_assignee else None,
                new_value=str(new_assignee) if new_assignee else None,
            )
        )
        if new_assignee:
            notify(
                db,
                user_id=new_assignee,
                type_="task_assigned",
                title=f"你收到任务「{task.title}」",
                target_type="task",
                target_id=task.id,
            )

    for field in ("title", "description", "priority", "due_at"):
        if field in data and data[field] != getattr(task, field):
            old_value = getattr(task, field)
            setattr(task, field, data[field])
            db.add(
                TaskHistory(
                    task_id=task.id,
                    actor_id=actor.id,
                    action="updated",
                    field=field,
                    old_value=str(old_value) if old_value is not None else None,
                    new_value=str(data[field]) if data[field] is not None else None,
                )
            )

    if "status" in data and data["status"] != task.status:
        old_status = task.status
        task.status = data["status"]
        task.completed_at = datetime.now(UTC) if task.status == TaskStatus.DONE else None
        db.add(
            TaskHistory(
                task_id=task.id,
                actor_id=actor.id,
                action="status_changed",
                field="status",
                old_value=str(old_status),
                new_value=str(task.status),
            )
        )

    db.commit()
    db.refresh(task)
    return task


def list_history(db: Session, user: User, task_id: uuid.UUID) -> list[TaskHistory]:
    require_task_view(db, user, task_id)
    return list(
        db.scalars(
            select(TaskHistory).where(TaskHistory.task_id == task_id).order_by(TaskHistory.created_at.desc())
        ).all()
    )


def create_exchange(
    db: Session, actor: User, from_task_id: uuid.UUID, to_task_id: uuid.UUID, message: str | None
) -> TaskExchangeRequest:
    from_task = require_task_view(db, actor, from_task_id)
    to_task = require_task_view(db, actor, to_task_id)
    if from_task.current_assignee_id != actor.id:
        raise HTTPException(status_code=400, detail="只能交换自己负责的任务")
    if to_task.current_assignee_id is None:
        raise HTTPException(status_code=400, detail="对方任务没有负责人")
    if to_task.current_assignee_id == actor.id:
        raise HTTPException(status_code=400, detail="不能和自己交换任务")
    if from_task.project_id != to_task.project_id:
        raise HTTPException(status_code=400, detail="只能交换同一项目内的任务")

    existing = db.scalar(
        select(TaskExchangeRequest).where(
            TaskExchangeRequest.from_task_id == from_task_id,
            TaskExchangeRequest.to_task_id == to_task_id,
            TaskExchangeRequest.status == TaskExchangeStatus.PENDING,
        )
    )
    if existing:
        raise HTTPException(status_code=400, detail="已有待处理的交换申请")

    request = TaskExchangeRequest(
        from_user_id=actor.id,
        to_user_id=to_task.current_assignee_id,
        from_task_id=from_task.id,
        to_task_id=to_task.id,
        status=TaskExchangeStatus.PENDING,
        message=message,
    )
    db.add(request)
    notify(
        db,
        user_id=to_task.current_assignee_id,
        type_="task_exchange_requested",
        title=f"{actor.name} 想和你交换任务「{to_task.title}」",
        body=message,
        target_type="task_exchange",
        target_id=request.id,
    )
    db.commit()
    db.refresh(request)
    return request


def respond_exchange(db: Session, actor: User, exchange_id: uuid.UUID, accept: bool) -> TaskExchangeRequest:
    request = db.get(TaskExchangeRequest, exchange_id)
    if request is None:
        raise HTTPException(status_code=404, detail="交换申请不存在")
    if request.to_user_id != actor.id:
        raise HTTPException(status_code=403, detail="只有接收方可以处理交换申请")
    if request.status != TaskExchangeStatus.PENDING:
        raise HTTPException(status_code=400, detail="该申请已处理")

    if not accept:
        request.status = TaskExchangeStatus.REJECTED
        request.responded_at = datetime.now(UTC)
        notify(
            db,
            user_id=request.from_user_id,
            type_="task_exchange_rejected",
            title="任务交换被拒绝",
            target_type="task_exchange",
            target_id=request.id,
        )
        db.commit()
        return request

    from_task = db.scalar(select(Task).where(Task.id == request.from_task_id).with_for_update(of=Task))
    to_task = db.scalar(select(Task).where(Task.id == request.to_task_id).with_for_update(of=Task))
    if from_task is None or to_task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if (
        from_task.current_assignee_id != request.from_user_id
        or to_task.current_assignee_id != request.to_user_id
    ):
        raise HTTPException(status_code=409, detail="任务负责人已变化，交换失败")

    _record_assignment(db, from_task, request.to_user_id, actor.id)
    _record_assignment(db, to_task, request.from_user_id, actor.id)
    from_task.current_assignee_id = request.to_user_id
    to_task.current_assignee_id = request.from_user_id

    db.add(
        TaskHistory(
            task_id=from_task.id,
            actor_id=actor.id,
            action="exchanged",
            field="assignee_id",
            old_value=str(request.from_user_id),
            new_value=str(request.to_user_id),
        )
    )
    db.add(
        TaskHistory(
            task_id=to_task.id,
            actor_id=actor.id,
            action="exchanged",
            field="assignee_id",
            old_value=str(request.to_user_id),
            new_value=str(request.from_user_id),
        )
    )
    request.status = TaskExchangeStatus.ACCEPTED
    request.responded_at = datetime.now(UTC)
    notify(
        db,
        user_id=request.from_user_id,
        type_="task_exchange_accepted",
        title="任务交换已接受",
        target_type="task_exchange",
        target_id=request.id,
    )
    db.commit()
    db.refresh(request)
    return request
