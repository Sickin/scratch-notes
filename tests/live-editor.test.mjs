// The live-preview editor, rendered with real React + real Streamdown in jsdom
// and driven the way a user would: click lines, type, toggle checkboxes.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Element',
  'getComputedStyle', 'requestAnimationFrame', 'MutationObserver']) {
  // defineProperty: Node's globalThis.navigator is getter-only.
  Object.defineProperty(globalThis, k, { value: dom.window[k] ?? globalThis[k], configurable: true, writable: true })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { fireEvent } = await import('@testing-library/dom')
const { loadPlugin } = await import('./load-plugin.mjs')
const { LiveEditor } = await loadPlugin()
const { act } = React

let container, root, state

function Harness({ initial }) {
  const [text, setText] = React.useState(initial)
  state = text
  return React.createElement(LiveEditor, {
    text,
    onText: next => { state = next; setText(next) },
    editorApi: { current: null },
    placeholder: 'empty',
  })
}

async function mount(initial) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(React.createElement(Harness, { initial })))
}

const line = n => container.querySelector(`[data-notes-line="${n}"]`)
const input = () => container.querySelector('[data-notes-line-input]')
const checkbox = n => line(n).querySelector('input[type=checkbox]')

after(async () => { if (root) await act(async () => root.unmount()) })

test('every line renders as markdown at rest, with no raw syntax visible', async () => {
  await mount('## Header 2\nsome **bold** text\n- [ ] first todo\n- [x] done todo')
  assert.equal(line(0).querySelector('h2')?.textContent, 'Header 2')
  assert.equal(line(1).querySelector('[data-streamdown=strong]')?.textContent, 'bold')
  assert.equal(container.querySelectorAll('input[type=checkbox]').length, 2)
  for (const raw of ['##', '**', '[ ]', '[x]']) assert.ok(!container.textContent.includes(raw), raw)
})

test('clicking a line shows only that line as raw markdown', async () => {
  await act(async () => fireEvent.mouseDown(line(0)))
  assert.equal(input()?.value, '## Header 2')
  assert.ok(line(1).querySelector('[data-streamdown=strong]'), 'other lines stay rendered')
})

test('typing updates the note, and leaving the line renders it again', async () => {
  await act(async () => fireEvent.change(input(), { target: { value: '## Header Two' } }))
  assert.ok(state.startsWith('## Header Two\n'))
  await act(async () => fireEvent.mouseDown(line(2)))
  assert.equal(line(0).querySelector('h2')?.textContent, 'Header Two')
})

test('an active todo keeps its checkbox and edits only its text', async () => {
  assert.ok(checkbox(2), 'checkbox still rendered while editing')
  assert.equal(input()?.value, 'first todo')
  await act(async () => fireEvent.change(input(), { target: { value: 'first todo, edited' } }))
  assert.ok(state.includes('- [ ] first todo, edited'))
})

test('checking a box updates the markdown and repaints immediately', async () => {
  await act(async () => fireEvent.click(checkbox(2)))
  assert.ok(state.includes('- [x] first todo, edited'))
  assert.equal(checkbox(2).checked, true)

  await act(async () => fireEvent.click(checkbox(3)))
  assert.ok(state.endsWith('- [ ] done todo'))
  assert.equal(checkbox(3).checked, false)
})

test('Enter on a todo starts a new empty todo with its own checkbox', async () => {
  await act(async () => {
    const el = input()
    el.setSelectionRange(el.value.length, el.value.length)
    fireEvent.keyDown(el, { key: 'Enter' })
  })
  assert.equal(state.split('\n')[3], '- [ ] ')
  assert.ok(checkbox(3))
  assert.equal(input()?.value, '')
})

test('blurring leaves every line rendered', async () => {
  // fireEvent.blur doesn't reach React's onBlur in jsdom; a real blur() does.
  await act(async () => input().blur())
  assert.equal(input(), null)
})
