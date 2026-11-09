from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

os.environ["DATABASE_URL"] = "postgresql+psycopg://research@127.0.0.1:5432/research_union_test"
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["ENV"] = "test"
os.environ["LLM_API_KEY"] = ""

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from psycopg import sql  # noqa: E402
from sqlalchemy import text  # noqa: E402

ADMIN_DSN = "postgresql://research@127.0.0.1:5432/postgres"
TEST_DB = "research_union_test"


def _ensure_database() -> None:
    with psycopg.connect(ADMIN_DSN, autocommit=True) as connection:
        try:
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DB)))
        except psycopg.errors.DuplicateDatabase:
            pass


_ensure_database()

from app.core.db import SessionLocal, engine, get_db  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    Base,
    Conversation,
    ConversationScope,
    Department,
    DocumentChunk,
    EventSeries,
    File,
    FileStatus,
    Project,
    ProjectMember,
    ProjectMemberStatus,
    ProjectStatus,
    Role,
    Task,
    TaskAssignment,
    TaskPriority,
    TaskStatus,
    User,
    UserDepartment,
    UserRole,
)
from app.services.knowledge import tokenize  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def schema():
    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def seeded(db):
    table_names = [table.name for table in Base.metadata.sorted_tables]
    quoted = ", ".join(f'"{name}"' for name in table_names)
    with engine.begin() as connection:
        connection.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))

    chair_role = Role(code="chair", name="主席团")
    lead_role = Role(code="lead", name="部门负责人")
    member_role = Role(code="member", name="普通部员")
    db.add_all([chair_role, lead_role, member_role])
    academic = Department(code="academic", name="学术部")
    db.add(academic)
    db.flush()

    def user(email: str, name: str, role: Role, title: str) -> User:
        item = User(email=email, name=name, title=title, password_hash=hash_password("Passw0rd!"))
        db.add(item)
        db.flush()
        db.add(UserRole(user_id=item.id, role_id=role.id))
        db.add(UserDepartment(user_id=item.id, department_id=academic.id, is_primary=True))
        return item

    chair = user("chair@example.com", "陈明", chair_role, "主席团成员")
    lead = user("lead@example.com", "李思", lead_role, "学术部负责人")
    member = user("member@example.com", "王一", member_role, "学术部部员")
    db.flush()

    series = EventSeries(name="测试活动系列", created_by=lead.id)
    db.add(series)
    db.flush()
    project = Project(
        series_id=series.id,
        name="2026 年测试活动",
        year=2026,
        description="用于测试的项目",
        status=ProjectStatus.PREPARING,
        lead_user_id=lead.id,
        department_id=academic.id,
        created_by=lead.id,
    )
    db.add(project)
    db.flush()
    for item in (chair, lead, member):
        db.add(
            ProjectMember(
                project_id=project.id,
                user_id=item.id,
                joined_by=lead.id,
                joined_at=datetime.now(UTC),
                status=ProjectMemberStatus.ACTIVE,
                reviewed_by=lead.id,
                reviewed_at=datetime.now(UTC),
            )
        )
    conversation = Conversation(
        scope=ConversationScope.PROJECT,
        project_id=project.id,
        title="项目主对话",
        created_by=lead.id,
        is_default=True,
    )
    db.add(conversation)

    task_a = Task(
        project_id=project.id,
        title="任务 A",
        priority=TaskPriority.HIGH,
        status=TaskStatus.TODO,
        current_assignee_id=member.id,
        created_by=lead.id,
        due_at=datetime.now(UTC) + timedelta(days=3),
    )
    task_b = Task(
        project_id=project.id,
        title="任务 B",
        priority=TaskPriority.MEDIUM,
        status=TaskStatus.DOING,
        current_assignee_id=lead.id,
        created_by=lead.id,
        due_at=datetime.now(UTC) + timedelta(days=5),
    )
    db.add_all([task_a, task_b])
    db.flush()
    for task, assignee in ((task_a, member), (task_b, lead)):
        db.add(
            TaskAssignment(
                task_id=task.id,
                user_id=assignee.id,
                assigned_by=lead.id,
                assigned_at=datetime.now(UTC),
                is_current=True,
            )
        )

    file = File(
        filename="sample.docx",
        original_name="往届总结.docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=100,
        sha256=uuid.uuid4().hex,
        storage_path="original/sample.docx",
        file_type="docx",
        uploaded_by=lead.id,
        project_id=project.id,
        status=FileStatus.READY,
    )
    db.add(file)
    db.flush()
    content = "宣传节奏：提前三周发布征稿通知，提前两周发布嘉宾介绍。"
    db.add(
        DocumentChunk(
            file_id=file.id,
            project_id=project.id,
            chunk_index=0,
            content=content,
            content_tokens=tokenize(content),
            token_count=len(content),
        )
    )
    db.commit()

    return {
        "chair": str(chair.id),
        "lead": str(lead.id),
        "member": str(member.id),
        "project": str(project.id),
        "conversation": str(conversation.id),
        "task_a": str(task_a.id),
        "task_b": str(task_b.id),
        "file": str(file.id),
    }


@pytest.fixture()
def client(db):
    def override_get_db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def login(client: TestClient, email: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "Passw0rd!"})
    assert response.status_code == 200, response.text
    return response.json()
