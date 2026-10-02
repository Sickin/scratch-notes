// ~/.hermes/plugins/scratch-notes/desktop/plugin.js
//
// Native Hermes Desktop pane for scratch-notes ("one package, both SDKs" —
// see website/docs/developer-guide/desktop-plugin-sdk.md). Reuses the SAME
// backend as the browser dashboard tab (dashboard/plugin_api.py) since that
// namespace (/api/plugins/scratch-notes/) is shared between the two SDKs —
// there is exactly one server-side implementation of note storage.
//
// Disk plugins load uncompiled: only @hermes/plugin-sdk, react, and
// react/jsx-runtime may be imported; write UI with jsx()/jsxs(), no JSX syntax.
import {
  Button, PANES_AREA, SegmentedControl, Streamdown, Tip, host, icons, queryClient,
  useQuery, useValue,
} from '@hermes/plugin-sdk'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'scratch-notes'
const AUTOSAVE_MS = 1200

// ---------------------------------------------------------------------------
// Pure line model (no React). The note stays ONE markdown string — the file on
// disk is the source of truth. The live editor views it as blocks: one per
// line, except fenced code and tables, which only render as a whole.
// ---------------------------------------------------------------------------

export const TASK_RE = /^(\s*)([-*+]) \[([ xX])\](?: (.*))?$/
const LIST_RE = /^(\s*)([-*+]|\d+[.)]) (.*)$/

export function parseBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      let j = i + 1
      while (j < lines.length && !lines[j].trim().startsWith(fence[1])) j++
      const end = Math.min(j, lines.length - 1)
      blocks.push({ kind: 'multi', start: i, end })
      i = end + 1
      continue
    }
    if (/^\s*\|/.test(line)) {
      let j = i
      while (j + 1 < lines.length && /^\s*\|/.test(lines[j + 1])) j++
      blocks.push({ kind: 'multi', start: i, end: j })
      i = j + 1
      continue
    }
    const m = TASK_RE.exec(line)
    blocks.push(m
      ? { kind: 'task', start: i, end: i, indent: m[1], marker: m[2], checked: m[3] !== ' ', content: m[4] ?? '' }
      : { kind: 'line', start: i, end: i })
    i++
  }
  return blocks
}

// What the active textarea holds for a block: a task's text only (its
// checkbox stays rendered beside it), a line verbatim, a multi block joined.
export function editableOf(lines, block) {
  if (block.kind === 'task') return block.content
  return lines.slice(block.start, block.end + 1).join('\n')
}

function taskLine(block, content, checked = block.checked) {
  return `${block.indent}${block.marker} [${checked ? 'x' : ' '}] ${content}`
}

function spliceLines(lines, start, end, replacement) {
  return [...lines.slice(0, start), ...replacement, ...lines.slice(end + 1)].join('\n')
}

export function replaceBlock(text, block, editable) {
  const lines = text.split('\n')
  const raw = block.kind === 'task' ? taskLine(block, editable) : editable
  return spliceLines(lines, block.start, block.end, raw.split('\n'))
}

export function toggleTaskAt(text, lineIdx) {
  const lines = text.split('\n')
  const m = TASK_RE.exec(lines[lineIdx] ?? '')
  if (!m) return text
  lines[lineIdx] = `${m[1]}${m[2]} [${m[3] === ' ' ? 'x' : ' '}] ${m[4] ?? ''}`
  return lines.join('\n')
}

