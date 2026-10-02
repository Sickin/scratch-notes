"""scratch-notes dashboard plugin — backend API, mounted at /api/plugins/scratch-notes/.

Talks to the same storage.py the tool and slash commands use, so the dashboard
editor and the CLI/gateway never drift on file layout or archive behavior.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


def _load_storage_module():
    """dashboard/plugin_api.py is imported by spec_from_file_location (see
    hermes_cli/web_server_dashboard.py::_mount_plugin_api_routes) under its own
    synthetic module name, so the plugin's own package isn't importable by
    name. Load the sibling storage.py directly by path instead of touching
    sys.path (a bare 'storage' name would collide with any other plugin doing
    the same trick).
    """
    mod_name = "hermes_dashboard_plugin_scratch_notes_storage"
    if mod_name in sys.modules:
        return sys.modules[mod_name]
    path = Path(__file__).resolve().parent.parent / "storage.py"
    spec = importlib.util.spec_from_file_location(mod_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load storage module from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)
    return module


storage = _load_storage_module()

router = APIRouter()


def _data_dir() -> Path:
    """Durable data root (``<hermes home>/plugin-data/scratch-notes/``) — must match
    __init__.py's plugin_data_dir("scratch-notes") call exactly, or the dashboard
    editor and the CLI tool/slash-commands would silently read/write different
    directories. See the NOTE in __init__.py for why this isn't ctx.state.data_dir."""
    try:
        from plugins.plugin_storage import plugin_data_dir
        return plugin_data_dir("scratch-notes")
    except Exception:
        # Standalone dashboard import (no `plugins` package on sys.path): same
        # layout, computed locally — mirrors hermes-achievements' plugin_api.py.
        from hermes_constants import get_hermes_home
        root = get_hermes_home() / "plugin-data" / "scratch-notes"
        root.mkdir(parents=True, exist_ok=True)
        return root


@router.get("/notes")
async def list_notes():
    """Every live note (project + session scoped) for the browser list."""
    return {"notes": storage.list_notes(_data_dir())}


@router.get("/resolve")
async def resolve_note(scope: str = "project", cwd: str = "", session_id: str = ""):
    """Compute the note filename for an explicit cwd/session_id, without ever
    calling os.getcwd() server-side. The gateway backend a desktop pane talks to
    is pooled per (connection, profile) — its process cwd is NOT the directory
    the user is actually working in — so a client (the desktop plugin, which
    reads host.state.cwd) must pass its own cwd/session_id explicitly rather
    than let the server infer one that means nothing for this request. The CLI
    tool/slash-commands are the opposite case: they run *in* the session's own
    process, where os.getcwd() is correct, so storage.note_path's default still
    applies there.
    """
    if scope not in ("project", "session"):
        raise HTTPException(status_code=400, detail=f"invalid scope: {scope!r}")
    try:
        note_id = storage.resolve_note_id(scope, cwd=cwd or None, session_id=session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"id": f"{note_id}.md"}


@router.get("/notes/{note_id}")
async def get_note(note_id: str):
    try:
        path = storage.safe_note_file(_data_dir(), note_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not path.exists():
        raise HTTPException(status_code=404, detail="note not found")
    return {"id": note_id, "content": path.read_text(encoding="utf-8")}


class _SaveBody(BaseModel):
    content: str


@router.put("/notes/{note_id}")
async def save_note(note_id: str, body: _SaveBody):
    """Overwrite a note's full content — this is the editable pane's save action."""
    try:
        path = storage.safe_note_file(_data_dir(), note_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body.content, encoding="utf-8")
    return {"ok": True}


@router.post("/notes/{note_id}/clear")
async def clear_note(note_id: str, purge: bool = False):
    try:
        path = storage.safe_note_file(_data_dir(), note_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not path.exists():
        return {"ok": True, "archived": None}
    archived = storage.archive_note(path, purge=purge)
    return {"ok": True, "archived": archived.name if archived else None}
