# __init__.py
"""scratch-notes — a per-project / per-session markdown scratchpad.

Notes live in the profile-scoped plugin data dir
(<HERMES_HOME>/plugin-data/scratch-notes/), never inside the project tree, so
they're never part of the git repo and each Hermes profile keeps its own. See
storage.py for the file layout.
"""
import json

from gateway.session_context import get_session_env
from plugins.plugin_storage import plugin_data_dir

from . import storage

# NOTE: deliberately plugin_data_dir("scratch-notes"), not ctx.state.data_dir.
# PluginState namespaces by a hash of the plugin id unless a portable
# skill_namespace is declared (see hermes_cli/plugins_state.py::_plugin_data_namespace),
# so ctx.state.data_dir and plugin_data_dir(name) resolve to *different*
# directories for a plain plugin like this one. The dashboard's plugin_api.py
# has no PluginContext to hand it ctx.state, so it must use plugin_data_dir()
# too — using the same call on both sides is what keeps the CLI/tool writes
# and the dashboard editor pointed at the same files.


def _current_session_id() -> str:
    """Best-effort session id for the calling context (slash-command handlers get no
    explicit session_id argument, so they read it from the session ContextVar)."""
    return get_session_env("HERMES_SESSION_ID", "")


def register(ctx):
    data_dir = plugin_data_dir("scratch-notes")

    def _resolve(scope: str, session_id: str):
        return storage.note_path(data_dir, scope, session_id=session_id)

    # ---- Tool: note_add (model-invoked) ------------------------------------
    schema = {
        "name": "note_add",
        "description": (
            "Append a markdown note to a scratchpad. Use this to jot down findings, "
            "decisions, or TODOs while working through a problem, so they survive "
            "even if the conversation is compacted or restarted. Default scope is "
            "'project' (shared by every session opened in this working directory); "
            "pass scope='session' for a note private to this conversation only."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Note content (markdown)"},
                "scope": {
                    "type": "string", "enum": ["project", "session"],
                    "description": "'project' (default, shared across sessions in this cwd) or "
                                    "'session' (private to this conversation)",
                },
            },
            "required": ["text"],
        },
    }

    def handle_note_add(params, session_id: str = "", **kwargs):
        text = (params.get("text") or "").strip()
        if not text:
            return json.dumps({"success": False, "error": "empty note"})
        scope = params.get("scope") or "project"
        if scope not in ("project", "session"):
            return json.dumps({"success": False, "error": f"invalid scope: {scope!r}"})
        sid = session_id or _current_session_id()
        if scope == "session" and not sid:
            return json.dumps({"success": False, "error": "no session id available for scope='session'"})
        try:
            path = _resolve(scope, sid)
        except ValueError as exc:
            return json.dumps({"success": False, "error": str(exc)})
        storage.append_note(path, text)
        return json.dumps({"success": True, "path": str(path), "scope": scope})

    ctx.register_tool(name="note_add", toolset="scratch_notes", schema=schema, handler=handle_note_add)

    # ---- /note [--session] — show the scratchpad ---------------------------
    def handle_note_view(args: str):
        scope = "session" if (args or "").strip() == "--session" else "project"
        sid = _current_session_id()
        if scope == "session" and not sid:
            return "No session id available — can't show a session-scoped scratchpad here."
        path = _resolve(scope, sid)
        if not path.exists():
            return f"No {scope} notes yet ({path.name})."
        return f"[{scope}: {path.name}]\n\n{path.read_text(encoding='utf-8')}"

    ctx.register_command(
        "note", handle_note_view, "Show this project's scratchpad (--session for the session-scoped one)",
        args_hint="[--session]",
    )

    # ---- /note-clear [--session] [--purge] — archive or delete -------------
    def handle_note_clear(args: str):
        tokens = (args or "").split()
        scope = "session" if "--session" in tokens else "project"
        purge = "--purge" in tokens
        sid = _current_session_id()
        if scope == "session" and not sid:
            return "No session id available — can't clear a session-scoped scratchpad here."
        path = _resolve(scope, sid)
        if not path.exists():
            return f"Nothing to clear — no {scope} notes yet ({path.name})."
        if purge:
            storage.archive_note(path, purge=True)
            return f"Purged {scope} notes ({path.name}) — no backup kept."
        archived = storage.archive_note(path, purge=False)
        assert archived is not None  # purge=False always archives when path.exists()
        return f"Cleared {scope} notes ({path.name}); archived to {archived.name}."

    ctx.register_command(
        "note-clear", handle_note_clear,
        "Clear this project's scratchpad (archives to .bak by default; --purge deletes; --session for the session-scoped one)",
        args_hint="[--session] [--purge]",
    )
