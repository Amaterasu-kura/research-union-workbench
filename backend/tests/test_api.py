from __future__ import annotations

from io import BytesIO

from docx import Document

from app.tasks.jobs import process_file
from tests.conftest import login


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_login_and_me(client, seeded):
    bad = client.post("/api/v1/auth/login", json={"email": "lead@example.com", "password": "wrong"})
    assert bad.status_code == 401

    payload = login(client, "lead@example.com")
    assert payload["user"]["name"] == "李思"
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "lead@example.com"
    assert me.json()["roles"][0]["code"] == "lead"


def test_project_creation_rbac(client, seeded):
    login(client, "member@example.com")
    forbidden = client.post("/api/v1/projects", json={"name": "成员不能建项目", "year": 2026})
    assert forbidden.status_code == 403

    client.cookies.clear()
    login(client, "lead@example.com")
    created = client.post(
        "/api/v1/projects",
        json={"name": "2027 年测试活动", "year": 2027, "series_name": "测试活动系列"},
    )
    assert created.status_code == 201, created.text
    project = created.json()
    assert project["name"] == "2027 年测试活动"
    assert project["lead"]["name"] == "李思"
    assert len(project["members"]) == 1

    conversations = client.get(f"/api/v1/conversations?scope=project&project_id={project['id']}")
    assert conversations.status_code == 200
    assert any(item["is_default"] for item in conversations.json())

    summary = client.get(f"/api/v1/projects/{project['id']}/summary")
    assert summary.status_code == 200
    assert summary.json()["members"] == 1


