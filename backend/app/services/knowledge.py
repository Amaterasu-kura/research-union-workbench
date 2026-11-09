from __future__ import annotations

import re
import uuid
from typing import Any

import jieba
from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import (
    DocumentChunk,
    File,
    Knowledge,
    KnowledgeStatus,
    KnowledgeTag,
    KnowledgeTagRelation,
    Project,
    User,
)
from app.schemas.file import KnowledgeCreate, KnowledgeUpdate, SearchHit


def tokenize(text: str) -> str:
    return " ".join(token for token in jieba.cut_for_search(text) if token.strip())


def _rrf(rank: int, k: int = 60) -> float:
    return 1.0 / (k + rank)


def _ts_query_text(tokens: str) -> str | None:
    parts = []
    for token in tokens.split():
        cleaned = re.sub(r"[^\w\u4e00-\u9fff]+", "", token, flags=re.UNICODE)
        if cleaned:
            parts.append(cleaned)
    return " | ".join(parts) if parts else None


def _embed_query(query: str) -> list[float] | None:
    if not settings.llm_api_key:
        return None
    from app.services.agent import embed_texts

    vectors = embed_texts([query])
    return vectors[0] if vectors else None


def search(
    db: Session,
    *,
    query: str,
    user: User | None = None,
    project_id: uuid.UUID | None = None,
    limit: int = 8,
) -> list[SearchHit]:
    tokens = tokenize(query)
    hits: dict[str, SearchHit] = {}

    # 1) 关键词检索（中文先分词，再走 simple 配置的 tsvector）
    tsv = func.to_tsvector("simple", DocumentChunk.content_tokens)
    query_text = _ts_query_text(tokens)
    keyword_rows: list[Any] = []
    if query_text:
        tsq = func.to_tsquery("simple", query_text)
        rank = func.ts_rank(tsv, tsq)
        stmt = (
            select(DocumentChunk, File.original_name, rank.label("rank"))
            .join(File, File.id == DocumentChunk.file_id)
            .where(tsv.op("@@")(tsq), File.deleted_at.is_(None))
        )
        if project_id:
            stmt = stmt.where(DocumentChunk.project_id == project_id)
        keyword_rows = list(db.execute(stmt.order_by(rank.desc()).limit(30)).all())
    for index, (chunk, file_name, score) in enumerate(keyword_rows):
        hits[f"chunk:{chunk.id}"] = SearchHit(
            id=chunk.id,
            kind="chunk",
            title=file_name,
            content=chunk.content,
            score=float(score or 0) + _rrf(index),
            file_id=chunk.file_id,
            file_name=file_name,
            page_no=chunk.page_no,
        )

    # 2) 向量检索（有 API Key 且已生成 embedding 时）
    vector = _embed_query(query)
    if vector is not None:
        distance = DocumentChunk.embedding.cosine_distance(vector)
        stmt = (
            select(DocumentChunk, File.original_name, distance.label("distance"))
            .join(File, File.id == DocumentChunk.file_id)
            .where(DocumentChunk.embedding.isnot(None), File.deleted_at.is_(None))
        )
        if project_id:
            stmt = stmt.where(DocumentChunk.project_id == project_id)
        vector_rows = list(db.execute(stmt.order_by(distance.asc()).limit(30)).all())
        for index, (chunk, file_name, dist) in enumerate(vector_rows):
            key = f"chunk:{chunk.id}"
            value = max(0.0, 1.0 - float(dist))
            if key in hits:
                hits[key].score += _rrf(index)
            else:
                hits[key] = SearchHit(
                    id=chunk.id,
                    kind="chunk",
                    title=file_name,
                    content=chunk.content,
                    score=value + _rrf(index),
                    file_id=chunk.file_id,
                    file_name=file_name,
                    page_no=chunk.page_no,
                )

    # 3) 兜底：ILIKE（没有分词命中时仍能搜到）
    if not hits:
        like = f"%{query.strip()}%"
        stmt = (
            select(DocumentChunk, File.original_name)
            .join(File, File.id == DocumentChunk.file_id)
            .where(DocumentChunk.content.ilike(like), File.deleted_at.is_(None))
        )
        if project_id:
            stmt = stmt.where(DocumentChunk.project_id == project_id)
        for chunk, file_name in db.execute(stmt.limit(20)).all():
            hits[f"chunk:{chunk.id}"] = SearchHit(
                id=chunk.id,
                kind="chunk",
                title=file_name,
                content=chunk.content,
                score=0.2,
                file_id=chunk.file_id,
                file_name=file_name,
                page_no=chunk.page_no,
            )

    # 4) 结构化知识条目
    like = f"%{query.strip()}%"
    knowledge_query = select(Knowledge).where(
        Knowledge.deleted_at.is_(None),
        Knowledge.status != KnowledgeStatus.ARCHIVED,
        or_(Knowledge.title.ilike(like), Knowledge.content.ilike(like)),
    )
    if project_id:
        knowledge_query = knowledge_query.where(Knowledge.project_id == project_id)
    for index, item in enumerate(db.scalars(knowledge_query.limit(5)).all()):
        hits[f"knowledge:{item.id}"] = SearchHit(
            id=item.id,
            kind="knowledge",
            title=item.title,
            content=item.content,
            score=0.5 + _rrf(index),
            knowledge_id=item.id,
        )

    ordered = sorted(hits.values(), key=lambda hit: hit.score, reverse=True)
    deduped: list[SearchHit] = []
    seen: set[tuple[str, str, int | None]] = set()
    for hit in ordered:
        key = (hit.kind, hit.content.strip()[:240], hit.page_no)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(hit)
    return deduped[:limit]


