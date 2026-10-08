# Changelog

## 1.2.0

- **Desktop panel.** A docked Notes panel for Hermes Desktop with a live-preview markdown editor. Every line renders; click a line to edit its raw markdown.
- Todos keep a clickable checkbox even while you're editing their text. Enter continues lists, and Backspace at the start of a todo removes its checkbox.
- ☐ and strikethrough buttons, plus a raw source mode for editing the whole note at once.
- Open the panel with ⌘⌥J / Ctrl+Alt+J, ⌘K → "Show Notes", or the Notes button in the status bar.
- The panel has a permanent Notes header, so you can drag it to dock anywhere.
- Session notes in the panel now match the ones written by `note_add` and `/note --session`.
- Switching chats no longer briefly shows (or saves into) the previous project's note.
- Removed the migration from the pre-1.1 `~/.hermes/notes/` folder.
- Added an MIT license, tests, and CI.

## 1.1.0

- Notes can be scoped to a project or to a single session.
- `/note-clear` archives to a timestamped backup (newest 5 kept); `--purge` deletes for good.
- Notes moved to `<HERMES_HOME>/plugin-data/scratch-notes/`, so each Hermes profile keeps its own.
