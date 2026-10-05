import test from 'node:test'
import assert from 'node:assert/strict'
import { nextCwdTrust, CWD_SETTLE_MS } from '../desktop/plugin.js'

const at = (state, input) => nextCwdTrust(state, { now: 0, ...input })

test('first sight and drafts are trusted immediately', () => {
  assert.equal(at(null, { sessionId: 's1', cwd: '/a' }).trusted, true)
  assert.equal(at(null, { sessionId: null, cwd: '/a' }).trusted, true)
  const s1 = at(null, { sessionId: 's1', cwd: '/a' })
  assert.equal(at(s1, { sessionId: null, cwd: '/a' }).trusted, true)
})

test('switching chats distrusts the folder until it changes', () => {
  const s1 = at(null, { sessionId: 's1', cwd: '/projA' })
  // Chat id changes first; the folder is still the previous chat's.
  const switched = at(s1, { sessionId: 's2', cwd: '/projA' })
  assert.equal(switched.trusted, false)
  assert.equal(switched.sessionId, 's2')
  // Nothing changed yet, not enough time passed: still distrusted (same object).
  assert.equal(at(switched, { sessionId: 's2', cwd: '/projA', now: CWD_SETTLE_MS - 1 }), switched)
  // The folder follows the new chat: trusted.
  assert.equal(at(switched, { sessionId: 's2', cwd: '/projB', now: 10 }).trusted, true)
})

test('a chat in the same project is trusted once the folder has stayed put', () => {
  const s1 = at(null, { sessionId: 's1', cwd: '/projA' })
  const switched = at(s1, { sessionId: 's2', cwd: '/projA' })
  const settled = at(switched, { sessionId: 's2', cwd: '/projA', now: CWD_SETTLE_MS })
  assert.equal(settled.trusted, true)
})

test('a trusted state is stable for the same chat', () => {
  const s1 = at(null, { sessionId: 's1', cwd: '/projA' })
  assert.equal(at(s1, { sessionId: 's1', cwd: '/projB', now: 5 }), s1)
})

test('switching again while settling restarts the wait', () => {
  const s1 = at(null, { sessionId: 's1', cwd: '/projA' })
  const s2 = at(s1, { sessionId: 's2', cwd: '/projA', now: 100 })
  const s3 = at(s2, { sessionId: 's3', cwd: '/projA', now: 900 })
  assert.equal(s3.trusted, false)
  assert.equal(s3.since, 900)
})
