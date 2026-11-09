from __future__ import annotations

import hashlib
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from docx import Document  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.document.chunker import chunk_blocks  # noqa: E402
from app.document.parser import parse_file  # noqa: E402
from app.models import (  # noqa: E402
    Conversation,
    ConversationScope,
    Department,
    DocumentChunk,
    EventSeries,
    File,
    FileStatus,
    Knowledge,
    KnowledgeStatus,
    KnowledgeType,
    Project,
    ProjectMember,
    ProjectMemberStatus,
    ProjectStatus,
    Role,
    Task,
    TaskAssignment,
    TaskHistory,
    TaskPriority,
    TaskStatus,
    User,
    UserDepartment,
    UserRole,
)
from app.services.knowledge import tokenize  # noqa: E402

PASSWORD = "Passw0rd!"


def get_or_create_role(db, code: str, name: str) -> Role:
    role = db.scalar(select(Role).where(Role.code == code))
    if role is None:
        role = Role(code=code, name=name)
        db.add(role)
        db.flush()
    return role


def get_or_create_department(db, code: str, name: str) -> Department:
    department = db.scalar(select(Department).where(Department.code == code))
    if department is None:
        department = Department(code=code, name=name, description=f"{name}负责相关活动")
        db.add(department)
        db.flush()
    return department


def get_or_create_user(
    db,
    *,
    email: str,
    name: str,
    title: str,
    role: Role,
    department: Department,
) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            name=name,
            title=title,
            password_hash=hash_password(PASSWORD),
            status="active",
        )
        db.add(user)
        db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        db.add(UserDepartment(user_id=user.id, department_id=department.id, is_primary=True))
    return user


def ensure_member(db, project: Project, user: User, status: ProjectMemberStatus = ProjectMemberStatus.ACTIVE):
    member = db.scalar(
        select(ProjectMember).where(ProjectMember.project_id == project.id, ProjectMember.user_id == user.id)
    )
    if member is None:
        member = ProjectMember(
            project_id=project.id,
            user_id=user.id,
            joined_by=project.lead_user_id,
            joined_at=datetime.now(UTC) if status == ProjectMemberStatus.ACTIVE else None,
            status=status,
            reviewed_by=project.lead_user_id if status == ProjectMemberStatus.ACTIVE else None,
            reviewed_at=datetime.now(UTC) if status == ProjectMemberStatus.ACTIVE else None,
        )
        db.add(member)
    return member


def ensure_project(
    db, *, series: EventSeries, name: str, year: int, lead: User, status: ProjectStatus, description: str
) -> Project:
    project = db.scalar(select(Project).where(Project.name == name))
    if project is None:
        project = Project(
            series_id=series.id,
            name=name,
            year=year,
            description=description,
            status=status,
            lead_user_id=lead.id,
            department_id=lead.departments[0].id if lead.departments else None,
            created_by=lead.id,
        )
        db.add(project)
        db.flush()
        db.add(
            Conversation(
                scope=ConversationScope.PROJECT,
                project_id=project.id,
                title="项目主对话",
                created_by=lead.id,
                is_default=True,
            )
        )
        db.add(
            Conversation(
                scope=ConversationScope.PROJECT,
                project_id=project.id,
                title="策划案讨论",
                created_by=lead.id,
            )
        )
    return project


def ensure_task(
    db,
    *,
    project: Project,
    title: str,
    priority: TaskPriority,
    status: TaskStatus,
    assignee: User,
    due_days: int,
    description: str,
) -> Task:
    task = db.scalar(select(Task).where(Task.project_id == project.id, Task.title == title))
    if task is None:
        task = Task(
            project_id=project.id,
            title=title,
            description=description,
            priority=priority,
            status=status,
            due_at=datetime.now(UTC) + timedelta(days=due_days),
            current_assignee_id=assignee.id,
            created_by=project.lead_user_id,
            source="manual",
            completed_at=datetime.now(UTC) if status == TaskStatus.DONE else None,
        )
        db.add(task)
        db.flush()
        db.add(
            TaskAssignment(
                task_id=task.id,
                user_id=assignee.id,
                assigned_by=project.lead_user_id,
                assigned_at=datetime.now(UTC),
                is_current=True,
            )
        )
        db.add(
            TaskHistory(
                task_id=task.id,
                actor_id=project.lead_user_id,
                action="created",
                field="title",
                new_value=title,
            )
        )
    return task


