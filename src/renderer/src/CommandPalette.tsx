import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useModalLayer } from './modalStack'
import { dockApi, focusTab, openAdhoc, openAgent, openAgentChat, openFanout, openHistory, openRoutine, openRoutineEditorModal, openTasks, openTerminal } from './layout'
import { openSettingsModal } from './SettingsModal'
import { openOnboarding, openWhatsNew } from './Onboarding'
import { ITEMS, PAGES } from './settingsRegistry'
import { getStore } from './store'
import { getSidebarState, openItem } from './sidebarStore'
import { getSettingsSnapshot, updateSettings } from './appearance'
import { getAgentsState as getAgentsSnapshot } from './agentStore'
import { agentDef } from '../../shared/agents'
import { shortcutFor } from './shortcuts'
import { AWAKE_MODES } from './awake'
import { requestNewFolder } from './NewItems'

// Paleta de comandos (Ctrl+Shift+P; Ctrl+K fora do terminal): todo verbo e todo lugar do app num lugar so,
// com busca aproximada. Os mesmos rotulos do menu New, da sidebar e do Settings.
interface Command {
  id: string
  title: string
  group: string
  keys?: string
  hint?: string
  boost?: number // destinos principais (paginas do Settings) antes dos itens dentro delas
  run: () => void
}

let open = false
const subs = new Set<() => void>()
const emit = (): void => subs.forEach((f) => f())
export const openPalette = (): void => {
  open = true
  emit()
}
const closePalette = (): void => {
  open = false
  emit()
}

function buildCommands(): Command[] {
  const c: Command[] = []
  // key: id estavel (abas, rotinas e itens podem ter o mesmo nome); sem ele, grupo + titulo
  const add = (group: string, title: string, run: () => void, keys?: string, hint?: string, key?: string): void => void c.push({ id: key ?? `${group}:${title}`, group, title, run, keys, hint })
  const settings = getSettingsSnapshot()
  // New: os mesmos itens do menu New
  add('New', 'New agent (best account)', () => openAgent(), shortcutFor('New agent'))
  // mesmas contas do menu do Agent: ligadas e de agente instalado; sem login aparece marcado
  const ag = getAgentsSnapshot()
  for (const a of ag.accounts.filter((x) => x.enabled && ag.installed.includes(x.agent)))
    add('New', `New agent on ${a.label}${ag.signedOut.includes(a.id) ? ' (not signed in)' : ag.usage[a.id]?.state === 'exhausted' ? ' (at its limit)' : ''}`, () => openAgent({ agent: a.agent, accountId: a.id }), undefined, agentDef(a.agent)?.name, `account:${a.id}`)
  add('New', 'New chat', () => openAgentChat())
  add('New', 'New terminal', () => openTerminal(), shortcutFor('New terminal'))
  for (const conn of (settings?.connections ?? []).filter((x) => x.kind === 'endpoint')) add('New', `New terminal: Claude Code on ${conn.name}`, () => openTerminal(undefined, { profile: conn.id, initialCommand: 'claude --chrome' }))
  add('New', 'New routine…', () => openRoutine(null, 'New routine'))
  add('New', 'New ad hoc run…', () => openAdhoc(), shortcutFor('New ad hoc run'))
  add('New', 'New fan-out…', () => openFanout())
  add('New', 'New folder…', requestNewFolder)
  // Go to: lugares, abas abertas, rotinas e itens de pasta
  add('Go to', 'Runs', () => openHistory(), shortcutFor('Runs'))
  add('Go to', 'Tasks', () => openTasks(), shortcutFor('Tasks'))
  for (const p of dockApi()?.panels ?? []) add('Go to', `Tab: ${p.title ?? p.id}`, () => focusTab(p.id), undefined, undefined, `tab:${p.id}`)
  const { routines } = getStore()
  for (const r of routines) {
    add('Go to', `Routine: ${r.config.name}`, () => openRoutine(r.id, r.config.name), undefined, undefined, `routine:${r.id}`)
    add('Routines', `Configure routine: ${r.config.name}`, () => openRoutineEditorModal(r.id), undefined, undefined, `configure:${r.id}`)
  }
  for (const f of getSidebarState().folders) for (const it of f.items) add('Go to', `${f.name} › ${it.name}`, () => void openItem(it), undefined, it.kind === 'link' ? 'link' : 'folder item', `item:${it.id}`)
  add('Routines', 'Open routines folder', () => void window.turno.routines.openFolder())
  // View
  add('View', 'Show or hide the sidebar', () => window.dispatchEvent(new Event('turno:toggle-sidebar')), 'Ctrl+B')
  add('View', 'Split right', () => openTerminal('right'), 'Alt+Shift+=')
  add('View', 'Split down', () => openTerminal('below'), 'Alt+Shift+-')
  add('View', 'Maximize or restore the pane', () => {
    const api = dockApi()
    const p = api?.activePanel
    if (api && p) api.hasMaximizedGroup() ? api.exitMaximizedGroup() : api.maximizeGroup(p)
  }, 'Ctrl+Shift+M')
  add('View', 'Close the pane', () => dockApi()?.activePanel?.api.close(), 'Ctrl+Shift+W')
  // Settings: cada pagina, cada item indexado e atalhos de estado
  add('Settings', 'Open settings', () => openSettingsModal(), 'Ctrl+,')
  for (const p of PAGES) add('Settings', `Settings: ${p.label}`, () => openSettingsModal(p.id))
  for (const cmd of c) if (cmd.group === 'Settings') cmd.boost = 300
  for (const it of ITEMS) add('Settings', `${PAGES.find((p) => p.id === it.page)?.label} › ${it.label}`, () => openSettingsModal(it.anchor ? `${it.page}:${it.anchor}` : it.page), undefined, it.keywords)
  for (const m of AWAKE_MODES) add('Settings', `Keep the computer awake: ${m.t}`, () => void updateSettings({ keepAwake: m.v }))
  // Help
  add('Help', 'Keyboard shortcuts', () => openSettingsModal('shortcuts'))
  add('Help', 'Show the setup tour', () => openOnboarding())
  add('Help', "What's new", () => void openWhatsNew(true))
  return c
}

