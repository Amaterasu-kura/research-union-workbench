from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Conversation,
    ConversationScope,
    EventSeries,
    Project,
    ProjectMember,
    ProjectMemberStatus,
    ProjectStatus,
    User,
)
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.services.users import notify


def _base_project_query():
    return select(Project).options(
        selectinload(Project.members).selectinload(ProjectMember.user),
        selectinload(Project.lead),
        selectinload(Project.series),
    )


def get_project(db: Session, project_id: uuid.UUID) -> Project:
    project = db.scalar(_base_project_query().where(Project.id == project_id))
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")
    return project


def active_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID) -> ProjectMember | None:
    return db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
            ProjectMember.status == ProjectMemberStatus.ACTIVE,
        )
    )


def is_project_manager(user: User, project: Project) -> bool:
    if user.is_chair:
        return True
    if project.lead_user_id == user.id:
        return True
    return bool(
        user.is_lead and project.department_id is not None and project.department_id in user.department_ids
    )


def can_view_project(db: Session, user: User, project: Project) -> bool:
    if is_project_manager(user, project):
        return True
    return active_member(db, project.id, user.id) is not None


def require_project_view(db: Session, user: User, project_id: uuid.UUID) -> Project:
    project = get_project(db, project_id)
    if not can_view_project(db, user, project):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="你不是该项目成员")
    return project


def require_project_manager(db: Session, user: User, project_id: uuid.UUID) -> Project:
    project = get_project(db, project_id)
    if not is_project_manager(user, project):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要项目负责人或主席团权限")
    return project


def list_projects(db: Session, user: User) -> list[Project]:
    query = _base_project_query().where(Project.deleted_at.is_(None))

    if user.is_chair:
        pass
    elif user.is_lead:
        member_project_ids = select(ProjectMember.project_id).where(
            ProjectMember.user_id == user.id,
            ProjectMember.status == ProjectMemberStatus.ACTIVE,
        )
        conditions = [
            Project.lead_user_id == user.id,
            Project.id.in_(member_project_ids),
            Project.status.in_([ProjectStatus.PREPARING, ProjectStatus.RUNNING]),
        ]
        if user.department_ids:
            conditions.append(Project.department_id.in_(user.department_ids))
        query = query.where(or_(*conditions))
    else:
        member_project_ids = select(ProjectMember.project_id).where(
            ProjectMember.user_id == user.id,
            ProjectMember.status == ProjectMemberStatus.ACTIVE,
        )
        query = query.where(
            or_(
                Project.id.in_(member_project_ids),
                Project.status.in_([ProjectStatus.PREPARING, ProjectStatus.RUNNING]),
            )
        )

    return list(db.scalars(query.order_by(Project.year.desc(), Project.created_at.desc())).all())


def _get_or_create_series(db: Session, name: str, user: User) -> EventSeries:
    series = db.scalar(select(EventSeries).where(EventSeries.name == name.strip()))
    if series:
        return series
    series = EventSeries(name=name.strip(), created_by=user.id)
    db.add(series)
    db.flush()
    return series


