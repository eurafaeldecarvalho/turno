import { useSyncExternalStore } from 'react'
import type { Settings } from '../../shared/types'
import { themeById } from '../../shared/themes'

// Configuracoes no renderer: carregadas uma vez e atualizadas ao vivo pelo main.
let settings: Settings | undefined
const subs = new Set<() => void>()

export function useSettings(): Settings | undefined {
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => settings,
  )
}

export function onSettings(cb: (s: Settings) => void): () => void {
  const f = (): void => settings && cb(settings)
  subs.add(f)
  if (settings) cb(settings)
  return () => subs.delete(f)
}

function set(s: Settings): void {
  settings = s
  applyAppearance(s)
  subs.forEach((f) => f())
}

export async function initSettings(): Promise<void> {
  set(await window.turno.settings.get())
  window.turno.settings.onChanged(set)
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  set(await window.turno.settings.set(patch))
}

const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// Tema = variaveis CSS no :root (a folha de estilos so usa var(--...)).
export function applyAppearance(s: Settings): void {
  const t = themeById(s.theme)
  const r = document.documentElement.style
  const u = t.ui
  const vars: Record<string, string> = {
    '--bg': u.bg,
    '--surface': u.surface,
    '--surface-2': u.surface2,
    '--surface-3': u.surface3,
    '--border': u.border,
    '--border-strong': u.borderStrong,
    '--text': u.text,
    '--muted': u.muted,
    '--faint': u.faint,
    '--accent': u.accent,
    '--accent-soft': hexA(u.accent, 0.14),
    '--accent-line': hexA(u.accent, 0.55),
    '--ok': u.ok,
    '--ok-soft': hexA(u.ok, 0.1),
    '--run': u.run,
    '--run-soft': hexA(u.run, 0.15),
    '--warn': u.warn,
    '--warn-soft': hexA(u.warn, 0.1),
    '--err': u.err,
    '--err-soft': hexA(u.err, 0.1),
    '--hover': t.dark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.04)',
    '--ui-font': s.uiFontFamily,
    '--ui-size': `${s.uiFontSize}px`,
    '--mono': s.terminal.fontFamily,
  }
  for (const [k, v] of Object.entries(vars)) r.setProperty(k, v)
  r.setProperty('color-scheme', t.dark ? 'dark' : 'light')
  document.documentElement.dataset.theme = t.dark ? 'dark' : 'light'
}
