#!/usr/bin/env node
/**
 * Stub the modules desktop/plugin.js imports so `node --test` can load it.
 * The desktop app rewrites `@hermes/plugin-sdk` / `react` to its own shims;
 * Node has no such rewrite. The stubs live in gitignored node_modules and are
 * never seen by the app.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const files = {
  'node_modules/@hermes/plugin-sdk/package.json': { name: '@hermes/plugin-sdk', type: 'module', main: './index.js' },
  'node_modules/@hermes/plugin-sdk/index.js': `const C = () => null
export const Button = C, SegmentedControl = C, Streamdown = C, Tip = C
export const KEYBINDS_AREA = 'keybinds', PALETTE_AREA = 'palette', PANES_AREA = 'panes'
export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' }
export const host = { state: {} }
export const icons = {}
export const queryClient = { invalidateQueries: () => Promise.resolve() }
export const useQuery = () => ({ data: undefined, isLoading: false, isError: false })
export const useValue = () => null
`,
  'node_modules/react/package.json': {
    name: 'react', type: 'module', main: './index.js',
    exports: { '.': './index.js', './jsx-runtime': './jsx-runtime.js' },
  },
  'node_modules/react/index.js': `export const useState = init => [typeof init === 'function' ? init() : init, () => {}]
export const useEffect = () => {}
export const useLayoutEffect = () => {}
export const useRef = init => ({ current: init })
`,
  'node_modules/react/jsx-runtime.js': `export const jsx = (type, props, key) => ({ type, props, key })
export const jsxs = jsx
`,
}

for (const [rel, content] of Object.entries(files)) {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n')
}
console.log('stubs OK')