def create_project(db: Session, user: User, payload: ProjectCreate) -> Project:
    if not (user.is_chair or user.is_lead):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="只有主席团或部门负责人可以创建项目"
        )

    series = None
    if payload.series_id:
        series = db.get(EventSeries, payload.series_id)
        if series is None:
            raise HTTPException(status_code=404, detail="活动系列不存在")
    elif payload.series_name:
        series = _get_or_create_series(db, payload.series_name, user)

    lead_user_id = payload.lead_user_id or user.id
    lead = db.get(User, lead_user_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="负责人不存在")

    project = Project(
        series_id=series.id if series else None,
        name=payload.name.strip(),
        year=payload.year,
        description=payload.description,
        status=ProjectStatus.PREPARING,
        lead_user_id=lead.id,
        department_id=lead.departments[0].id if lead.departments else None,
        created_by=user.id,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    db.add(project)
    db.flush()

    db.add(
        ProjectMember(
            project_id=project.id,
            user_id=lead.id,
            joined_by=user.id,
            joined_at=datetime.now(UTC),
            status=ProjectMemberStatus.ACTIVE,
            reviewed_by=user.id,
            reviewed_at=datetime.now(UTC),
        )
    )
    db.add(
        Conversation(
            scope=ConversationScope.PROJECT,
            project_id=project.id,
            title="项目主对话",
            created_by=user.id,
            is_default=True,
        )
    )
    db.add(
        Conversation(
            scope=ConversationScope.PROJECT,
            project_id=project.id,
            title="策划案讨论",
            created_by=user.id,
            is_default=False,
        )
    )
    notify(
        db,
        user_id=lead.id,
        type_="project_created",
        title=f"你被设为「{project.name}」的负责人",
        target_type="project",
        target_id=project.id,
    )
    db.commit()
    return get_project(db, project.id)


def update_project(db: Session, user: User, project_id: uuid.UUID, payload: ProjectUpdate) -> Project:
    project = require_project_manager(db, user, project_id)
    data = payload.model_dump(exclude_unset=True)
    if "lead_user_id" in data and data["lead_user_id"]:
        lead = db.get(User, data["lead_user_id"])
        if lead is None:
            raise HTTPException(status_code=404, detail="负责人不存在")
        existing = active_member(db, project.id, lead.id)
        if existing is None:
            db.add(
                ProjectMember(
                    project_id=project.id,
                    user_id=lead.id,
                    joined_by=user.id,
                    joined_at=datetime.now(UTC),
                    status=ProjectMemberStatus.ACTIVE,
                    reviewed_by=user.id,
                    reviewed_at=datetime.now(UTC),
                )
            )
        notify(
            db,
            user_id=lead.id,
            type_="project_lead_changed",
            title=f"你成为「{project.name}」的负责人",
            target_type="project",
            target_id=project.id,
        )
    if data.get("status") == ProjectStatus.ARCHIVED:
        project.archived_at = datetime.now(UTC)
    for key, value in data.items():
        setattr(project, key, value)
    db.commit()
    return get_project(db, project.id)


def list_members(db: Session, user: User, project_id: uuid.UUID) -> list[ProjectMember]:
    require_project_view(db, user, project_id)
    return list(
        db.scalars(
            select(ProjectMember)
            .where(ProjectMember.project_id == project_id)
            .order_by(ProjectMember.created_at.asc())
        ).all()
    )


def apply_to_project(db: Session, user: User, project_id: uuid.UUID, message: str | None) -> ProjectMember:
    project = get_project(db, project_id)
    existing = db.scalar(
        select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id)
    )
    if existing and existing.status == ProjectMemberStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="你已经是项目成员")
    if existing:
        existing.status = ProjectMemberStatus.APPLIED
        existing.joined_by = user.id
        db.commit()
        return existing
    member = ProjectMember(
        project_id=project_id,
        user_id=user.id,
        joined_by=user.id,
        status=ProjectMemberStatus.APPLIED,
    )
    db.add(member)
    if project.lead_user_id:
        notify(
            db,
            user_id=project.lead_user_id,
            type_="project_join_applied",
            title=f"{user.name} 申请加入「{project.name}」",
            body=message,
            target_type="project",
            target_id=project.id,
        )
    db.commit()
    return member


def add_member(db: Session, actor: User, project_id: uuid.UUID, user_id: uuid.UUID) -> ProjectMember:
    require_project_manager(db, actor, project_id)
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    existing = db.scalar(
        select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
    )
    if existing:
        existing.status = ProjectMemberStatus.ACTIVE
        existing.joined_by = actor.id
        existing.joined_at = datetime.now(UTC)
        existing.reviewed_by = actor.id
        existing.reviewed_at = datetime.now(UTC)
        db.commit()
        return existing
    member = ProjectMember(
        project_id=project_id,
        user_id=user_id,
        joined_by=actor.id,
        joined_at=datetime.now(UTC),
        status=ProjectMemberStatus.ACTIVE,
        reviewed_by=actor.id,
        reviewed_at=datetime.now(UTC),
    )
    db.add(member)
    notify(
        db,
        user_id=user_id,
        type_="project_member_added",
        title=f"你已加入「{get_project(db, project_id).name}」",
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    return member


def review_member(
    db: Session, actor: User, project_id: uuid.UUID, member_id: uuid.UUID, new_status: str
) -> ProjectMember:
    project = require_project_manager(db, actor, project_id)
    member = db.get(ProjectMember, member_id)
    if member is None or member.project_id != project_id:
        raise HTTPException(status_code=404, detail="成员记录不存在")
    member.status = new_status
    member.reviewed_by = actor.id
    member.reviewed_at = datetime.now(UTC)
    if new_status == ProjectMemberStatus.ACTIVE:
        member.joined_at = datetime.now(UTC)
    notify(
        db,
        user_id=member.user_id,
        type_="project_member_reviewed",
        title=f"你加入「{project.name}」的申请已{'通过' if new_status == 'active' else '处理'}",
        target_type="project",
        target_id=project.id,
    )
    db.commit()
    return member
