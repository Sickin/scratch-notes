# Scratch Notes

A markdown scratchpad for [Hermes Agent](https://hermes-agent.nousresearch.com/docs), kept per project or per conversation. The agent jots notes there, you edit them in a docked live-preview panel in Hermes Desktop, and they survive compaction, restarts and new sessions.

> **Community plugin.** Scratch Notes is an independent, open-source project. It is **not** an official Nous Research product and is not developed or maintained by the Hermes team. It uses Hermes's public plugin APIs.

<!-- 📸 SCREENSHOT: hero — the Notes panel docked beside a chat, showing a heading,
     a few checked/unchecked todos, and some bold/strikethrough text. ~1600px wide.
     Save as docs/screenshots/hero.png, then uncomment:
![Scratch Notes docked beside a Hermes chat](docs/screenshots/hero.png)
-->

## Features

- **Two scopes**
  - **Project** notes are shared by every session opened in the same working directory.
  - **Session** notes are private to one conversation.
- **The agent can take notes.** It gets a `note_add` tool for recording findings, decisions and TODOs that need to outlive the conversation.
- **Live-preview editor (Hermes Desktop).** Every line is rendered as markdown. Click a line to edit its raw markdown; click away and it renders again.
- **Real checkboxes.** `- [ ]` todos keep a clickable checkbox even while you're editing their text.
  - **Enter** continues a list.
  - **Backspace** at the start of a todo turns it back into plain text.
  - **☐** makes the current line a todo, and **S** toggles strikethrough.
- **Raw source mode.** Edit the whole note as one markdown text area, for pasting in bulk.
- **Clearing is safe by default.** Clearing a note archives it to a timestamped backup, keeping the newest 5 backups per note. Deleting with no backup takes an explicit `--purge`.
- **Notes stay out of your repo.** They're stored in Hermes's per-profile plugin data folder, never in the project tree, so you never need a `.gitignore` entry.

<!-- 📸 SCREENSHOT: close-up of live preview — one line in raw-edit mode (e.g. "## Header 2"
     showing its markdown) while the lines around it stay rendered. Save as
     docs/screenshots/live-preview.png, then uncomment:
![Editing one line while the rest stay rendered](docs/screenshots/live-preview.png)
-->

## Requirements

- Hermes Agent **0.21.5 or newer** (the oldest version tested).
- Hermes Desktop for the docked panel. The `note_add` tool and the `/note` commands work anywhere Hermes runs: CLI, TUI, messaging gateway and Desktop.

## Install

```bash
hermes plugins install Sickin/scratch-notes
hermes plugins enable scratch-notes
```

Then restart Hermes (or your session) so the plugin loads.

**Desktop panel:** a plugin's Desktop half is **off by default**. Turn on **Scratch Notes** in Hermes Desktop under **Capabilities → Plugins**.

## Usage

### Opening the panel (Hermes Desktop)

Any of these opens the Notes panel, or brings it back if it's hidden:

| | |
|---|---|
| Keyboard | **⌘⌥J** (macOS) / **Ctrl+Alt+J**. You can rebind it in Settings → Keybinds. |
| Command palette | **⌘K** → "Show Notes" |
| Status bar | The **Notes** button at the bottom right |

To move the panel, drag its **Notes** tab onto any edge or onto another panel's tab bar.

Use the **Project / Session** switch at the top to choose which note you're looking at. Changes save automatically about a second after you stop typing.

<!-- 📸 SCREENSHOT: the status-bar "Notes" button and/or the ⌘K palette showing "Show Notes".
     Save as docs/screenshots/open.png, then uncomment:
![Opening Notes from the status bar or command palette](docs/screenshots/open.png)
-->

### Commands (any Hermes surface)

| Command | What it does |
|---|---|
| `/note` | Show this project's notes |
| `/note --session` | Show this conversation's notes |
| `/note-clear` | Archive and clear this project's notes |
| `/note-clear --session` | Archive and clear this conversation's notes |
| `/note-clear --purge` | Delete with **no** backup (combine with `--session` for session notes) |

### The agent tool

The agent can call `note_add`, a tool that appends a timestamped markdown entry:

```
note_add(text: string, scope?: "project" | "session")   # default scope: project
```

You can ask for it directly ("jot that down in the project notes"). The tool lives in the `scratch_notes` toolset; turn it off with `hermes tools` if you'd rather the agent didn't write notes.

### Keyboard reference (live-preview editor)

| Key | Action |
|---|---|
| Click a line | Edit that line's raw markdown |
| Enter | New line. Continues a todo or list; on an empty item, ends the list. |
| Backspace at line start | Removes a todo's checkbox (keeps the text), or joins the line with the one above |
| ↑ / ↓ | Move between lines |
| Esc | Stop editing |

## Where notes are stored

```
<HERMES_HOME>/plugin-data/scratch-notes/
├── project-<folder-name>-<hash>.md        # one per working directory
├── session-<session-id>.md                # one per conversation
└── *.<timestamp>.bak.md                   # archives from /note-clear (newest 5 kept)
```

`HERMES_HOME` is `~/.hermes` for the default profile. Each Hermes profile keeps its own notes. The files are plain markdown, so you can open, back up or sync them with anything.

## How it fits together

One package covers every Hermes plugin surface, and all of them read and write the same files:

| Part | Files | Provides |
|---|---|---|
| Agent plugin | `__init__.py`, `storage.py` | The `note_add` tool and the `/note` and `/note-clear` commands |
| Backend API | `dashboard/plugin_api.py` | REST routes at `/api/plugins/scratch-notes/` |
| Desktop panel | `desktop/plugin.js` | The docked live-preview editor |
| Browser dashboard tab | `dashboard/manifest.json`, `dashboard/dist/index.js` | A basic editor in `hermes dashboard`. **Experimental:** it hasn't been tested against a running dashboard. |

## Troubleshooting

- **No Notes panel, shortcut or status-bar button.** Check that Scratch Notes is on in Capabilities → Plugins. Closing the panel's ✕ turns the plugin off, because it's the plugin's only panel. Turn it back on there.
- **Panel buttons are greyed out or both scopes look empty after updating.** The backend API only reloads when the backend restarts. Run ⌘K → "Restart backend", or quit and reopen Hermes Desktop.
- **"No focused session".** Session notes need an open chat; click into one.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run the tests:

```bash
# Storage tests (any Python 3.10+ with pytest; no Hermes install needed)
pytest tests

# Editor tests (Node 22+)
npm install
npm test

# Full plugin check (needs Hermes installed)
hermes plugins validate .
```

CI runs the first two on every push and pull request. `package.json` only holds test dependencies; Hermes loads `desktop/plugin.js` directly and nothing from `node_modules` ships to users.

## License

[MIT](LICENSE)