def ensure_knowledge(
    db,
    *,
    title: str,
    content: str,
    knowledge_type: KnowledgeType,
    status: KnowledgeStatus,
    project: Project | None,
    creator: User,
) -> Knowledge:
    item = db.scalar(select(Knowledge).where(Knowledge.title == title))
    if item is None:
        item = Knowledge(
            title=title,
            content=content,
            knowledge_type=knowledge_type,
            status=status,
            confidence=0.8,
            project_id=project.id if project else None,
            department_id=creator.departments[0].id if creator.departments else None,
            created_by=creator.id,
            confirmed_by=creator.id if status == KnowledgeStatus.CONFIRMED else None,
        )
        db.add(item)
        db.flush()
    return item


def seed_sample_docx(db, project: Project, uploader: User) -> None:
    relative = Path("knowledge") / "2025-科技论文报告会-总结.docx"
    path = settings.storage_root / relative
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        document = Document()
        document.add_heading("2025 年科技论文报告会总结", level=1)
        document.add_heading("一、活动概况", level=2)
        document.add_paragraph(
            "2025 年科技论文报告会于 11 月 15 日在理科楼报告厅举行，共收到 42 篇投稿，"
            "最终遴选 18 篇进行口头报告，参会师生约 160 人。"
        )
        document.add_heading("二、执行经验", level=2)
        document.add_paragraph(
            "宣传节奏上，提前三周发布征稿通知，提前两周发布嘉宾介绍，提前一周发布议程，"
            "报名转化率明显高于往年。宣传物料以「一张长图 + 一条推文」为主，避免信息过载。"
        )
        document.add_paragraph(
            "评审环节建议至少预留 5 天，先由导师初审，再组织 3 位评委交叉复审。"
            "往届出现过评审截止前 1 天集中提交的情况，需要提前两天提醒。"
        )
        document.add_heading("三、风险与注意事项", level=2)
        document.add_paragraph(
            "报告厅投影接口为 HDMI，需自备转接头；现场 Wi-Fi 在高峰时段不稳定，"
            "建议提前下载全部演示文稿到本地电脑，并准备备用 U 盘。"
        )
        document.add_paragraph("茶歇采购按 150 人准备即可，实际到场通常低于报名人数 10% 左右。")
        document.save(path)

    sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    file = db.scalar(
        select(File).where(
            File.sha256 == sha256,
            File.project_id == project.id,
            File.deleted_at.is_(None),
        )
    )
    if file is None:
        original_name = path.name if project.year == 2025 else "往届参考-2025 科技论文报告会总结.docx"
        file = File(
            filename=path.name,
            original_name=original_name,
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes=path.stat().st_size,
            sha256=sha256,
            storage_path=str(relative),
            file_type="docx",
            uploaded_by=uploader.id,
            project_id=project.id,
            status=FileStatus.READY,
        )
        db.add(file)
        db.flush()
        blocks = parse_file(path, ".docx")
        chunks = chunk_blocks(blocks)
        for index, chunk in enumerate(chunks):
            db.add(
                DocumentChunk(
                    file_id=file.id,
                    project_id=project.id,
                    chunk_index=index,
                    content=chunk.content,
                    content_tokens=tokenize(chunk.content),
                    page_no=chunk.page_no,
                    bbox=chunk.bbox,
                    heading_path=chunk.heading_path,
                    token_count=chunk.token_count,
                )
            )


