from __future__ import annotations

from enum import StrEnum

from sqlalchemy import Enum


class ProjectStatus(StrEnum):
    PREPARING = "preparing"
    RUNNING = "running"
    ENDED = "ended"
    ARCHIVED = "archived"


class ProjectMemberStatus(StrEnum):
    APPLIED = "applied"
    ACTIVE = "active"
    REJECTED = "rejected"
    LEFT = "left"


class ConversationScope(StrEnum):
    GLOBAL = "global"
    PROJECT = "project"


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"


class AgentRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AgentActionStatus(StrEnum):
    PROPOSED = "proposed"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    EXPIRED = "expired"


class FileStatus(StrEnum):
    PENDING = "pending"
    PARSING = "parsing"
    READY = "ready"
    FAILED = "failed"


class DocumentVersionStatus(StrEnum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    ARCHIVED = "archived"


class KnowledgeType(StrEnum):
    FACT = "fact"
    EXPERIENCE = "experience"
    ADVICE = "advice"
    INFERENCE = "inference"


class KnowledgeStatus(StrEnum):
    PROPOSED = "proposed"
    CONFIRMED = "confirmed"
    ARCHIVED = "archived"


class TaskStatus(StrEnum):
    TODO = "todo"
    DOING = "doing"
    DONE = "done"


class TaskPriority(StrEnum):
    URGENT = "urgent"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class TaskExchangeStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class RoleCode(StrEnum):
    CHAIR = "chair"
    LEAD = "lead"
    MEMBER = "member"


def str_enum(enum_cls: type[StrEnum], length: int = 32) -> Enum:
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [item.value for item in cls],
        validate_strings=True,
    )
