from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, require_chair_or_lead
from app.models import (
    AgentAction,
    AgentActionStatus,
    Conversation,
    File,
    Knowledge,
    ProjectMember,
    Task,
    TaskStatus,
    User,
)
from app.schemas.conversation import AgentActionOut
from app.schemas.project import (
    MemberAdd,
    MemberApply,
    MemberReview,
    ProjectCreate,
    ProjectMemberOut,
    ProjectOut,
    ProjectUpdate,
)
from app.services import projects as project_service

router = APIRouter(prefix="/projects", tags=["活动项目"])


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[ProjectOut]:
    return [ProjectOut.model_validate(item) for item in project_service.list_projects(db, user)]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_chair_or_lead()),
) -> ProjectOut:
    project = project_service.create_project(db, user, payload)
    return ProjectOut.model_validate(project)


@router.post("/requests", response_model=AgentActionOut, status_code=201)
def request_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgentActionOut:
    action = AgentAction(
        action_type="create_project",
        payload={
            "name": payload.name,
            "year": payload.year,
            "series_name": payload.series_name,
            "description": payload.description,
            "start_date": payload.start_date.isoformat() if payload.start_date else None,
            "end_date": payload.end_date.isoformat() if payload.end_date else None,
            "requested_by": str(user.id),
            "requested_by_name": user.name,
        },
        status=AgentActionStatus.PROPOSED,
        proposed_by=user.id,
    )
    db.add(action)
    db.commit()
    db.refresh(action)
    return AgentActionOut.model_validate(action)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProjectOut:
    project = project_service.get_project(db, project_id)
    return ProjectOut.model_validate(project)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_chair_or_lead()),
) -> ProjectOut:
    project = project_service.update_project(db, user, project_id, payload)
    return ProjectOut.model_validate(project)


@router.get("/{project_id}/members", response_model=list[ProjectMemberOut])
def list_members(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ProjectMemberOut]:
    return [
        ProjectMemberOut.model_validate(member)
        for member in project_service.list_members(db, user, project_id)
    ]


@router.post("/{project_id}/members", response_model=ProjectMemberOut, status_code=201)
def add_member(
    project_id: uuid.UUID,
    payload: MemberAdd,
    db: Session = Depends(get_db),
    user: User = Depends(require_chair_or_lead()),
) -> ProjectMemberOut:
    member = project_service.add_member(db, user, project_id, payload.user_id)
    return ProjectMemberOut.model_validate(member)


@router.post("/{project_id}/apply", response_model=ProjectMemberOut, status_code=201)
def apply_to_project(
    project_id: uuid.UUID,
    payload: MemberApply,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProjectMemberOut:
    member = project_service.apply_to_project(db, user, project_id, payload.message)
    return ProjectMemberOut.model_validate(member)


@router.patch("/{project_id}/members/{member_id}", response_model=ProjectMemberOut)
def review_member(
    project_id: uuid.UUID,
    member_id: uuid.UUID,
    payload: MemberReview,
    db: Session = Depends(get_db),
    user: User = Depends(require_chair_or_lead()),
) -> ProjectMemberOut:
    member = project_service.review_member(db, user, project_id, member_id, payload.status.value)
    return ProjectMemberOut.model_validate(member)


@router.get("/{project_id}/summary")
def project_summary(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    project_service.require_project_view(db, user, project_id)
    return {
        "conversations": db.scalar(
            select(func.count(Conversation.id)).where(
                Conversation.project_id == project_id, Conversation.deleted_at.is_(None)
            )
        )
        or 0,
        "files": db.scalar(
            select(func.count(File.id)).where(File.project_id == project_id, File.deleted_at.is_(None))
        )
        or 0,
        "knowledge": db.scalar(
            select(func.count(Knowledge.id)).where(
                Knowledge.project_id == project_id, Knowledge.deleted_at.is_(None)
            )
        )
        or 0,
        "members": db.scalar(
            select(func.count(ProjectMember.id)).where(ProjectMember.project_id == project_id)
        )
        or 0,
        "tasks": {
            "total": db.scalar(
                select(func.count(Task.id)).where(Task.project_id == project_id, Task.deleted_at.is_(None))
            )
            or 0,
            "todo": db.scalar(
                select(func.count(Task.id)).where(
                    Task.project_id == project_id, Task.status == TaskStatus.TODO, Task.deleted_at.is_(None)
                )
            )
            or 0,
            "doing": db.scalar(
                select(func.count(Task.id)).where(
                    Task.project_id == project_id, Task.status == TaskStatus.DOING, Task.deleted_at.is_(None)
                )
            )
            or 0,
            "done": db.scalar(
                select(func.count(Task.id)).where(
                    Task.project_id == project_id, Task.status == TaskStatus.DONE, Task.deleted_at.is_(None)
                )
            )
            or 0,
        },
    }
