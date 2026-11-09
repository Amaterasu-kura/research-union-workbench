from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, require_chair_or_lead
from app.models import User
from app.schemas.auth import DepartmentOut, UserOut
from app.services.users import list_departments, list_users

router = APIRouter(tags=["用户与组织"])


@router.get("/users", response_model=list[UserOut])
def get_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_chair_or_lead()),
) -> list[UserOut]:
    return [UserOut.model_validate(user) for user in list_users(db)]


@router.get("/users/me", response_model=UserOut)
def get_me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.get("/departments", response_model=list[DepartmentOut])
def get_departments(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
) -> list[DepartmentOut]:
    return [DepartmentOut.model_validate(item) for item in list_departments(db)]
