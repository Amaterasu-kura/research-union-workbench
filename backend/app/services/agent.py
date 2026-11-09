from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import (
    AgentAction,
    AgentActionStatus,
    AgentRun,
    AgentRunStatus,
    Conversation,
    ConversationScope,
    Message,
    MessageRole,
    Project,
    User,
)
from app.services.conversations import add_message, recent_messages
from app.services.knowledge import search

logger = logging.getLogger(__name__)

PROJECT_KEYWORDS = ("创建项目", "新建项目", "立项", "办一个", "办一场", "活动想法", "策划一个", "策划一场")


class LLMUnavailable(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }


def chat_completion(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.3,
    json_mode: bool = False,
    max_tokens: int = 1600,
) -> tuple[str, dict[str, int]]:
    if not settings.llm_api_key:
        raise LLMUnavailable("尚未配置 LLM_API_KEY，无法调用云端模型")

    url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    with httpx.Client(timeout=90) as client:
        response = client.post(url, headers=_headers(), json=payload)
        if response.status_code == 400 and json_mode:
            payload.pop("response_format", None)
            response = client.post(url, headers=_headers(), json=payload)
        if response.status_code >= 400:
            logger.warning("LLM request failed: %s %s", response.status_code, response.text[:500])
            raise LLMUnavailable(f"模型调用失败（HTTP {response.status_code}）")
        data = response.json()

    try:
        content = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMUnavailable("模型返回格式异常") from exc
    usage = data.get("usage") or {}
    return content, {
        "prompt_tokens": int(usage.get("prompt_tokens") or 0),
        "completion_tokens": int(usage.get("completion_tokens") or 0),
    }


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not settings.llm_api_key or not texts:
        return []
    url = f"{settings.llm_base_url.rstrip('/')}/embeddings"
    vectors: list[list[float]] = []
    for start in range(0, len(texts), 10):
        batch = texts[start : start + 10]
        payload = {
            "model": settings.embedding_model,
            "input": batch,
            "dimensions": settings.embedding_dim,
            "encoding_format": "float",
        }
        try:
            with httpx.Client(timeout=90) as client:
                response = client.post(url, headers=_headers(), json=payload)
                response.raise_for_status()
                data = response.json()
            vectors.extend(item["embedding"] for item in data["data"])
        except Exception as exc:  # noqa: BLE001 - embedding 失败不应阻断文件入库
            logger.warning("embedding failed: %s", exc)
            return []
    return vectors


def llm_configured() -> bool:
    return bool(settings.llm_api_key)


def _build_context(db: Session, conversation: Conversation, project: Project | None) -> str:
    parts: list[str] = []
    if project:
        parts.append(
            "当前项目："
            f"{project.name}（{project.year} 年，状态 {project.status}）。"
            f"项目说明：{project.description or '无'}。"
        )
    messages = recent_messages(db, conversation.id, limit=10)
    if messages:
        lines = [f"{item.role.value}: {item.content[:800]}" for item in messages]
        parts.append("最近对话：\n" + "\n".join(lines))

    if project:
        try:
            hits = search(db, query=messages[-1].content if messages else "", project_id=project.id, limit=5)
        except Exception:  # noqa: BLE001
            hits = []
        if hits:
            lines = []
            for index, hit in enumerate(hits, start=1):
                lines.append(f"[{index}] {hit.title}（第 {hit.page_no or '-'} 页）：{hit.content[:600]}")
            parts.append("可参考的历史资料：\n" + "\n".join(lines))
    return "\n\n".join(parts)


