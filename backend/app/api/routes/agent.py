from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user, require_chair_or_lead
from app.models import AgentAction, AgentActionStatus, AgentRun, User
from app.schemas.conversation import AgentActionOut
from app.schemas.project import ProjectCreate, ProjectOut
from app.services import agent as agent_service
from app.services import projects as project_service

router = APIRouter(prefix="/agent", tags=["Agent"])


@router.get("/status")
def agent_status(_: User = Depends(get_current_user)) -> dict:
    return {
        "configured": agent_service.llm_configured(),
        "model": settings.llm_model,
        "embedding_model": settings.embedding_model,
        "embedding_dim": settings.embedding_dim,
    }


@router.get("/runs/{run_id}")
def get_run(
    run_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    run = db.get(AgentRun, run_id)
    if run is None or run.user_id != user.id:
        if run is None or not user.is_chair:
            raise HTTPException(status_code=404, detail="执行记录不存在")
    return {
        "id": str(run.id),
        "status": run.status,
        "worker_type": run.worker_type,
        "tokens_in": run.tokens_in,
        "tokens_out": run.tokens_out,
        "error": run.error,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
    }


@router.get("/actions", response_model=list[AgentActionOut])
def list_actions(
    status: str = "proposed",
    db: Session = Depends(get_db),
    _: User = Depends(require_chair_or_lead()),
) -> list[AgentActionOut]:
    rows = db.scalars(
        select(AgentAction)
        .where(AgentAction.status == status)
        .order_by(desc(AgentAction.created_at))
        .limit(50)
    ).all()
    return [AgentActionOut.model_validate(item) for item in rows]


@router.get("/actions/{action_id}", response_model=AgentActionOut)
def get_action(
    action_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> AgentActionOut:
    action = db.get(AgentAction, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="待确认操作不存在")
    return AgentActionOut.model_validate(action)


@router.post("/actions/{action_id}/confirm")
def confirm_action(
    action_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_chair_or_lead()),
) -> dict:
    action = db.get(AgentAction, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="待确认操作不存在")
    if action.status != AgentActionStatus.PROPOSED:
        raise HTTPException(status_code=409, detail="该操作已处理")
    if action.action_type != "create_project":
        raise HTTPException(status_code=400, detail="暂不支持该操作类型")

    data = action.payload or {}
    try:
        payload = ProjectCreate(
            name=str(data["name"]),
            year=int(data["year"]),
            series_name=data.get("series_name"),
            description=data.get("description"),
            lead_user_id=user.id,
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="操作内容不完整") from exc

    project = project_service.create_project(db, user, payload)
    action.status = AgentActionStatus.CONFIRMED
    action.confirmed_by = user.id
    action.confirmed_at = datetime.now(UTC)
    db.commit()
    return {
        "action": AgentActionOut.model_validate(action).model_dump(mode="json"),
        "project": ProjectOut.model_validate(project).model_dump(mode="json"),
    }


@router.post("/actions/{action_id}/reject", response_model=AgentActionOut)
def reject_action(
    action_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_chair_or_lead()),
) -> AgentActionOut:
    action = db.get(AgentAction, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="待确认操作不存在")
    if action.status != AgentActionStatus.PROPOSED:
        raise HTTPException(status_code=409, detail="该操作已处理")
    action.status = AgentActionStatus.REJECTED
    action.confirmed_by = user.id
    action.confirmed_at = datetime.now(UTC)
    db.commit()
    return AgentActionOut.model_validate(action)
