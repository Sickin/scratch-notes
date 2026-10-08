"""Behavior tests for storage.py — scoping, archiving, and the path guard.

storage.py has no Hermes imports, so it's loaded straight from the repo root
by file path; no Hermes install is needed to run these.
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("scratch_notes_storage", _ROOT / "storage.py")
assert _spec is not None and _spec.loader is not None
storage = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = storage
_spec.loader.exec_module(storage)


# ---- scoping ---------------------------------------------------------------

def test_project_note_is_stable_for_the_same_directory():
    assert storage.project_note_id("/work/app") == storage.project_note_id("/work/app")


def test_same_folder_name_in_different_places_gets_different_notes():
    a = storage.project_note_id("/work/app")
    b = storage.project_note_id("/other/app")
    assert a != b
    assert a.startswith("project-app-") and b.startswith("project-app-")


def test_session_ids_are_sanitised_into_a_single_filename():
    note_id = storage.session_note_id("../../etc/passwd")
    assert "/" not in note_id and note_id.startswith("session-")


def test_session_scope_requires_a_session_id():
    with pytest.raises(ValueError):
        storage.resolve_note_id("session", session_id="")


def test_note_path_uses_explicit_cwd_and_creates_the_data_dir(tmp_path):
    data_dir = tmp_path / "plugin-data"
    path = storage.note_path(data_dir, "project", cwd="/work/app")
    assert data_dir.is_dir()
    assert path.parent == data_dir
    assert path.name == storage.project_note_id("/work/app") + ".md"


def test_note_path_defaults_to_the_process_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    path = storage.note_path(tmp_path / "d", "project")
    assert path.stem == storage.project_note_id(os.getcwd())


def test_project_and_session_notes_never_share_a_file(tmp_path):
    project = storage.note_path(tmp_path, "project", cwd="/work/app")
    session = storage.note_path(tmp_path, "session", session_id="abc123")
    assert project != session


# ---- appending -------------------------------------------------------------

def test_append_note_adds_timestamped_entries_in_order(tmp_path):
    path = tmp_path / "n.md"
    storage.append_note(path, "first")
    storage.append_note(path, "second")
    text = path.read_text(encoding="utf-8")
    assert text.index("first") < text.index("second")
    assert text.count("### ") == 2


# ---- archiving -------------------------------------------------------------

def test_clear_archives_instead_of_deleting(tmp_path):
    path = tmp_path / "n.md"
    path.write_text("keep me", encoding="utf-8")
    archived = storage.archive_note(path)
    assert not path.exists()
    assert archived is not None and archived.read_text(encoding="utf-8") == "keep me"


def test_rapid_clears_never_overwrite_each_other(tmp_path):
    path = tmp_path / "n.md"
    names = set()
    for i in range(storage.MAX_ARCHIVES_PER_NOTE):
        path.write_text(f"v{i}", encoding="utf-8")
        names.add(storage.archive_note(path).name)
    assert len(names) == storage.MAX_ARCHIVES_PER_NOTE


def test_only_the_newest_archives_are_kept(tmp_path):
    path = tmp_path / "n.md"
    for i in range(storage.MAX_ARCHIVES_PER_NOTE + 3):
        path.write_text(f"v{i}", encoding="utf-8")
        storage.archive_note(path)
    archives = [p for p in tmp_path.iterdir() if storage.is_archive(p)]
    assert len(archives) == storage.MAX_ARCHIVES_PER_NOTE
    kept = {p.read_text(encoding="utf-8") for p in archives}
    assert f"v{storage.MAX_ARCHIVES_PER_NOTE + 2}" in kept  # newest survives
    assert "v0" not in kept  # oldest pruned


def test_pruning_one_note_never_touches_another_notes_archives(tmp_path):
    a, b = tmp_path / "a.md", tmp_path / "b.md"
    b.write_text("b", encoding="utf-8")
    storage.archive_note(b)
    for i in range(storage.MAX_ARCHIVES_PER_NOTE + 2):
        a.write_text(f"a{i}", encoding="utf-8")
        storage.archive_note(a)
    assert any(p.name.startswith("b.") and storage.is_archive(p) for p in tmp_path.iterdir())


def test_purge_deletes_without_a_backup(tmp_path):
    path = tmp_path / "n.md"
    path.write_text("gone", encoding="utf-8")
    assert storage.archive_note(path, purge=True) is None
    assert list(tmp_path.iterdir()) == []


def test_clearing_a_missing_note_is_a_no_op(tmp_path):
    assert storage.archive_note(tmp_path / "missing.md") is None


# ---- listing ---------------------------------------------------------------

def test_list_notes_hides_archives_and_labels_scope(tmp_path):
    project = storage.note_path(tmp_path, "project", cwd="/work/app")
    session = storage.note_path(tmp_path, "session", session_id="s1")
    project.write_text("p", encoding="utf-8")
    session.write_text("s", encoding="utf-8")
    storage.archive_note(session)
    session.write_text("s2", encoding="utf-8")

    notes = storage.list_notes(tmp_path)
    assert sorted(n["scope"] for n in notes) == ["project", "session"]
    assert all(not storage.is_archive(tmp_path / n["id"]) for n in notes)


def test_list_notes_on_a_missing_dir_is_empty(tmp_path):
    assert storage.list_notes(tmp_path / "nope") == []


# ---- path guard (the REST API's only defence) ------------------------------

@pytest.mark.parametrize("bad", [
    "../escape.md",
    "/etc/passwd.md",
    "sub/dir.md",
    "not-markdown.txt",
    "",
    "..",
])
def test_safe_note_file_rejects_anything_outside_the_data_dir(tmp_path, bad):
    with pytest.raises(ValueError):
        storage.safe_note_file(tmp_path, bad)


def test_safe_note_file_rejects_a_symlink_that_escapes(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (outside / "secret.md").write_text("x", encoding="utf-8")
    (data_dir / "link.md").symlink_to(outside / "secret.md")
    with pytest.raises(ValueError):
        storage.safe_note_file(data_dir, "link.md")


def test_safe_note_file_accepts_a_real_note(tmp_path):
    path = storage.safe_note_file(tmp_path, "project-app-12345678.md")
    assert path.parent == tmp_path.resolve()
