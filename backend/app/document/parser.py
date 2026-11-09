from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pymupdf
from docx import Document


@dataclass
class ParsedBlock:
    text: str
    page_no: int | None = None
    bbox: dict[str, Any] | None = None
    heading_path: str | None = None


class UnsupportedFileError(ValueError):
    pass


def parse_file(path: Path, suffix: str) -> list[ParsedBlock]:
    suffix = suffix.lower()
    if suffix == ".pdf":
        return _parse_pdf(path)
    if suffix == ".docx":
        return _parse_docx(path)
    if suffix in {".txt", ".md", ".markdown"}:
        return _parse_text(path, markdown=suffix in {".md", ".markdown"})
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        return []
    raise UnsupportedFileError(f"暂不支持解析 {suffix} 文件")


def _clean(text: str) -> str:
    text = text.replace("\u3000", " ").replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _parse_pdf(path: Path) -> list[ParsedBlock]:
    blocks: list[ParsedBlock] = []
    with pymupdf.open(path) as document:
        for page_index, page in enumerate(document, start=1):
            for raw in page.get_text("blocks"):
                x0, y0, x1, y1, text = raw[0], raw[1], raw[2], raw[3], raw[4]
                cleaned = _clean(str(text))
                if not cleaned:
                    continue
                blocks.append(
                    ParsedBlock(
                        text=cleaned,
                        page_no=page_index,
                        bbox={"x0": round(x0, 1), "y0": round(y0, 1), "x1": round(x1, 1), "y1": round(y1, 1)},
                    )
                )
    return blocks


def _is_heading(paragraph) -> bool:
    style = (paragraph.style.name or "").lower()
    return style.startswith("heading") or style.startswith("标题") or style in {"title"}


def _parse_docx(path: Path) -> list[ParsedBlock]:
    document = Document(path)
    blocks: list[ParsedBlock] = []
    heading_stack: list[str] = []

    for paragraph in document.paragraphs:
        text = _clean(paragraph.text)
        if not text:
            continue
        if _is_heading(paragraph):
            level = 1
            style = (paragraph.style.name or "").lower()
            match = re.search(r"(\d+)", style)
            if match:
                level = max(1, min(int(match.group(1)), 6))
            heading_stack = heading_stack[: level - 1]
            heading_stack.append(text)
            blocks.append(ParsedBlock(text=text, heading_path=" / ".join(heading_stack)))
            continue
        blocks.append(
            ParsedBlock(
                text=text,
                heading_path=" / ".join(heading_stack) if heading_stack else None,
            )
        )

    for table in document.tables:
        rows: list[str] = []
        for row in table.rows:
            cells = [_clean(cell.text) for cell in row.cells]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            blocks.append(
                ParsedBlock(
                    text="\n".join(rows),
                    heading_path=" / ".join(heading_stack) if heading_stack else None,
                )
            )
    return blocks


def _parse_text(path: Path, *, markdown: bool) -> list[ParsedBlock]:
    content = _clean(path.read_text(encoding="utf-8", errors="ignore"))
    blocks: list[ParsedBlock] = []
    heading_stack: list[str] = []
    for raw in re.split(r"\n{2,}", content):
        text = raw.strip()
        if not text:
            continue
        if markdown and text.startswith("#"):
            level = len(text) - len(text.lstrip("#"))
            title = text.lstrip("#").strip()
            heading_stack = heading_stack[: max(0, level - 1)]
            heading_stack.append(title)
            blocks.append(ParsedBlock(text=title, heading_path=" / ".join(heading_stack)))
            continue
        blocks.append(
            ParsedBlock(text=text, heading_path=" / ".join(heading_stack) if heading_stack else None)
        )
    return blocks