def main() -> None:
    db = SessionLocal()
    try:
        chair_role = get_or_create_role(db, "chair", "主席团")
        lead_role = get_or_create_role(db, "lead", "部门负责人")
        member_role = get_or_create_role(db, "member", "普通部员")

        academic = get_or_create_department(db, "academic", "学术部")
        media = get_or_create_department(db, "media", "宣传部")
        office = get_or_create_department(db, "office", "办公室")

        chair = get_or_create_user(
            db, email="chair@example.com", name="陈明", title="主席团成员", role=chair_role, department=office
        )
        lead = get_or_create_user(
            db,
            email="lead@example.com",
            name="李思",
            title="学术部负责人",
            role=lead_role,
            department=academic,
        )
        member = get_or_create_user(
            db,
            email="member@example.com",
            name="王一",
            title="学术部部员",
            role=member_role,
            department=academic,
        )
        member2 = get_or_create_user(
            db,
            email="member2@example.com",
            name="赵敏",
            title="宣传部部员",
            role=member_role,
            department=media,
        )
        member3 = get_or_create_user(
            db,
            email="member3@example.com",
            name="刘洋",
            title="办公室部员",
            role=member_role,
            department=office,
        )

        series_paper = db.scalar(select(EventSeries).where(EventSeries.name == "科技论文报告会"))
        if series_paper is None:
            series_paper = EventSeries(
                name="科技论文报告会", description="每年秋季举办的学术论文报告活动", created_by=chair.id
            )
            db.add(series_paper)
            db.flush()
        series_welcome = db.scalar(select(EventSeries).where(EventSeries.name == "研究生迎新活动"))
        if series_welcome is None:
            series_welcome = EventSeries(
                name="研究生迎新活动", description="每年秋季的迎新系列活动", created_by=chair.id
            )
            db.add(series_welcome)
            db.flush()

        project_2025 = ensure_project(
            db,
            series=series_paper,
            name="2025 年科技论文报告会",
            year=2025,
            lead=lead,
            status=ProjectStatus.ARCHIVED,
            description="2025 年秋季科技论文报告会，已归档。",
        )
        project_2026 = ensure_project(
            db,
            series=series_paper,
            name="2026 年科技论文报告会",
            year=2026,
            lead=lead,
            status=ProjectStatus.PREPARING,
            description="2026 年秋季科技论文报告会，处于筹备阶段。",
        )
        project_welcome = ensure_project(
            db,
            series=series_welcome,
            name="2026 年研究生迎新活动",
            year=2026,
            lead=chair,
            status=ProjectStatus.RUNNING,
            description="2026 级研究生迎新活动，正在执行。",
        )

        for project in (project_2025, project_2026, project_welcome):
            for user in {item.id: item for item in (chair, lead, member, member2, member3)}.values():
                ensure_member(db, project, user)
        db.flush()

        ensure_task(
            db,
            project=project_2026,
            title="发布征稿通知",
            priority=TaskPriority.URGENT,
            status=TaskStatus.DOING,
            assignee=member2,
            due_days=3,
            description="撰写并发布第一轮征稿推文，附投稿模板与截止时间。",
        )
        ensure_task(
            db,
            project=project_2026,
            title="邀请评审专家",
            priority=TaskPriority.HIGH,
            status=TaskStatus.TODO,
            assignee=lead,
            due_days=7,
            description="确认 5 位评审专家，收集简介与联系方式。",
        )
        ensure_task(
            db,
            project=project_2026,
            title="预订报告厅",
            priority=TaskPriority.HIGH,
            status=TaskStatus.DONE,
            assignee=member3,
            due_days=-2,
            description="预订理科楼报告厅，确认投影、话筒与网络。",
        )
        ensure_task(
            db,
            project=project_2026,
            title="整理往届优秀论文",
            priority=TaskPriority.MEDIUM,
            status=TaskStatus.TODO,
            assignee=member,
            due_days=10,
            description="从 2025 年归档资料中整理优秀论文清单，供宣传使用。",
        )
        ensure_task(
            db,
            project=project_welcome,
            title="迎新志愿者排班",
            priority=TaskPriority.HIGH,
            status=TaskStatus.DOING,
            assignee=member3,
            due_days=2,
            description="完成 9 月 1 日至 9 月 3 日的志愿者排班表。",
        )

        ensure_knowledge(
            db,
            title="科技论文报告会宣传节奏",
            content=(
                "提前三周发布征稿通知，提前两周发布嘉宾介绍，提前一周发布议程。"
                "宣传物料以一张长图加一条推文为主，避免信息过载。"
            ),
            knowledge_type=KnowledgeType.EXPERIENCE,
            status=KnowledgeStatus.CONFIRMED,
            project=project_2025,
            creator=lead,
        )
        ensure_knowledge(
            db,
            title="报告厅设备检查清单",
            content=(
                "重点检查 HDMI 接口、转接头、话筒电池、备用 U 盘和本地演示文稿。"
                "高峰时段 Wi-Fi 不稳定，不要依赖在线视频。"
            ),
            knowledge_type=KnowledgeType.ADVICE,
            status=KnowledgeStatus.CONFIRMED,
            project=project_2025,
            creator=member3,
        )
        ensure_knowledge(
            db,
            title="评审流程建议",
            content="评审至少预留 5 天：导师初审 2 天，评委交叉复审 2 天，汇总 1 天。",
            knowledge_type=KnowledgeType.FACT,
            status=KnowledgeStatus.PROPOSED,
            project=project_2026,
            creator=lead,
        )

        seed_sample_docx(db, project_2025, chair)
        seed_sample_docx(db, project_2026, chair)

        global_conversation = db.scalar(
            select(Conversation).where(
                Conversation.created_by == chair.id,
                Conversation.scope == ConversationScope.GLOBAL,
                Conversation.title == "主席团工作台",
            )
        )
        if global_conversation is None:
            db.add(
                Conversation(
                    scope=ConversationScope.GLOBAL,
                    title="主席团工作台",
                    created_by=chair.id,
                )
            )

        db.commit()
        print("Seed 完成。测试账号（密码均为 Passw0rd!）：")
        print("  主席团   chair@example.com")
        print("  负责人   lead@example.com")
        print("  普通成员 member@example.com / member2@example.com / member3@example.com")
    finally:
        db.close()


if __name__ == "__main__":
    main()
