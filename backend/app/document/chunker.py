from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.document.parser import ParsedBlock


@dataclass
class ChunkData:
    content: str
    page_no: int | None
    bbox: dict[str, Any] | None
    heading_path: str | None
    token_count: int


def _split_long(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    pieces: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            cut = max(
                text.rfind("。", start, end),
                text.rfind("；", start, end),
                text.rfind("\n", start, end),
                text.rfind("，", start, end),
            )
            if cut > start + max_chars // 2:
                end = cut + 1
        pieces.append(text[start:end].strip())
        start = end
    return [piece for piece in pieces if piece]


def chunk_blocks(blocks: list[ParsedBlock], *, max_chars: int = 700, overlap: int = 80) -> list[ChunkData]:
    chunks: list[ChunkData] = []
    buffer = ""
    current_page: int | None = None
    current_bbox: dict[str, Any] | None = None
    current_heading: str | None = None

    def flush() -> None:
        nonlocal buffer, current_page, current_bbox, current_heading
        text = buffer.strip()
        if text:
            chunks.append(
                ChunkData(
                    content=text,
                    page_no=current_page,
                    bbox=current_bbox,
                    heading_path=current_heading,
                    token_count=len(text),
                )
            )
        buffer = ""

    for block in blocks:
        heading_changed = block.heading_path != current_heading
        is_heading_block = bool(
            block.heading_path and block.heading_path.split(" / ")[-1].strip() == block.text.strip()
        )
        page_changed = (
            block.page_no is not None and current_page is not None and block.page_no != current_page
        )
        if buffer and (heading_changed or is_heading_block or page_changed):
            flush()
        for piece in _split_long(block.text, max_chars):
            if not buffer:
                current_page = block.page_no
                current_bbox = block.bbox
                current_heading = block.heading_path
                buffer = piece
                continue
            if len(buffer) + len(piece) + 2 <= max_chars:
                buffer = f"{buffer}\n{piece}"
                continue
            previous = buffer
            flush()
            prefix = previous[-overlap:] if overlap and len(previous) > overlap else ""
            buffer = (prefix + "\n" + piece).strip() if prefix else piece
            current_page = block.page_no
            current_bbox = block.bbox
            current_heading = block.heading_path
    flush()
    return chunks
