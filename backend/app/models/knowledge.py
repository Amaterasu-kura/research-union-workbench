from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UUIDMixin
from app.models.enums import KnowledgeStatus, KnowledgeType, str_enum


class Knowledge(UUIDMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "knowledge"
    __table_args__ = (Index("ix_knowledge_status_type", "status", "knowledge_type"),)

    title: Mapped[str] = mapped_column(String(300))
    content: Mapped[str] = mapped_column(Text)
    knowledge_type: Mapped[KnowledgeType] = mapped_column(
        str_enum(KnowledgeType), default=KnowledgeType.EXPERIENCE, nullable=False
    )
    status: Mapped[KnowledgeStatus] = mapped_column(
        str_enum(KnowledgeStatus), default=KnowledgeStatus.PROPOSED, nullable=False
    )
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class KnowledgeSource(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "knowledge_sources"
    __table_args__ = (Index("ix_knowledge_sources_source", "source_type", "source_id"),)

    knowledge_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge.id", ondelete="CASCADE"), index=True
    )
    source_type: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[uuid.UUID] = mapped_column()
    excerpt: Mapped[str | None] = mapped_column(Text)


class KnowledgeTag(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "knowledge_tags"

    name: Mapped[str] = mapped_column(String(100), unique=True)


class KnowledgeTagRelation(Base):
    __tablename__ = "knowledge_tag_relations"
    __table_args__ = (UniqueConstraint("knowledge_id", "tag_id", name="uq_knowledge_tag"),)

    knowledge_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_tags.id", ondelete="CASCADE"), primary_key=True
    )