def _strip_json(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    return text


def maybe_propose_project(
    db: Session, *, conversation: Conversation, user: User, content: str, run: AgentRun
) -> AgentAction | None:
    if conversation.scope != ConversationScope.GLOBAL:
        return None
    looks_like_project = any(keyword in content for keyword in PROJECT_KEYWORDS) or (
        "项目" in content and any(verb in content for verb in ("创建", "新建", "立项", "办一"))
    )
    if not looks_like_project:
        return None

    prompt = (
        "你是研究生会活动项目助理。请从用户的话中提取活动项目创建建议，"
        "只返回 JSON，不要解释。格式："
        '{"is_project": true, "name": "项目名称", "year": 2026, "series_name": "活动系列名或空字符串", '
        '"description": "一句话说明", "reason": "为什么建议创建"}。'
        '如果不是在提出新的活动项目，返回 {"is_project": false}。'
    )
    try:
        raw, _ = chat_completion(
            [
                {"role": "system", "content": prompt},
                {"role": "user", "content": content},
            ],
            temperature=0.1,
            json_mode=True,
            max_tokens=500,
        )
        data = json.loads(_strip_json(raw))
    except (LLMUnavailable, json.JSONDecodeError):
        return None
    if not data.get("is_project"):
        return None
    name = str(data.get("name") or "").strip()
    if len(name) < 2:
        return None
    payload = {
        "name": name,
        "year": int(data.get("year") or datetime.now().year),
        "series_name": str(data.get("series_name") or "").strip() or None,
        "description": str(data.get("description") or "").strip() or None,
        "reason": str(data.get("reason") or "").strip() or None,
        "requested_by": str(user.id),
    }
    action = AgentAction(
        agent_run_id=run.id,
        action_type="create_project",
        payload=payload,
        status=AgentActionStatus.PROPOSED,
        proposed_by=user.id,
    )
    db.add(action)
    db.commit()
    db.refresh(action)
    return action


def respond(
    db: Session,
    *,
    conversation: Conversation,
    user: User,
    content: str,
    parent_id: uuid.UUID | None = None,
    file_ids: list[uuid.UUID] | None = None,
) -> tuple[Message, AgentRun, list[AgentAction]]:
    user_message = add_message(
        db,
        conversation=conversation,
        role=MessageRole.USER,
        content=content,
        user_id=user.id,
        parent_id=parent_id,
        attachments=[{"file_id": str(file_id)} for file_id in (file_ids or [])],
    )

    project = db.get(Project, conversation.project_id) if conversation.project_id else None
    run = AgentRun(
        conversation_id=conversation.id,
        project_id=conversation.project_id,
        user_id=user.id,
        worker_type="router",
        status=AgentRunStatus.RUNNING,
        input_payload={"content": content, "file_ids": [str(item) for item in (file_ids or [])]},
        started_at=datetime.now(UTC),
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    system_prompt = (
        "你是「研究生会 AI 协同工作台」的助手，服务对象是高校研究生会成员。"
        "你的回答要具体、可执行、尊重组织流程；涉及创建项目、发布任务、修改负责人等写操作时，"
        "只能提出建议，不能声称已经执行。若提供了参考资料，请在句末用 [1][2] 标注来源。"
        "回答使用简体中文，控制在 600 字以内，除非用户要求展开。"
    )
    context = _build_context(db, conversation, project)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "system", "content": f"上下文：\n{context}" if context else "上下文：无"},
    ]
    for item in recent_messages(db, conversation.id, limit=8):
        if item.id == user_message.id:
            continue
        if item.role in (MessageRole.USER, MessageRole.ASSISTANT):
            messages.append({"role": item.role.value, "content": item.content})
    messages.append({"role": "user", "content": content})

    try:
        answer, usage = chat_completion(messages)
    except LLMUnavailable as exc:
        run.status = AgentRunStatus.FAILED
        run.error = str(exc)
        run.finished_at = datetime.now(UTC)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="云端模型未配置或调用失败，请检查 .env 中的 LLM_API_KEY。",
        ) from exc

    actions: list[AgentAction] = []
    action = maybe_propose_project(db, conversation=conversation, user=user, content=content, run=run)
    if action:
        actions.append(action)
        answer += "\n\n我已整理了一份项目创建建议，请负责人确认后创建。"

    assistant_message = add_message(
        db,
        conversation=conversation,
        role=MessageRole.ASSISTANT,
        content=answer,
        user_id=None,
        meta={
            "agent_run_id": str(run.id),
            "model": settings.llm_model,
            "usage": usage,
            "actions": [str(item.id) for item in actions],
        },
    )
    run.status = AgentRunStatus.SUCCEEDED
    run.output_payload = {"content": answer, "actions": [str(item.id) for item in actions]}
    run.tokens_in = usage.get("prompt_tokens", 0)
    run.tokens_out = usage.get("completion_tokens", 0)
    run.finished_at = datetime.now(UTC)
    db.commit()
    return user_message, assistant_message, run, actions