def create_knowledge(db: Session, user: User, payload: KnowledgeCreate) -> Knowledge:
    if payload.project_id:
        project = db.get(Project, payload.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="项目不存在")
    knowledge = Knowledge(
        title=payload.title.strip(),
        content=payload.content.strip(),
        knowledge_type=payload.knowledge_type,
        status=KnowledgeStatus.PROPOSED if not user.is_chair else KnowledgeStatus.CONFIRMED,
        confidence=0.6,
        project_id=payload.project_id,
        department_id=payload.department_id,
        created_by=user.id,
        confirmed_by=user.id if user.is_chair else None,
    )
    db.add(knowledge)
    db.flush()
    for tag_name in payload.tags:
        name = tag_name.strip()
        if not name:
            continue
        tag = db.scalar(select(KnowledgeTag).where(KnowledgeTag.name == name))
        if tag is None:
            tag = KnowledgeTag(name=name)
            db.add(tag)
            db.flush()
        db.add(KnowledgeTagRelation(knowledge_id=knowledge.id, tag_id=tag.id))
    db.commit()
    db.refresh(knowledge)
    return knowledge


def list_knowledge(
    db: Session,
    *,
    status: KnowledgeStatus | None = None,
    project_id: uuid.UUID | None = None,
) -> list[Knowledge]:
    query = select(Knowledge).where(Knowledge.deleted_at.is_(None))
    if status:
        query = query.where(Knowledge.status == status)
    if project_id:
        query = query.where(Knowledge.project_id == project_id)
    return list(db.scalars(query.order_by(Knowledge.created_at.desc())).all())


def update_knowledge(db: Session, user: User, knowledge_id: uuid.UUID, payload: KnowledgeUpdate) -> Knowledge:
    knowledge = db.get(Knowledge, knowledge_id)
    if knowledge is None or knowledge.deleted_at is not None:
        raise HTTPException(status_code=404, detail="知识条目不存在")
    if payload.status == KnowledgeStatus.CONFIRMED:
        if not (user.is_chair or user.is_lead):
            raise HTTPException(status_code=403, detail="只有主席团或负责人可以确认知识")
        knowledge.confirmed_by = user.id
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(knowledge, key, value)
    db.commit()
    db.refresh(knowledge)
    return knowledge


def chunk_payload(chunk: DocumentChunk) -> dict[str, Any]:
    return {
        "id": str(chunk.id),
        "content": chunk.content,
        "page_no": chunk.page_no,
        "heading_path": chunk.heading_path,
    }
