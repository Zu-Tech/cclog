"""Parse Claude Code conversation history from ~/.claude/."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def decode_project_path(encoded: str) -> str:
    """Decode Claude's project path encoding: -Users-arpit-p_p -> /Users/arpit/p_p."""
    if not encoded:
        return ""
    return encoded.replace("-", "/")


def get_claude_home() -> Path:
    return Path.home() / ".claude"


def parse_history_jsonl(claude_home: Path) -> list[dict]:
    """Parse the global history.jsonl file."""
    path = claude_home / "history.jsonl"
    if not path.exists():
        return []
    entries = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return entries


def parse_session_file(path: Path) -> list[dict]:
    """Parse a session JSONL file into message dicts."""
    messages = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            # Only keep entries that have a 'message' key with a 'role'
            if isinstance(entry, dict) and "message" in entry:
                msg = entry.get("message", {})
                if isinstance(msg, dict) and "role" in msg:
                    messages.append(entry)
    return messages


def extract_text_content(content) -> str:
    """Extract plain text from a message content field."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(block.get("text", ""))
                elif block.get("type") == "thinking":
                    parts.append(block.get("thinking", ""))
        return "\n".join(parts)
    return ""


def build_summary(session_file: Path, project_dir_name: str, auto_summary: Optional[str] = None) -> dict:
    """Build a conversation summary from a session JSONL file."""
    messages = parse_session_file(session_file)
    file_size = session_file.stat().st_size if session_file.exists() else 0
    session_id = session_file.stem
    project_path = decode_project_path(project_dir_name)

    first_message_preview = ""
    slug = None
    started_at = None
    last_activity = None
    user_count = 0
    assistant_count = 0
    total_input_tokens = 0
    total_output_tokens = 0
    total_cache_read_tokens = 0
    total_cache_create_tokens = 0
    models_used = set()
    git_branch = None
    claude_version = None
    cwd = None

    for entry in messages:
        msg = entry.get("message", {})
        ts_str = entry.get("timestamp")

        # Extract real cwd from first message that has it
        if cwd is None:
            cwd = entry.get("cwd")

        # Parse timestamp
        if ts_str:
            try:
                if isinstance(ts_str, str):
                    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                else:
                    dt = datetime.fromtimestamp(ts_str / 1000, tz=timezone.utc)
                if started_at is None or dt < started_at:
                    started_at = dt
                if last_activity is None or dt > last_activity:
                    last_activity = dt
            except (ValueError, TypeError, OSError):
                pass

        # Slug
        if slug is None:
            slug = entry.get("slug")

        # Git branch
        if git_branch is None:
            git_branch = entry.get("gitBranch")

        # Claude version
        if claude_version is None:
            claude_version = entry.get("version")

        role = msg.get("role", "")
        if role == "user":
            user_count += 1
            if not first_message_preview:
                text = extract_text_content(msg.get("content", ""))
                first_message_preview = text[:200]
        elif role == "assistant":
            assistant_count += 1
            usage = msg.get("usage", {})
            if usage:
                cache_read = usage.get("cache_read_input_tokens", 0)
                cache_create = usage.get("cache_creation_input_tokens", 0)
                raw_input = usage.get("input_tokens", 0)
                total_input_tokens += raw_input + cache_create + cache_read
                total_cache_read_tokens += cache_read
                total_cache_create_tokens += cache_create
                total_output_tokens += usage.get("output_tokens", 0)
            model = msg.get("model")
            if model:
                models_used.add(model)

    # Use real cwd from session data if available, fall back to decoded path
    real_path = cwd or project_path

    return {
        "session_id": session_id,
        "project_path": real_path,
        "project_encoded": project_dir_name,
        "first_message_preview": first_message_preview,
        "auto_summary": auto_summary,
        "slug": slug,
        "started_at": started_at.isoformat() if started_at else None,
        "last_activity": last_activity.isoformat() if last_activity else None,
        "message_count": user_count + assistant_count,
        "user_message_count": user_count,
        "assistant_message_count": assistant_count,
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "total_cache_read_tokens": total_cache_read_tokens,
        "total_cache_create_tokens": total_cache_create_tokens,
        "models_used": sorted(models_used),
        "git_branch": git_branch,
        "claude_version": claude_version,
        "file_size_bytes": file_size,
    }


def discover_all_sessions(claude_home: Path) -> list[dict]:
    """Discover all session files and build summaries."""
    projects_dir = claude_home / "projects"
    if not projects_dir.exists():
        return []

    summaries = []

    for project_dir in sorted(projects_dir.iterdir()):
        if not project_dir.is_dir() or project_dir.name.startswith("."):
            continue

        project_name = project_dir.name

        # Load sessions-index.json if exists
        index_summaries = {}
        index_path = project_dir / "sessions-index.json"
        if index_path.exists():
            try:
                with open(index_path) as f:
                    data = json.load(f)
                entries = data.get("entries", []) if isinstance(data, dict) else data
                for entry in entries:
                    if isinstance(entry, dict):
                        sid = entry.get("sessionId", "")
                        index_summaries[sid] = entry.get("summary")
            except (json.JSONDecodeError, KeyError, TypeError):
                pass

        # Find all .jsonl session files (not in subdirectories)
        for session_file in sorted(project_dir.glob("*.jsonl")):
            if not session_file.is_file():
                continue
            session_id = session_file.stem
            auto_summary = index_summaries.get(session_id)

            try:
                summary = build_summary(session_file, project_name, auto_summary)
                summaries.append(summary)
            except Exception as e:
                print(f"Warning: Failed to parse {session_file}: {e}")

    # Sort by last activity, newest first
    summaries.sort(key=lambda s: s.get("last_activity") or "", reverse=True)
    return summaries
