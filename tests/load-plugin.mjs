// Loads desktop/plugin.js under Node for tests.
//
// Hermes Desktop resolves `@hermes/plugin-sdk` to its own in-app module;
// Node can't, so we copy the plugin into a temp file with that one import
// pointed at a small stub (real Streamdown, inert everything else) and import
// the copy. The plugin source itself is never edited.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginPath = join(here, '..', 'desktop', 'plugin.js')
const stubUrl = pathToFileURL(join(here, 'sdk-stub.mjs')).href

export async function loadPlugin() {
  const source = readFileSync(pluginPath, 'utf8')
  if (!source.includes("from '@hermes/plugin-sdk'")) {
    throw new Error("desktop/plugin.js no longer imports from '@hermes/plugin-sdk' — update load-plugin.mjs")
  }
  // The copy sits outside the repo, so bare imports (react, streamdown) must
  // still resolve against THIS repo's node_modules: rewrite them to absolute URLs.
  const resolveFromRepo = spec => import.meta.resolve(spec)
  const rewritten = source
    .replace("from '@hermes/plugin-sdk'", `from '${stubUrl}'`)
    .replace("from 'react/jsx-runtime'", `from '${resolveFromRepo('react/jsx-runtime')}'`)
    .replace("from 'react'", `from '${resolveFromRepo('react')}'`)
  const dir = mkdtempSync(join(tmpdir(), 'scratch-notes-test-'))
  const file = join(dir, 'plugin.mjs')
  writeFileSync(file, rewritten)
  return import(pathToFileURL(file).href)
}