// Enter inside a single-line block. Continues task/list items like every
// notes app; Enter on an EMPTY item ends the list instead of adding another.
// Returns the new text plus the line and caret offset to focus next.
export function splitBlock(text, block, editable, caret) {
  const lines = text.split('\n')
  const before = editable.slice(0, caret)
  const after = editable.slice(caret)
  if (block.kind === 'task') {
    if (editable === '') {
      return { text: spliceLines(lines, block.start, block.end, [block.indent]), line: block.start, caret: block.indent.length }
    }
    return {
      text: spliceLines(lines, block.start, block.end, [taskLine(block, before), taskLine(block, after, false)]),
      line: block.start + 1,
      caret: 0,
    }
  }
  const list = LIST_RE.exec(editable)
  if (list && caret >= editable.length - list[3].length) {
    const [, indent, marker, rest] = list
    if (rest === '') {
      return { text: spliceLines(lines, block.start, block.end, [indent]), line: block.start, caret: indent.length }
    }
    const numbered = /^(\d+)([.)])$/.exec(marker)
    const prefix = `${indent}${numbered ? `${Number(numbered[1]) + 1}${numbered[2]}` : marker} `
    return {
      text: spliceLines(lines, block.start, block.end, [before, prefix + after]),
      line: block.start + 1,
      caret: prefix.length,
    }
  }
  return { text: spliceLines(lines, block.start, block.end, [before, after]), line: block.start + 1, caret: 0 }
}

// Backspace at offset 0. A task first loses its checkbox (keeping its text);
// a plain line merges into the line above.
export function backspaceAtStart(text, blocks, block, editable) {
  const lines = text.split('\n')
  if (block.kind === 'task') {
    return { text: spliceLines(lines, block.start, block.end, [block.indent + editable]), line: block.start, caret: block.indent.length }
  }
  const prev = blocks[blocks.indexOf(block) - 1]
  if (!prev || prev.kind === 'multi' || block.kind !== 'line') return null
  const prevEditable = editableOf(lines, prev)
  const merged = prev.kind === 'task' ? taskLine(prev, prevEditable + editable) : prevEditable + editable
  return { text: spliceLines(lines, prev.start, block.end, [merged]), line: prev.start, caret: prevEditable.length }
}

// ☐ button: make a line a task (absorbing a plain "- " bullet), or turn a
// task back into plain text.
export function toggleTaskKind(text, block, editable) {
  const lines = text.split('\n')
  if (block.kind === 'task') {
    const plain = block.indent + editable
    return { text: spliceLines(lines, block.start, block.end, [plain]), line: block.start, caret: plain.length }
  }
  const list = LIST_RE.exec(editable)
  const bullet = list && !/^\d/.test(list[2])
  const indent = list ? list[1] : /^\s*/.exec(editable)[0]
  const content = bullet ? list[3] : editable.slice(indent.length)
  return { text: spliceLines(lines, block.start, block.end, [`${indent}- [ ] ${content}`]), line: block.start, caret: content.length }
}

// Wraps/unwraps the selection in ~~...~~. An empty selection inserts an empty
// pair with the cursor parked inside it.
export function toggleStrikethrough(text, start, end) {
  if (start === end) {
    return { text: text.slice(0, start) + '~~~~' + text.slice(end), start: start + 2, end: start + 2 }
  }
  const selected = text.slice(start, end)
  if (selected.length >= 4 && selected.startsWith('~~') && selected.endsWith('~~')) {
    const inner = selected.slice(2, -2)
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length }
  }
  const wrapped = `~~${selected}~~`
  return { text: text.slice(0, start) + wrapped + text.slice(end), start, end: start + wrapped.length }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Streamdown hands overrides a hast `node` prop — keep it off the DOM, pass
// everything else (an <ol start>, a link's href) through.
const tag = (name, className) => ({ node, ...props }) => jsx(name, { ...props, className })

// Compact typography for a narrow side pane; Streamdown's defaults are sized
// for a chat transcript.
const MD = {
  h1: tag('h1', 'm-0 text-lg font-bold leading-snug'),
  h2: tag('h2', 'm-0 text-base font-semibold leading-snug'),
  h3: tag('h3', 'm-0 text-sm font-semibold leading-snug'),
  h4: tag('h4', 'm-0 text-xs font-semibold'),
  h5: tag('h5', 'm-0 text-xs font-semibold'),
  h6: tag('h6', 'm-0 text-xs font-semibold'),
  p: tag('p', 'm-0 leading-relaxed'),
  ul: tag('ul', 'm-0 list-disc pl-4'),
  ol: tag('ol', 'm-0 list-decimal pl-4'),
  li: tag('li', 'leading-relaxed'),
  blockquote: tag('blockquote', 'm-0 border-l-2 border-(--ui-stroke-secondary) pl-2 text-(--ui-text-secondary)'),
  hr: tag('hr', 'my-1 border-(--ui-stroke-secondary)'),
}

