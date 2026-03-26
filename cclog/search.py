"""Full-text search using Whoosh."""

import os
from pathlib import Path

from whoosh import index as whoosh_index
from whoosh.fields import ID, TEXT, Schema
from whoosh.qparser import MultifieldParser, OrGroup

from .metadata import get_data_dir
from .parser import extract_text_content, parse_session_file


def get_index_dir() -> Path:
    d = get_data_dir() / "index"
    d.mkdir(parents=True, exist_ok=True)
    return d


SCHEMA = Schema(
    session_id=ID(stored=True),
    project=ID(stored=True),
    role=ID(stored=True),
    content=TEXT(stored=True),
    timestamp=ID(stored=True),
)


def build_index(summaries: list[dict], claude_home: Path):
    """Build or rebuild the Whoosh search index."""
    index_dir = get_index_dir()

    # Always recreate for simplicity
    ix = whoosh_index.create_in(str(index_dir), SCHEMA)
    writer = ix.writer()

    for summary in summaries:
        session_file = (
            claude_home
            / "projects"
            / summary["project_encoded"]
            / f"{summary['session_id']}.jsonl"
        )
        if not session_file.exists():
            continue

        try:
            messages = parse_session_file(session_file)
        except Exception:
            continue

        for entry in messages:
            msg = entry.get("message", {})
            text = extract_text_content(msg.get("content", ""))
            if not text.strip():
                continue

            writer.add_document(
                session_id=summary["session_id"],
                project=summary["project_path"],
                role=msg.get("role", ""),
                content=text,
                timestamp=entry.get("timestamp", ""),
            )

    writer.commit()
    return ix


def search(query_str: str, limit: int = 50) -> list[dict]:
    """Search the index."""
    index_dir = get_index_dir()
    if not whoosh_index.exists_in(str(index_dir)):
        return []

    ix = whoosh_index.open_dir(str(index_dir))
    parser = MultifieldParser(["content"], schema=ix.schema, group=OrGroup)

    try:
        query = parser.parse(query_str)
    except Exception:
        return []

    results = []
    with ix.searcher() as searcher:
        hits = searcher.search(query, limit=limit)
        for hit in hits:
            snippet = hit.get("content", "")
            if len(snippet) > 200:
                snippet = snippet[:200] + "..."
            results.append({
                "session_id": hit["session_id"],
                "project": hit["project"],
                "role": hit.get("role", ""),
                "snippet": snippet,
                "score": float(hit.score),
            })

    return results
