// ~/.hermes/plugins/scratch-notes/dashboard/dist/index.js
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  const { React } = SDK;
  const { useState, useEffect, useCallback, useRef } = SDK.hooks;
  const {
    Card, CardHeader, CardTitle, CardContent, Badge, Button, Separator,
  } = SDK.components;

  const API = "/api/plugins/scratch-notes";

  function fmtTime(unixSeconds) {
    try {
      return SDK.utils.isoTimeAgo(new Date(unixSeconds * 1000).toISOString());
    } catch (e) {
      return "";
    }
  }

  function NoteList({ notes, selectedId, onSelect, onRefresh }) {
    return React.createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: "220px" } },
      notes.length === 0
        ? React.createElement(
            "p",
            { className: "text-sm text-muted-foreground" },
            "No notes yet. Ask the agent to jot one down with note_add, or use /note in a session.",
          )
        : notes.map((n) =>
            React.createElement(
              "button",
              {
                key: n.id,
                onClick: () => onSelect(n.id),
                className: SDK.utils.cn(
                  "text-left rounded px-2 py-1.5 text-sm border transition-colors",
                  n.id === selectedId
                    ? "border-(--accent) bg-(--accent)/10"
                    : "border-transparent hover:bg-(--muted-foreground)/10",
                ),
              },
              React.createElement(
                "div",
                { style: { display: "flex", alignItems: "center", gap: "6px" } },
                React.createElement(Badge, { variant: n.scope === "session" ? "secondary" : "outline" }, n.scope),
                React.createElement("span", { className: "truncate" }, n.label),
              ),
              React.createElement(
                "div",
                { className: "text-xs text-muted-foreground" },
                fmtTime(n.mtime),
              ),
            ),
          ),
    );
  }

  function ScratchNotesPage() {
    const [notes, setNotes] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [content, setContent] = useState("");
    const [dirty, setDirty] = useState(false);
    const [status, setStatus] = useState("");
    const saveTimer = useRef(null);

    const refreshList = useCallback(() => {
      SDK.fetchJSON(`${API}/notes`)
        .then((data) => setNotes(data.notes || []))
        .catch(() => setStatus("Failed to load notes"));
    }, []);

    useEffect(() => {
      refreshList();
    }, [refreshList]);

    const openNote = useCallback((id) => {
      setSelectedId(id);
      setStatus("");
      SDK.fetchJSON(`${API}/notes/${encodeURIComponent(id)}`)
        .then((data) => {
          setContent(data.content || "");
          setDirty(false);
        })
        .catch(() => setStatus("Failed to load note"));
    }, []);

    const save = useCallback(() => {
      if (!selectedId) return;
      SDK.fetchJSON(`${API}/notes/${encodeURIComponent(selectedId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
        .then(() => {
          setDirty(false);
          setStatus("Saved");
          setTimeout(() => setStatus(""), 1500);
          refreshList();
        })
        .catch(() => setStatus("Save failed"));
    }, [selectedId, content, refreshList]);

    // Debounced autosave 1.5s after the last keystroke.
    useEffect(() => {
      if (!dirty) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(save, 1500);
      return () => clearTimeout(saveTimer.current);
      // eslint-disable-next-line
    }, [content]);

    const onChange = useCallback((e) => {
      setContent(e.target.value);
      setDirty(true);
    }, []);

    const clearNote = useCallback((purge) => {
      if (!selectedId) return;
      if (!window.confirm(purge ? "Purge this note with no backup?" : "Archive and clear this note?")) return;
      SDK.fetchJSON(`${API}/notes/${encodeURIComponent(selectedId)}/clear?purge=${purge ? "true" : "false"}`, {
        method: "POST",
      })
        .then(() => {
          setContent("");
          setDirty(false);
          refreshList();
        })
        .catch(() => setStatus("Clear failed"));
    }, [selectedId, refreshList]);

    return React.createElement(
      Card,
      null,
      React.createElement(
        CardHeader,
        null,
        React.createElement(CardTitle, null, "Scratch Notes"),
      ),
      React.createElement(
        CardContent,
        { style: { display: "flex", gap: "16px" } },
        React.createElement(NoteList, {
          notes, selectedId, onSelect: openNote, onRefresh: refreshList,
        }),
        React.createElement(Separator, { orientation: "vertical" }),
        React.createElement(
          "div",
          { style: { flex: 1, display: "flex", flexDirection: "column", gap: "8px" } },
          !selectedId
            ? React.createElement(
                "p",
                { className: "text-sm text-muted-foreground" },
                "Select a note on the left to view and edit it.",
              )
            : React.createElement(
                React.Fragment,
                null,
                React.createElement("textarea", {
                  value: content,
                  onChange,
                  rows: 24,
                  className: "w-full font-mono text-sm p-2 rounded border",
                  style: {
                    background: "var(--card)",
                    color: "var(--foreground)",
                    borderColor: "var(--border)",
                    resize: "vertical",
                  },
                }),
                React.createElement(
                  "div",
                  { style: { display: "flex", gap: "8px", alignItems: "center" } },
                  React.createElement(Button, { onClick: save, disabled: !dirty }, "Save"),
                  React.createElement(Button, { onClick: () => clearNote(false), variant: "outline" }, "Archive & clear"),
                  React.createElement(Button, { onClick: () => clearNote(true), variant: "destructive" }, "Purge"),
                  React.createElement(
                    "span",
                    { className: "text-xs text-muted-foreground" },
                    status || (dirty ? "Unsaved changes — autosaves in 1.5s" : ""),
                  ),
                ),
              ),
        ),
      ),
    );
  }

  window.__HERMES_PLUGINS__.register("scratch-notes", ScratchNotesPage);
})();