// Busca: o texto inteiro no titulo vale mais; senao cada palavra digitada aparece no titulo ou nas palavras-chave
// (ex.: "jira token"); por ultimo letras na ordem, cada uma emendada na anterior ou no inicio de uma palavra
// ("kca" acha "Keep the computer awake", mas "theme" nao casa com letras soltas de "Keep the computer awake").
const BOUNDARY = /[\s:›/(-]/
function score(q: string, title: string, hint = ''): number {
  const t = title.toLowerCase()
  const s = q.toLowerCase().trim()
  if (!s) return 1
  if (t.includes(s)) return 1000 - t.indexOf(s) + (t.startsWith(s) ? 200 : 0)
  const words = s.split(/\s+/).filter(Boolean)
  const h = hint.toLowerCase()
  if (words.every((w) => t.includes(w) || h.includes(w)))
    return (
      (words.every((w) => t.includes(w)) ? 600 : 300) +
      words.reduce((n, w) => n + (new RegExp(`(^|[\\s:›/(-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t) ? 40 : 0), 0) -
      t.length / 10
    )
  let ti = 0
  let pts = 0
  for (const ch of s) {
    if (ch === ' ') continue
    let at = t.indexOf(ch, ti)
    // emendada na letra anterior, ou a proxima ocorrencia em inicio de palavra
    while (at >= 0 && at !== ti && !(at === 0 || BOUNDARY.test(t[at - 1]))) at = t.indexOf(ch, at + 1)
    if (at < 0) return 0
    pts += at === ti && ti > 0 ? 3 : 4
    ti = at + 1
  }
  return pts
}

const RECENT_KEY = 'turno.palette.recent'
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function CommandPaletteHost() {
  const isOpen = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => open,
  )
  const box = useRef<HTMLDivElement>(null)
  const z = useModalLayer(isOpen, closePalette, box)
  useEffect(() => {
    const f = (): void => openPalette()
    window.addEventListener('turno:palette', f)
    return () => window.removeEventListener('turno:palette', f)
  }, [])
  if (!isOpen) return null
  return (
    <div className="modal-backdrop palette-backdrop" style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), closePalette())}>
      <div ref={box} tabIndex={-1} className="modal palette" role="dialog" aria-label="Command palette" aria-modal="true">
        <Palette />
      </div>
    </div>
  )
}

function Palette() {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const all = useMemo(buildCommands, [])
  const listRef = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => {
    if (!q.trim()) {
      // vazio: recentes primeiro, depois New e Go to
      const recent = readRecent()
        .map((id) => all.find((c) => c.id === id))
        .filter((c): c is Command => !!c)
        .map((c) => ({ ...c, group: 'Recent' }))
      return [...recent, ...all.filter((c) => c.group === 'New' || c.group === 'Go to').filter((c) => !recent.some((r) => r.id === c.id))].slice(0, 60)
    }
    return all
      .map((c) => ({ c, s: Math.max(score(q, c.title, c.hint), score(q, `${c.group} ${c.title}`, c.hint) * 0.8) }))
      .map((x) => ({ ...x, s: x.s > 0 ? x.s + (x.c.boost ?? 0) : 0 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      // cada grupo aparece uma vez so, na posicao do seu melhor resultado (dentro dele, por pontuacao)
      .map((x, i, arr) => ({ ...x, g: arr.findIndex((y) => y.c.group === x.c.group), i }))
      .sort((a, b) => a.g - b.g || a.i - b.i)
      .map((x) => x.c)
  }, [q, all])
  useEffect(() => setSel(0), [q])
  // corpo em bloco: scrollIntoView devolve uma Promise no Chromium novo, e o React a trataria como funcao de limpeza
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  const run = (c: Command | undefined): void => {
    if (!c) return
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([c.id, ...readRecent().filter((x) => x !== c.id)].slice(0, 5)))
    } catch {
      /* sem localStorage: segue sem recentes */
    }
    closePalette()
    // roda depois de o modal sair (o foco volta para quem abriu e o comando pode abrir outro modal)
    setTimeout(c.run, 60)
  }
  let lastGroup = ''
  return (
    <>
      <input
        autoFocus
        className="palette-input"
        placeholder="Type a command, a tab, a routine or a setting"
        aria-label="Command"
        aria-controls="palette-list"
        aria-activedescendant={shown[sel] ? `pal-${sel}` : undefined}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setSel((i) => Math.min(shown.length - 1, i + 1)))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((i) => Math.max(0, i - 1)))
          else if (e.key === 'PageDown') (e.preventDefault(), setSel((i) => Math.min(shown.length - 1, i + 8)))
          else if (e.key === 'PageUp') (e.preventDefault(), setSel((i) => Math.max(0, i - 8)))
          else if (e.key === 'Enter') (e.preventDefault(), run(shown[sel]))
        }}
      />
      <div className="palette-list" id="palette-list" role="listbox" aria-label="Commands" ref={listRef}>
        {shown.map((c, i) => {
          const head = c.group !== lastGroup ? c.group : ''
          lastGroup = c.group
          return (
            <div key={`${c.group}:${c.id}`}>
              {head && <div className="palette-group">{head}</div>}
              <div id={`pal-${i}`} role="option" aria-selected={i === sel} className={`palette-item ${i === sel ? 'on' : ''}`} onMouseMove={() => i !== sel && setSel(i)} onMouseDown={(e) => (e.preventDefault(), run(c))}>
                <span className="palette-title">{c.title}</span>
                {c.keys && <kbd>{c.keys}</kbd>}
              </div>
            </div>
          )
        })}
        {!shown.length && <p className="muted small palette-empty">Nothing matches "{q.trim()}".</p>}
      </div>
      <div className="palette-foot muted small">↑↓ choose · Enter run · Esc close</div>
    </>
  )
}
