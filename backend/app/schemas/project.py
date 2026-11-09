from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ProjectMemberStatus, ProjectStatus
from app.schemas.auth import UserOut


class EventSeriesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: str | None = None


class ProjectMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user: UserOut
    status: ProjectMemberStatus
    joined_at: datetime | None = None
    created_at: datetime


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    year: int
    description: str | None = None
    status: ProjectStatus
    series: EventSeriesOut | None = None
    department_id: uuid.UUID | None = None
    lead: UserOut | None = None
    members: list[ProjectMemberOut] = []
    start_date: date | None = None
    end_date: date | None = None
    created_at: datetime


class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    year: int = Field(ge=2020, le=2100)
    series_id: uuid.UUID | None = None
    series_name: str | None = None
    description: str | None = None
    lead_user_id: uuid.UUID | None = None
    start_date: date | None = None
    end_date: date | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = None
    status: ProjectStatus | None = None
    lead_user_id: uuid.UUID | None = None
    start_date: date | None = None
    end_date: date | None = None


class MemberApply(BaseModel):
    message: str | None = None


class MemberAdd(BaseModel):
    user_id: uuid.UUID


class MemberReview(BaseModel):
    status: ProjectMemberStatus