def test_task_flow_and_history(client, seeded):
    login(client, "lead@example.com")
    created = client.post(
        "/api/v1/tasks",
        json={
            "project_id": seeded["project"],
            "title": "发布推文",
            "priority": "high",
            "assignee_id": seeded["member"],
        },
    )
    assert created.status_code == 201, created.text
    task_id = created.json()["id"]

    client.cookies.clear()
    login(client, "member@example.com")
    updated = client.patch(f"/api/v1/tasks/{task_id}", json={"status": "doing"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "doing"

    forbidden = client.patch(f"/api/v1/tasks/{task_id}", json={"assignee_id": seeded["lead"]})
    assert forbidden.status_code == 403

    history = client.get(f"/api/v1/tasks/{task_id}/history")
    assert history.status_code == 200
    assert any(item["action"] == "status_changed" for item in history.json())


def test_task_exchange(client, seeded):
    login(client, "member@example.com")
    created = client.post(
        f"/api/v1/tasks/{seeded['task_a']}/exchange",
        json={"to_task_id": seeded["task_b"], "message": "我这两天有空"},
    )
    assert created.status_code == 201, created.text
    exchange_id = created.json()["id"]

    client.cookies.clear()
    login(client, "lead@example.com")
    accepted = client.post(f"/api/v1/task-exchanges/{exchange_id}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"

    task_a = client.get(f"/api/v1/tasks/{seeded['task_a']}").json()
    task_b = client.get(f"/api/v1/tasks/{seeded['task_b']}").json()
    assert task_a["current_assignee_id"] == seeded["lead"]
    assert task_b["current_assignee_id"] == seeded["member"]


def test_knowledge_search(client, seeded):
    login(client, "member@example.com")
    response = client.post("/api/v1/knowledge/search", json={"query": "宣传节奏怎么安排", "limit": 5})
    assert response.status_code == 200, response.text
    hits = response.json()
    assert hits
    assert any("宣传节奏" in hit["content"] for hit in hits)
    assert any(hit["file_name"] == "往届总结.docx" for hit in hits if hit["kind"] == "chunk")


def test_chat_without_llm_key(client, seeded):
    login(client, "lead@example.com")
    response = client.post(
        f"/api/v1/conversations/{seeded['conversation']}/chat",
        json={"content": "帮我梳理宣传重点"},
    )
    assert response.status_code == 503
    messages = client.get(f"/api/v1/conversations/{seeded['conversation']}/messages")
    assert messages.status_code == 200
    assert any(item["content"] == "帮我梳理宣传重点" for item in messages.json())


def test_file_upload_and_process(client, seeded):
    login(client, "lead@example.com")
    document = Document()
    document.add_heading("测试活动总结", level=1)
    document.add_paragraph("宣传节奏：提前三周发布征稿通知，提前两周发布嘉宾介绍。")
    buffer = BytesIO()
    document.save(buffer)
    buffer.seek(0)

    response = client.post(
        "/api/v1/files",
        data={"project_id": seeded["project"]},
        files={
            "file": (
                "测试活动总结.docx",
                buffer.getvalue(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert response.status_code == 201, response.text
    file_id = response.json()["id"]

    result = process_file(file_id)
    assert result["ok"] is True, result
    assert result["chunks"] >= 1

    file = client.get(f"/api/v1/files/{file_id}")
    assert file.status_code == 200
    assert file.json()["status"] == "ready"

    chunks = client.get(f"/api/v1/files/{file_id}/chunks")
    assert chunks.status_code == 200
    assert any("宣传节奏" in chunk["content"] for chunk in chunks.json())

    search = client.post(
        "/api/v1/knowledge/search", json={"query": "征稿通知", "project_id": seeded["project"]}
    )
    assert search.status_code == 200
    assert any("征稿通知" in hit["content"] for hit in search.json())


def test_agent_proposal_and_confirm(client, seeded, monkeypatch):
    import app.services.agent as agent_service

    def fake_chat(messages, *, temperature=0.3, json_mode=False, max_tokens=1600):
        if json_mode:
            return (
                '{"is_project": true, "name": "2027 年测试活动", "year": 2027, '
                '"series_name": "测试活动系列", "description": "从对话创建", "reason": "用户提出"}',
                {"prompt_tokens": 10, "completion_tokens": 20},
            )
        return ("我建议先确认活动名称与年份，再创建项目。", {"prompt_tokens": 10, "completion_tokens": 20})

    monkeypatch.setattr(agent_service, "chat_completion", fake_chat)
    login(client, "chair@example.com")
    conversation = client.post(
        "/api/v1/conversations",
        json={"scope": "global", "title": "新活动想法"},
    ).json()
    response = client.post(
        f"/api/v1/conversations/{conversation['id']}/chat",
        json={"content": "帮我创建一个 2027 年测试活动项目"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["assistant_message"] is not None
    assert len(payload["actions"]) == 1
    action = payload["actions"][0]
    assert action["action_type"] == "create_project"
    assert action["status"] == "proposed"

    confirmed = client.post(f"/api/v1/agent/actions/{action['id']}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    project = confirmed.json()["project"]
    assert project["name"] == "2027 年测试活动"
    assert project["lead"]["email"] == "chair@example.com"

    listed = client.get("/api/v1/projects").json()
    assert any(item["id"] == project["id"] for item in listed)


def test_project_discovery_and_apply(client, seeded):
    login(client, "lead@example.com")
    created = client.post(
        "/api/v1/projects",
        json={"name": "2027 年申请测试", "year": 2027, "series_name": "测试活动系列"},
    )
    assert created.status_code == 201
    project_id = created.json()["id"]

    client.cookies.clear()
    login(client, "member@example.com")
    detail = client.get(f"/api/v1/projects/{project_id}")
    assert detail.status_code == 200
    assert detail.json()["name"] == "2027 年申请测试"
    assert client.get(f"/api/v1/projects/{project_id}/summary").status_code == 403

    applied = client.post(f"/api/v1/projects/{project_id}/apply", json={"message": "想参与"})
    assert applied.status_code == 201
    member_row_id = applied.json()["id"]

    client.cookies.clear()
    login(client, "lead@example.com")
    approved = client.patch(
        f"/api/v1/projects/{project_id}/members/{member_row_id}",
        json={"status": "active"},
    )
    assert approved.status_code == 200

    client.cookies.clear()
    login(client, "member@example.com")
    assert client.get(f"/api/v1/projects/{project_id}/summary").status_code == 200


def test_manual_project_request_and_confirm(client, seeded):
    login(client, "member@example.com")
    requested = client.post(
        "/api/v1/projects/requests",
        json={"name": "2027 年成员申请项目", "year": 2027, "series_name": "测试活动系列", "description": "成员申请"},
    )
    assert requested.status_code == 201, requested.text
    action = requested.json()
    assert action["action_type"] == "create_project"
    assert action["status"] == "proposed"
    assert client.get("/api/v1/agent/actions").status_code == 403

    client.cookies.clear()
    login(client, "lead@example.com")
    actions = client.get("/api/v1/agent/actions?status=proposed")
    assert actions.status_code == 200
    assert any(item["id"] == action["id"] for item in actions.json())

    confirmed = client.post(f"/api/v1/agent/actions/{action['id']}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    project = confirmed.json()["project"]
    assert project["name"] == "2027 年成员申请项目"
    assert project["lead"]["email"] == "lead@example.com"