function Markdown({ source }) {
  // key: Streamdown memoizes parsed blocks internally; keying on the source
  // forces a fresh paint whenever the line changes.
  return jsx(Streamdown, { components: MD, controls: false, mode: 'static', parseIncompleteMarkdown: false, children: source }, source)
}

// Grows with its content so the active line occupies the space of the line
// it replaced instead of a fixed-height box.
function LineInput({ value, inputRef, ...rest }) {
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value, inputRef])
  return jsx('textarea', {
    ref: inputRef,
    rows: 1,
    value,
    spellCheck: false,
    'data-notes-line-input': '',
    className: 'block w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-mono text-xs leading-relaxed outline-none',
    style: { color: 'var(--ui-text-primary)' },
    ...rest,
  })
}

export function LiveEditor({ text, onText, editorApi, placeholder }) {
  const blocks = parseBlocks(text)
  const lines = text.split('\n')
  const [active, setActive] = useState(null) // { line, caret | null }
  const inputRef = useRef(null)

  // Focus + place the caret whenever the active line is (re)chosen. Plain
  // typing never touches `active`, so this doesn't fight the user's caret.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!active || !el) return
    el.focus()
    const pos = Math.min(active.caret ?? el.value.length, el.value.length)
    el.setSelectionRange(pos, pos)
  }, [active])

  const activeBlock = active ? blocks.find(b => b.start === active.line) ?? null : null

  // Toolbar hooks (☐ / S) act on the active line; ☐ with nothing active
  // starts a new todo at the end of the note.
  if (editorApi) {
    editorApi.current = {
      toggleTask: () => {
        if (!activeBlock || activeBlock.kind === 'multi') {
          const lastBlank = lines[lines.length - 1] === ''
          const next = lastBlank ? `${text}- [ ] ` : `${text}\n- [ ] `
          onText(next)
          setActive({ line: next.split('\n').length - 1, caret: 0 })
          return
        }
        const r = toggleTaskKind(text, activeBlock, editableOf(lines, activeBlock))
        onText(r.text)
        setActive({ line: r.line, caret: r.caret })
      },
      strike: () => {
        const el = inputRef.current
        if (!activeBlock || !el) return
        const r = toggleStrikethrough(el.value, el.selectionStart, el.selectionEnd)
        onText(replaceBlock(text, activeBlock, r.text))
        requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.start, r.end) })
      },
    }
  }

  function apply(r) {
    onText(r.text)
    setActive({ line: r.line, caret: r.caret })
  }

  function onKeyDown(e, block) {
    const el = e.currentTarget
    const { selectionStart: s, selectionEnd: end, value } = el
    const idx = blocks.indexOf(block)
    if (e.key === 'Escape') {
      el.blur()
    } else if (e.key === 'Enter' && block.kind !== 'multi') {
      e.preventDefault()
      apply(splitBlock(text, block, value, s))
    } else if (e.key === 'Backspace' && s === 0 && end === 0) {
      const r = backspaceAtStart(text, blocks, block, value)
      if (r) { e.preventDefault(); apply(r) }
    } else if (e.key === 'ArrowUp' && !value.slice(0, s).includes('\n') && idx > 0) {
      e.preventDefault()
      setActive({ line: blocks[idx - 1].start, caret: null })
    } else if (e.key === 'ArrowDown' && !value.slice(end).includes('\n') && idx < blocks.length - 1) {
      e.preventDefault()
      setActive({ line: blocks[idx + 1].start, caret: null })
    }
  }

  // Clicking empty space under the last line types on a trailing blank line
  // (adding one if needed) — "click anywhere to type".
  function onBlankMouseDown(e) {
    if (e.target !== e.currentTarget) return
    e.preventDefault()
    const last = blocks[blocks.length - 1]
    if (last.kind === 'line' && lines[last.start] === '') {
      setActive({ line: last.start, caret: 0 })
      return
    }
    onText(`${text}\n`)
    setActive({ line: lines.length, caret: 0 })
  }

  const empty = text === ''

  return jsx('div', {
    className: 'flex-1 min-h-0 w-full overflow-y-auto rounded border p-2 text-xs cursor-text',
    style: { background: 'var(--card)', color: 'var(--ui-text-primary)', borderColor: 'var(--ui-stroke-secondary)' },
    'data-notes-editor': '',
    onMouseDown: onBlankMouseDown,
    children: blocks.map(block => {
      const isActive = activeBlock === block
      const editable = editableOf(lines, block)
      const checkbox = block.kind === 'task'
        ? jsx('input', {
            type: 'checkbox',
            checked: block.checked,
            'data-notes-task': String(block.start),
            className: 'mt-[0.2rem] shrink-0 cursor-pointer',
            // Don't activate the row or pull focus off the line being edited.
            onMouseDown: e => { e.stopPropagation(); e.preventDefault() },
            onChange: () => onText(toggleTaskAt(text, block.start)),
          })
        : null
      const body = isActive
        ? jsx('div', { className: 'min-w-0 flex-1', children: jsx(LineInput, {
            inputRef,
            value: editable,
            onChange: e => onText(replaceBlock(text, block, e.target.value)),
            onKeyDown: e => onKeyDown(e, block),
            // Clear only if focus left THIS line (not a switch to another).
            onBlur: () => setActive(a => (a && a.line === block.start ? null : a)),
          }) })
        : jsx('div', {
            className: `min-w-0 flex-1 break-words${block.kind === 'task' && block.checked ? ' line-through text-(--ui-text-tertiary)' : ''}`,
            children: editable.trim() === ''
              ? (empty ? jsx('span', { className: 'text-(--ui-text-tertiary)', children: placeholder }) : '\u00a0')
              : jsx(Markdown, { source: editable }),
          })
      return jsxs('div', {
        className: 'flex items-start gap-1.5',
        'data-notes-line': String(block.start),
        style: block.kind === 'task' && block.indent ? { paddingLeft: `${block.indent.length * 0.5}rem` } : undefined,
        onMouseDown: e => {
          if (isActive || e.target.closest('a')) return
          e.preventDefault()
          setActive({ line: block.start, caret: null })
        },
        children: [checkbox, body],
      }, block.start)
    }),
  })
}

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

