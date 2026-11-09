from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Department, Notification, User


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.lower().strip(), User.deleted_at.is_(None)))


def touch_login(db: Session, user: User) -> None:
    user.last_login_at = datetime.now(UTC)
    db.add(user)
    db.commit()


def list_users(db: Session) -> list[User]:
    return list(
        db.scalars(select(User).where(User.deleted_at.is_(None)).order_by(User.created_at.asc())).all()
    )


def list_departments(db: Session) -> list[Department]:
    return list(db.scalars(select(Department).order_by(Department.name.asc())).all())


def notify(
    db: Session,
    *,
    user_id: uuid.UUID,
    type_: str,
    title: str,
    body: str | None = None,
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
) -> Notification:
    notification = Notification(
        user_id=user_id,
        type=type_,
        title=title,
        body=body,
        target_type=target_type,
        target_id=target_id,
    )
    db.add(notification)
    return notification
