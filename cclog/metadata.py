"""Metadata store for tags, renames, favorites — stored separately from Claude's files."""

import json
from pathlib import Path
from typing import Optional


def get_data_dir() -> Path:
    data_dir = Path.home() / ".local" / "share" / "cclog"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def get_metadata_path() -> Path:
    return get_data_dir() / "metadata.json"


class MetadataStore:
    def __init__(self, path: Optional[Path] = None):
        self.path = path or get_metadata_path()
        self.sessions: dict[str, dict] = {}
        self._load()

    def _load(self):
        if self.path.exists():
            try:
                with open(self.path) as f:
                    data = json.load(f)
                self.sessions = data.get("sessions", {})
            except (json.JSONDecodeError, KeyError):
                self.sessions = {}

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w") as f:
            json.dump({"sessions": self.sessions}, f, indent=2)

    def get(self, session_id: str) -> dict:
        default = {
            "custom_name": None,
            "tags": [],
            "favorite": False,
            "notes": None,
            "deleted": False,
        }
        stored = self.sessions.get(session_id, {})
        return {**default, **stored}

    def update(self, session_id: str, **kwargs):
        meta = self.get(session_id)
        meta.update(kwargs)
        self.sessions[session_id] = meta
        self.save()

    def all_tags(self) -> dict[str, int]:
        tags: dict[str, int] = {}
        for meta in self.sessions.values():
            if meta.get("deleted"):
                continue
            for tag in meta.get("tags", []):
                tags[tag] = tags.get(tag, 0) + 1
        return tags