// The gateway backend a desktop pane talks to is pooled per (connection,
// profile) — its process cwd means nothing for "the project I'm looking at".
// host.state.cwd is the client's own signal for that, so scope resolution
// goes through GET /resolve rather than the backend's own os.getcwd().
function useResolvedNoteId(ctx, scope, cwd, sessionId) {
  return useQuery({
    queryKey: [ID, 'resolve', scope, cwd, sessionId],
    queryFn: () => {
      const params = new URLSearchParams({ scope, cwd: cwd || '', session_id: sessionId || '' })
      return ctx.rest(`/resolve?${params}`)
    },
    // A session scope needs a real session id; an empty cwd means a detached
    // workspace (no project to key off), so don't ask the backend to fail.
    enabled: scope === 'project' ? true : Boolean(sessionId),
    staleTime: 60000,
  })
}

function NotesPane({ ctx }) {
  const cwd = useValue(host.state.cwd)
  const sessionId = useValue(host.state.focusedSessionId)
  const [scope, setScope] = useState(() => ctx.storage.get('local.scope', 'project'))
  const resolved = useResolvedNoteId(ctx, scope, cwd, sessionId)
  const noteId = resolved.data?.id ?? null

  const note = useQuery({
    queryKey: [ID, 'note', noteId],
    queryFn: () => ctx.rest(`/notes/${encodeURIComponent(noteId)}`).catch(err => {
      // A fresh scratchpad has no file yet — treat 404 as "empty", not an error.
      if (String(err?.message || err).includes('404')) return { id: noteId, content: '' }
      throw err
    }),
    enabled: Boolean(noteId),
  })

  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')
  const [source, setSource] = useState(() => ctx.storage.get('local.source', false))
  const loadedFor = useRef(null)
  const saveTimer = useRef(null)
  const sourceRef = useRef(null)
  const editorApi = useRef(null)

  // Adopt server content only when we land on a genuinely different note
  // (scope/note switch) — never clobber in-progress typing on a refetch.
  useEffect(() => {
    if (note.data && loadedFor.current !== noteId) {
      setText(note.data.content || '')
      setDirty(false)
      loadedFor.current = noteId
    }
  }, [note.data, noteId])

  function updateText(next) {
    setText(next)
    setDirty(true)
  }

  function setScopeAndPersist(next) {
    setScope(next)
    ctx.storage.set('local.scope', next)
  }

  function save() {
    if (!noteId) return
    ctx.rest(`/notes/${encodeURIComponent(noteId)}`, { method: 'PUT', body: { content: text } })
      .then(() => {
        setDirty(false)
        setStatus('Saved')
        queryClient.invalidateQueries({ queryKey: [ID, 'note', noteId] })
        ctx.setTimeout(() => setStatus(''), 1500)
      })
      .catch(() => setStatus('Save failed'))
  }

  useEffect(() => {
    if (!dirty) return undefined
    saveTimer.current = ctx.setTimeout(save, AUTOSAVE_MS)
    return () => clearTimeout(saveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  function clear(purge) {
    if (!noteId) return
    if (!window.confirm(purge ? 'Purge this note with no backup?' : 'Archive and clear this note?')) return
    ctx.rest(`/notes/${encodeURIComponent(noteId)}/clear?purge=${purge ? 'true' : 'false'}`, { method: 'POST' })
      .then(() => {
        setText('')
        setDirty(false)
        queryClient.invalidateQueries({ queryKey: [ID, 'note', noteId] })
      })
      .catch(() => setStatus('Clear failed'))
  }

  // Source mode: the whole note as one textarea, for bulk paste/edit.
  function sourceEdit(kind) {
    const el = sourceRef.current
    if (!el) return
    const { selectionStart, selectionEnd } = el
    if (kind === 'strike') {
      const r = toggleStrikethrough(text, selectionStart, selectionEnd)
      updateText(r.text)
      ctx.setTimeout(() => { el.focus(); el.setSelectionRange(r.start, r.end) }, 0)
      return
    }
    const lineIdx = text.slice(0, selectionStart).split('\n').length - 1
    const block = parseBlocks(text).find(b => b.start <= lineIdx && lineIdx <= b.end)
    if (!block || block.kind === 'multi') return
    updateText(toggleTaskKind(text, block, editableOf(text.split('\n'), block)).text)
  }

  const sessionUnavailable = scope === 'session' && !sessionId
  const noProject = scope === 'project' && !cwd
  // Toolbar buttons must not steal focus from the line being edited.
  const keepFocus = e => e.preventDefault()

  return jsxs('div', { className: 'flex h-full flex-col gap-2 p-2', children: [
    jsx(SegmentedControl, {
      value: scope,
      onChange: setScopeAndPersist,
      options: [{ id: 'project', label: 'Project' }, { id: 'session', label: 'Session' }],
    }),
    sessionUnavailable && jsx('div', { className: 'text-xs text-(--ui-text-tertiary) p-2',
      children: 'No focused session — open or focus a chat to see its session notes.' }),
    noProject && jsx('div', { className: 'text-xs text-(--ui-text-tertiary) p-2',
      children: 'No active workspace — open a project to see its notes.' }),
    !sessionUnavailable && !noProject && jsxs('div', { className: 'flex flex-1 flex-col gap-2 min-h-0', children: [
      jsxs('div', { className: 'flex items-center gap-1', children: [
        jsx(Tip, { label: 'Add / toggle to-do', children: jsx(Button, {
          variant: 'ghost', size: 'xs', disabled: !noteId, onMouseDown: keepFocus,
          onClick: () => (source ? sourceEdit('task') : editorApi.current?.toggleTask()),
          children: '☐',
        }) }),
        jsx(Tip, { label: 'Toggle strikethrough', children: jsx(Button, {
          variant: 'ghost', size: 'xs', disabled: !noteId, onMouseDown: keepFocus,
          onClick: () => (source ? sourceEdit('strike') : editorApi.current?.strike()),
          children: jsx('span', { style: { textDecoration: 'line-through' }, children: 'S' }),
        }) }),
        jsx('div', { className: 'flex-1' }),
        jsx(Tip, { label: source ? 'Back to live preview' : 'Edit whole note as markdown source', children: jsx(Button, {
          variant: 'ghost', size: 'icon-xs',
          onClick: () => { const next = !source; setSource(next); ctx.storage.set('local.source', next) },
          children: jsx(source ? icons.Eye : icons.FileText, { size: 14 }),
        }) }),
      ] }),
      source
        ? jsx('textarea', {
            ref: sourceRef,
            value: text,
            onChange: e => updateText(e.target.value),
            placeholder: note.isLoading ? 'Loading…' : 'No notes yet — jot something down.',
            className: 'flex-1 min-h-0 w-full resize-none rounded border p-2 font-mono text-xs',
            style: { background: 'var(--card)', color: 'var(--ui-text-primary)', borderColor: 'var(--ui-stroke-secondary)' },
          })
        : jsx(LiveEditor, {
            key: noteId ?? 'none',
            text,
            onText: updateText,
            editorApi,
            placeholder: note.isLoading ? 'Loading…' : 'No notes yet — click to start typing.',
          }),
      jsxs('div', { className: 'flex items-center gap-1.5', children: [
        jsx(Tip, { label: 'Save now', children: jsx(Button, {
          variant: 'ghost', size: 'icon-xs', disabled: !dirty || !noteId, onClick: save,
          children: jsx(icons.Save, { size: 14 }),
        }) }),
        jsx(Tip, { label: 'Archive and clear', children: jsx(Button, {
          variant: 'ghost', size: 'icon-xs', disabled: !noteId, onClick: () => clear(false),
          children: jsx(icons.Archive, { size: 14 }),
        }) }),
        jsx(Tip, { label: 'Purge (no backup)', children: jsx(Button, {
          variant: 'ghost', size: 'icon-xs', disabled: !noteId, onClick: () => clear(true),
          children: jsx(icons.Trash2, { size: 14 }),
        }) }),
        jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)',
          children: status || (dirty ? `Autosaves in ${AUTOSAVE_MS / 1000}s…` : '') }),
      ] }),
    ] }),
  ] })
}

export default {
  id: ID,
  name: 'Scratch Notes',
  description: 'Project- and session-scoped markdown scratchpad with live preview, in a docked pane.',
  register(ctx) {
    ctx.register({
      id: 'pane',
      area: PANES_AREA,
      title: 'Notes',
      data: {
        // 'main' is the tile role (what host.openWorkspace uses): a tile alone
        // in its zone KEEPS its tab strip — the "Notes" header you drag to
        // move/redock it. A 'right' pane alone in its zone hides its strip.
        placement: 'main',
        // First placement only: beside the chat, not stacked over it.
        dock: { pane: 'workspace', pos: 'right' },
        width: '320px',
        minWidth: '240px',
        minHeight: '200px',
      },
      render: () => jsx(NotesPane, { ctx }),
    })
  },
}
