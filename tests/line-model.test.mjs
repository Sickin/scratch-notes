// Pure line-model functions behind the live-preview editor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPlugin } from './load-plugin.mjs'

const P = await loadPlugin()
const first = text => P.parseBlocks(text)[0]

test('a todo line parses as a task with its text separated', () => {
  const b = first('- [ ] buy milk')
  assert.equal(b.kind, 'task')
  assert.equal(b.content, 'buy milk')
  assert.equal(b.checked, false)
})

test('checked, uppercase X and other bullet markers are tasks too', () => {
  assert.equal(first('- [x] done').checked, true)
  assert.equal(first('- [X] done').checked, true)
  assert.equal(first('* [ ] star').kind, 'task')
  assert.equal(first('+ [ ] plus').kind, 'task')
})

test('a bare "- [ ]" is an empty task', () => {
  const b = first('- [ ]')
  assert.equal(b.kind, 'task')
  assert.equal(P.editableOf(['- [ ]'], b), '')
})

test('fenced code and tables are each one block', () => {
  const blocks = P.parseBlocks('a\n```js\nx\n```\nb\n| h |\n| - |\n| c |\nd')
  assert.deepEqual(blocks.map(b => [b.kind, b.start, b.end]), [
    ['line', 0, 0], ['multi', 1, 3], ['line', 4, 4], ['multi', 5, 7], ['line', 8, 8],
  ])
})

test('editing a task text keeps its checkbox prefix and state', () => {
  const text = '- [x] old'
  assert.equal(P.replaceBlock(text, first(text), 'new'), '- [x] new')
})

test('toggleTaskAt flips only the requested line', () => {
  assert.equal(P.toggleTaskAt('- [ ] a\n- [ ] b', 1), '- [ ] a\n- [x] b')
  assert.equal(P.toggleTaskAt('- [x] a', 0), '- [ ] a')
  assert.equal(P.toggleTaskAt('plain', 0), 'plain')
})

test('Enter in the middle of a todo splits it into two todos', () => {
  const text = '- [x] buy milk'
  const r = P.splitBlock(text, first(text), 'buy milk', 3)
  assert.equal(r.text, '- [x] buy\n- [ ]  milk')
  assert.equal(r.line, 1)
})

test('Enter on an empty todo ends the list', () => {
  const r = P.splitBlock('- [ ] ', first('- [ ] '), '', 0)
  assert.equal(r.text, '')
})

test('Enter continues bullets and numbered lists', () => {
  const bullet = P.splitBlock('- item', first('- item'), '- item', 6)
  assert.equal(bullet.text, '- item\n- ')
  const numbered = P.splitBlock('3. item', first('3. item'), '3. item', 7)
  assert.equal(numbered.text, '3. item\n4. ')
})

test('Backspace at the start of a todo drops the checkbox but keeps the text', () => {
  const text = '- [x] done'
  const blocks = P.parseBlocks(text)
  assert.equal(P.backspaceAtStart(text, blocks, blocks[0], 'done').text, 'done')
})

test('Backspace at the start of a plain line joins it to the line above', () => {
  const text = 'one\ntwo'
  const blocks = P.parseBlocks(text)
  const r = P.backspaceAtStart(text, blocks, blocks[1], 'two')
  assert.equal(r.text, 'onetwo')
  assert.equal(r.caret, 3)
})

test('the ☐ button turns a line or bullet into a todo, and back', () => {
  assert.equal(P.toggleTaskKind('task', first('task'), 'task').text, '- [ ] task')
  assert.equal(P.toggleTaskKind('- item', first('- item'), '- item').text, '- [ ] item')
  assert.equal(P.toggleTaskKind('- [ ] item', first('- [ ] item'), 'item').text, 'item')
})

test('strikethrough wraps, unwraps, and inserts an empty pair', () => {
  assert.equal(P.toggleStrikethrough('a word', 2, 6).text, 'a ~~word~~')
  assert.equal(P.toggleStrikethrough('a ~~word~~', 2, 10).text, 'a word')
  const empty = P.toggleStrikethrough('ab', 1, 1)
  assert.equal(empty.text, 'a~~~~b')
  assert.equal(empty.start, 3)
})
