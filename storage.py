"""Storage, scoping, and archive logic for scratch-notes.

Shared by __init__.py (tool + slash commands) and dashboard/plugin_api.py (the
editor pane's backend routes) so both speak the same file layout.

Notes live under ``plugin_data_dir("scratch-notes")``
(``<HERMES_HOME>/plugin-data/scratch-notes/``) — never inside the project
tree, so no .gitignore entry is ever needed and each Hermes profile gets its
own notes. Two scopes:

- ``project-<dirname>-<hash8>.md``  — keyed by a hash of the working directory,
  shared across every session opened in that project.
- ``session-<session_id>.md``       — private to one conversation.
"""
from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime
from pathlib import Path

MAX_ARCHIVES_PER_NOTE = 5

_SESSION_ID_SAFE_RE = re.compile(r"[^A-Za-z0-9_.-]")


def _cwd_hash(cwd: str) -> str:
    return hashlib.sha1(cwd.encode()).hexdigest()[:8]


def project_note_id(cwd: str | None = None) -> str:
    """Stable filename stem for the project scratchpad of *cwd* (default: os.getcwd())."""
    cwd = cwd or os.getcwd()
    return f"project-{Path(cwd).name}-{_cwd_hash(cwd)}"


def session_note_id(session_id: str) -> str:
    safe = _SESSION_ID_SAFE_RE.sub("_", session_id.strip()) or "unknown"
    return f"session-{safe}"


def resolve_note_id(scope: str, *, cwd: str | None = None, session_id: str = "") -> str:
    if scope == "session":
        if not session_id:
            raise ValueError("session scope requires a session id")
        return session_note_id(session_id)
    return project_note_id(cwd)


def note_path(data_dir: Path, scope: str, *, cwd: str | None = None, session_id: str = "") -> Path:
    """Resolve the on-disk path for *scope*, creating *data_dir* if needed."""
    note_id = resolve_note_id(scope, cwd=cwd, session_id=session_id)
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / f"{note_id}.md"


def append_note(path: Path, text: str) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"\n### {datetime.now():%Y-%m-%d %H:%M}\n{text}\n")


def archive_note(path: Path, *, purge: bool = False) -> Path | None:
    """Clear *path*. Default: rename to a timestamped ``.bak`` sibling (pruned to
    :data:`MAX_ARCHIVES_PER_NOTE`) so a clear is never destructive. ``purge=True``
    deletes outright with no backup. Returns the archive path, or None (purged /
    nothing to clear).
    """
    if not path.exists():
        return None
    if purge:
        path.unlink()
        return None
    # Microsecond precision (not just seconds): two /note-clear calls inside the
    # same second would otherwise share a filename and the second os.replace
    # would silently clobber the first archive — exactly the data loss this
    # feature exists to prevent.
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    archived = path.with_name(f"{path.stem}.{stamp}.bak{path.suffix}")
    os.replace(path, archived)
    _prune_archives(path)
    return archived


def _archive_pattern(path: Path) -> re.Pattern:
    return re.compile(rf"^{re.escape(path.stem)}\.\d{{8}}_\d{{6}}_\d{{6}}\.bak{re.escape(path.suffix)}$")


def _prune_archives(path: Path) -> None:
    pattern = _archive_pattern(path)
    archives = sorted(
        (p for p in path.parent.iterdir() if pattern.match(p.name)),
        key=lambda p: p.stat().st_mtime,
    )
    for stale in archives[:-MAX_ARCHIVES_PER_NOTE]:
        stale.unlink(missing_ok=True)


def is_archive(path: Path) -> bool:
    return ".bak" in path.suffixes


def list_notes(data_dir: Path) -> list[dict]:
    """Every live (non-archived) note in *data_dir*, for the dashboard browser."""
    if not data_dir.is_dir():
        return []
    out = []
    for p in sorted(data_dir.glob("*.md")):
        if is_archive(p):
            continue
        scope = "session" if p.stem.startswith("session-") else "project"
        label = p.stem[len(scope) + 1:]
        stat = p.stat()
        out.append({
            "id": p.name, "scope": scope, "label": label,
            "mtime": stat.st_mtime, "size": stat.st_size,
        })
    return out


def safe_note_file(data_dir: Path, note_id: str) -> Path:
    """Validate *note_id* is a bare filename inside *data_dir* (no traversal, no
    absolute path, no symlink escape) and return the resolved path. Raises
    ``ValueError`` on anything suspicious.
    """
    if not note_id or Path(note_id).name != note_id or not note_id.endswith(".md"):
        raise ValueError(f"invalid note id: {note_id!r}")
    candidate = (data_dir / note_id).resolve()
    if candidate.parent != data_dir.resolve():
        raise ValueError(f"invalid note id: {note_id!r}")
    return candidate
