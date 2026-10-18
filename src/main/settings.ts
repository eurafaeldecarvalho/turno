import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import type { Settings } from '../shared/types'

const file = (): string => join(app.getPath('userData'), 'settings.json')

export const TERMINAL_DEFAULTS: Settings['terminal'] = {
  fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.2,
  letterSpacing: 0,
  fontWeight: 'normal',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  copyOnSelect: false,
  rightClickPaste: true,
  defaultShell: 'pwsh.exe',
}

const defaults = (): Settings => ({
  keepAwake: 'auto',
  routinesDir: join(app.getPath('home'), 'rotinas'),
  openAtLogin: false,
  ntfyTopic: '',
  ntfyServer: 'https://ntfy.sh',
  theme: 'turno-dark',
  uiFontFamily: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  uiFontSize: 13,
  terminal: TERMINAL_DEFAULTS,
})

let cache: Settings | undefined

export function getSettings(): Settings {
  if (!cache) {
    try {
      const saved = JSON.parse(readFileSync(file(), 'utf8'))
      cache = { ...defaults(), ...saved, terminal: { ...TERMINAL_DEFAULTS, ...(saved.terminal ?? {}) } }
    } catch {
      cache = defaults()
    }
  }
  // Testes/smoke apontam para outra pasta sem mexer no settings.json.
  if (process.env.TURNO_ROUTINES_DIR) return { ...cache!, routinesDir: process.env.TURNO_ROUTINES_DIR }
  return cache!
}

export function setSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings()
  cache = { ...cur, ...patch, terminal: { ...cur.terminal, ...(patch.terminal ?? {}) } }
  writeFileSync(file(), JSON.stringify(cache, null, 2))
  return getSettings()
}
