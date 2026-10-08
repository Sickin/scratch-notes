// Minimal @hermes/plugin-sdk stand-in for tests: the real Streamdown renderer,
// inert placeholders for everything else the plugin imports.
import React from 'react'
export { Streamdown } from 'streamdown'

const Passthrough = ({ children }) => React.createElement(React.Fragment, null, children)

export const Button = props => React.createElement('button', props)
export const Tip = Passthrough
export const SegmentedControl = () => null
export const PANES_AREA = 'panes'
export const KEYBINDS_AREA = 'keybinds'
export const PALETTE_AREA = 'palette'
export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' }
export const host = { state: {}, revealPane: () => {} }
export const icons = new Proxy({}, { get: () => () => null })
export const queryClient = { invalidateQueries() {} }
export const useQuery = () => ({})
export const useValue = () => null
