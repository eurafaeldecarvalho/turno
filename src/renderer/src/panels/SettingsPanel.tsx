import { useEffect, useId, useRef, useState } from 'react'
import { AgentsSection } from './AgentsSection'
import { StartFolderCard } from '../startFolder'
import { filterFonts } from '../../../shared/fonts'
import { McpSection } from './McpSection'
import { openOnboarding, openWhatsNew } from '../Onboarding'
import { toast } from '../Toast'
import { askConfirm } from '../ConfirmDialog'
import { NumInput } from '../NumInput'
import type { CursorStyle, Settings, ShellInfo, TerminalSettings } from '../../../shared/types'
import { THEMES, type Theme } from '../../../shared/themes'
import { previewTheme, updateSettings, useSettings } from '../appearance'
import { Switch } from './RoutineEditor'
import { ConnectionsSection } from './ConnectionsSection'
import { IconCheck, IconChevron } from '../icons'
import { GROUPS, PAGES, searchSettings, type SettingsPage } from '../settingsRegistry'
import { goToSettings, setSettingsFlush, takeSettingsAnchor, useSettingsNav, useSettingsPage } from '../SettingsModal'
import { SHORTCUTS } from '../shortcuts'
import { useAgents } from '../agentStore'
import { IntegrationsSection } from './IntegrationsSection'
import { AWAKE_MODES } from '../awake'

const AWAKE = AWAKE_MODES

const UI_FONTS = [
  { v: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif', l: 'Segoe UI (Windows)' },
  { v: 'Inter, "Segoe UI", system-ui, sans-serif', l: 'Inter' },
  { v: '"Geist", "Segoe UI", system-ui, sans-serif', l: 'Geist' },
  { v: 'system-ui, sans-serif', l: 'System font' },
]
const MONO_FONTS = [
  { v: '"Cascadia Mono", "Cascadia Code", Consolas, monospace', l: 'Cascadia Mono' },
  { v: '"Cascadia Code", Consolas, monospace', l: 'Cascadia Code (ligatures)' },
  { v: '"JetBrains Mono", Consolas, monospace', l: 'JetBrains Mono' },
  { v: '"Fira Code", Consolas, monospace', l: 'Fira Code' },
  { v: '"Geist Mono", Consolas, monospace', l: 'Geist Mono' },
  { v: 'Consolas, monospace', l: 'Consolas' },
]
const CURSORS: Array<{ v: CursorStyle; l: string }> = [
  { v: 'block', l: 'block' },
  { v: 'bar', l: 'bar' },
  { v: 'underline', l: 'underline' },
]

// Escuros primeiro, depois claros; cada grupo em ordem alfabetica.
const byName = (a: Theme, b: Theme): number => a.name.localeCompare(b.name)
const ORDERED: Theme[] = [...THEMES.filter((t) => t.dark).sort(byName), ...THEMES.filter((t) => !t.dark).sort(byName)]

const swatches = (t: Theme): string[] => [t.term.red, t.term.green, t.term.yellow, t.term.blue, t.term.magenta, t.term.cyan]

function ThemeSwatch({ t }: { t: Theme }) {
  return (
    <span className="theme-swatch" style={{ background: t.ui.bg, borderColor: t.ui.borderStrong }} aria-hidden>
      <i style={{ background: t.ui.accent }} />
      {swatches(t).slice(1, 4).map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  )
}

// Dropdown proprio (o <select> nativo nao avisa hover nas opcoes): passar o mouse ou as setas
// pre-visualizam o tema no app inteiro; sair da lista, Esc ou fechar volta ao tema salvo.
export function ThemePicker({ value, onPick, labelId }: { value: string; onPick: (id: string) => Promise<void>; labelId: string }) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const uid = useId()
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const current = ORDERED.find((t) => t.id === value) ?? ORDERED[0]

  const close = (): void => {
    setOpen(false)
    previewTheme(undefined)
  }
  const show = (): void => {
    setHi(ORDERED.findIndex((t) => t.id === current.id))
    setOpen(true)
  }
  const pick = async (t: Theme): Promise<void> => {
    setOpen(false)
    try {
      await onPick(t.id) // so solta a previa depois que o tema salvo chegou: sem piscar o antigo
    } finally {
      previewTheme(undefined) // salvar falhou: volta ao tema salvo em vez de ficar preso na previa
    }
  }
  const move = (d: number): void => {
    const i = (Math.max(hi, 0) + d + ORDERED.length) % ORDERED.length
    setHi(i)
    previewTheme(ORDERED[i].id)
    document.getElementById(`${uid}-opt-${i}`)?.scrollIntoView({ block: 'nearest' })
  }

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', down, true)
    document.getElementById(`${uid}-opt-${hi}`)?.scrollIntoView({ block: 'nearest' })
    return () => window.removeEventListener('mousedown', down, true)
  }, [open])
  useEffect(() => () => previewTheme(undefined), []) // Settings fechado no meio da previa

  const onKey = (e: React.KeyboardEvent): void => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) (e.preventDefault(), show())
      return
    }
    if (e.key === 'ArrowDown') (e.preventDefault(), move(1))
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1))
    else if (e.key === 'Home') (e.preventDefault(), move(-Math.max(hi, 0)))
    else if (e.key === 'End') (e.preventDefault(), move(ORDERED.length - 1 - Math.max(hi, 0)))
    else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), hi >= 0 && void pick(ORDERED[hi]))
    else if (e.key === 'Escape' || e.key === 'Tab') close()
  }

  return (
    <div className="theme-picker" ref={root} data-esc-local={open || undefined} onKeyDown={onKey}>
      <button
        type="button"
        className="theme-trigger"
        role="combobox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${uid}-trigger`}
        id={`${uid}-trigger`}
        aria-controls={open ? `${uid}-list` : undefined}
        aria-activedescendant={open && hi >= 0 ? `${uid}-opt-${hi}` : undefined}
        onClick={() => (open ? close() : show())}
      >
        <ThemeSwatch t={current} />
        <span className="grow">{current.name}</span>
        <IconChevron size={14} className="theme-caret" aria-hidden />
      </button>
      {open && (
        <ul
          className="theme-menu"
          role="listbox"
          id={`${uid}-list`}
          ref={list}
          aria-labelledby={labelId}
          onMouseLeave={() => previewTheme(undefined)}
          onMouseDown={(e) => e.preventDefault()} // clique na lista (inclusive no padding) nao tira o foco do gatilho
        >
          {ORDERED.map((t, i) => [
            (i === 0 || ORDERED[i - 1].dark !== t.dark) && (
              <li key={t.dark ? 'g-dark' : 'g-light'} role="presentation" className="theme-group">{t.dark ? 'Dark' : 'Light'}</li>
            ),
            <li
              key={t.id}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={t.id === current.id}
              className={`${i === hi ? 'hi' : ''} ${t.id === current.id ? 'on' : ''}`}
              onMouseEnter={() => (setHi(i), previewTheme(t.id))}
              onClick={() => void pick(t)}
            >
              <ThemeSwatch t={t} />
              <span className="grow">{t.name}</span>
              <span className="theme-check" aria-hidden>{t.id === current.id && <IconCheck size={14} />}</span>
            </li>,
          ])}
        </ul>
      )}
    </div>
  )
}

const MONO_HINT = /mono|code|consol|courier|cascadia|menlo|hack|iosevka|fira|jetbrains|nerd|terminal|fixed/i

// Seletor de fonte com busca: digita e a lista filtra (sugeridas + instaladas no sistema, Windows ou Linux).
// Enter escolhe a destacada; sem nenhuma, usa o nome digitado como fonte propria ("Use ...").
function FontSelect({ value, options, onChange, system = [], fallback }: {
  value: string
  options: Array<{ v: string; l: string }>
  onChange: (v: string) => void
  system?: string[]
  fallback: string
}) {
  const uid = useId()
  const root = useRef<HTMLDivElement>(null)
  const suggestedNames = new Set(options.map((o) => /^"?([^",]+)/.exec(o.v)?.[1].toLowerCase()))
  const installed = system.filter((f) => !suggestedNames.has(f.toLowerCase())).map((f) => ({ v: `"${f}", ${fallback}`, l: f }))
  const all = [...options, ...installed]
  // nome mostrado: o rotulo da opcao, ou a 1a familia do valor salvo (fonte digitada antes)
  const label = all.find((o) => o.v === value)?.l ?? /^"?([^",]+)/.exec(value)?.[1] ?? value
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const sug = filterFonts(options, q)
  const ins = filterFonts(installed, q)
  const typed = q.trim()
  const custom = typed && !all.some((o) => o.l.toLowerCase() === typed.toLowerCase()) ? [{ v: `"${typed}", ${fallback}`, l: `Use "${typed}"` }] : []
  const items = [...sug, ...ins, ...custom]

  const close = (): void => (setOpen(false), setQ(''))
  const pick = (o: { v: string }): void => {
    close()
    if (o.v !== value) onChange(o.v)
  }
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => void (!root.current?.contains(e.target as Node) && close())
    window.addEventListener('mousedown', down, true)
    return () => window.removeEventListener('mousedown', down, true)
  }, [open])
  useEffect(() => document.getElementById(`${uid}-opt-${hi}`)?.scrollIntoView({ block: 'nearest' }), [hi, open])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') (e.preventDefault(), open ? setHi((hi + 1) % Math.max(items.length, 1)) : setOpen(true))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setHi((hi - 1 + items.length) % Math.max(items.length, 1)))
    else if (e.key === 'Enter') (e.preventDefault(), open && items[hi] && pick(items[hi]))
    else if (e.key === 'Escape' && open) (e.stopPropagation(), close())
    else if (e.key === 'Tab') close()
  }
  const row = (o: { v: string; l: string }, i: number): React.ReactElement => (
    <li
      key={o.v + i}
      id={`${uid}-opt-${i}`}
      role="option"
      aria-selected={o.v === value}
      className={`${i === hi ? 'hi' : ''} ${o.v === value ? 'on' : ''}`}
      onMouseEnter={() => setHi(i)}
      onClick={() => pick(o)}
    >
      <span className="grow font-opt" style={{ fontFamily: o.v }}>{o.l}</span>
      <span className="theme-check" aria-hidden>{o.v === value && <IconCheck size={14} />}</span>
    </li>
  )
  return (
    <div className="theme-picker font-picker" ref={root} data-esc-local={open || undefined}>
      <input
        className="theme-trigger font-trigger"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? `${uid}-list` : undefined}
        aria-activedescendant={open && items[hi] ? `${uid}-opt-${hi}` : undefined}
        value={open ? q : label}
        placeholder={label}
        style={{ fontFamily: open ? undefined : value }}
        onFocus={() => (setOpen(true), setQ(''), setHi(0))}
        onClick={() => !open && setOpen(true)}
        onChange={(e) => (setQ(e.target.value), setHi(0), setOpen(true))}
        onKeyDown={onKey}
      />
      {open && (
        <ul className="theme-menu" role="listbox" id={`${uid}-list`} onMouseDown={(e) => e.preventDefault()}>
          {sug.length > 0 && <li role="presentation" className="theme-group">Suggested</li>}
          {sug.map((o, i) => row(o, i))}
          {ins.length > 0 && <li role="presentation" className="theme-group">Installed</li>}
          {ins.map((o, i) => row(o, sug.length + i))}
          {custom.map((o, i) => row(o, sug.length + ins.length + i))}
          {!items.length && <li role="presentation" className="theme-group">Type a font name</li>}
        </ul>
      )}
    </div>
  )
}

export function SettingsPanel() {
  const s = useSettings()
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [fonts, setFonts] = useState<string[]>([])
  useEffect(() => void window.turno.settings.fonts().then(setFonts), [])
  const [saved, setSaved] = useState(false)
  const [ntfyErr, setNtfyErr] = useState(false)
  const [topicErr, setTopicErr] = useState(false)
  const latest = useRef(s) // settings mais recentes (a limpeza ao desmontar roda com closures antigas)
  latest.current = s
  const topicRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)
  // ultimo valor digitado (undefined = nao mexeu); no unmount as refs do DOM ja sao null
  const topicVal = useRef<string | undefined>(undefined)
  const serverVal = useRef<string | undefined>(undefined)
  const saveServer = async (raw: string): Promise<void> => {
    const v = raw.trim()
    serverVal.current = undefined
    if (!/^https?:\/\/[^\s/]+/i.test(v)) {
      setNtfyErr(true) // nao salva: notificacoes sumiriam caladas
      return void toast('ntfy server not saved: use a full address like https://ntfy.sh', 'warn')
    }
    if (v !== latest.current?.ntfyServer) await patch({ ntfyServer: v })
  }
  const dirVal = useRef<string | undefined>(undefined)
  const saveTopic = async (raw: string): Promise<void> => {
    const v = raw.trim()
    topicVal.current = undefined
    if (v && !/^[A-Za-z0-9_-]{1,64}$/.test(v)) {
      setTopicErr(true)
      return void toast('ntfy topic not saved: use only letters, numbers, - and _', 'warn') // aparece mesmo se o modal fechou
    }
    topicVal.current = undefined
    if (v !== latest.current?.ntfyTopic) await patch({ ntfyTopic: v })
  }
  // Esc / fechar o modal nao dispara o blur: o que estava digitado nesses campos e aplicado ao desmontar
  useEffect(
    () => () => {
      if (topicVal.current !== undefined) void fns.current.saveTopic(topicVal.current)
      if (serverVal.current !== undefined) void fns.current.saveServer(serverVal.current)
      if (dirVal.current !== undefined) void fns.current.changeRoutinesDir(dirVal.current)
    },
    [],
  )
  // pasta inexistente: o Turno criaria uma pasta vazia e todas as rotinas sumiriam da sidebar
  const changeRoutinesDir = async (raw: string): Promise<void> => {
    const v = raw.trim()
    dirVal.current = undefined // aplicado uma vez so (blur e fechamento do modal podem chegar juntos)
    const cur = latest.current
    if (!cur || v === cur.routinesDir) return
    if (!(await window.turno.ui.pathExists(v))) {
      if (await window.turno.ui.fileExists(v)) {
        if (dirRef.current) dirRef.current.value = cur.routinesDir
        return void toast(`"${v}" is a file, not a folder. Routines folder not changed.`, 'warn')
      }
      const ok = await askConfirm({ title: 'Folder not found', message: `"${v}" doesn't exist. Turno will create it empty and your current routines won't show. Use it anyway?`, confirmLabel: 'Use it' })
      if (!ok) return void (dirRef.current && (dirRef.current.value = cur.routinesDir), (dirVal.current = undefined))
    }
    dirVal.current = undefined
    void patch({ routinesDir: v })
  }
  useEffect(() => void window.turno.settings.shells().then(setShells), [])
  const [shellMissing, setShellMissing] = useState(false)
  const curShell = latest.current?.terminal.defaultShell ?? ''
  useEffect(() => {
    // so caminhos (com barra): nomes soltos como pwsh.exe vem do PATH
    if (!/[\\/]/.test(curShell)) return setShellMissing(false)
    void window.turno.ui.fileExists(curShell).then((ok) => setShellMissing(!ok))
  }, [curShell])
  const fns = useRef({ saveTopic, changeRoutinesDir, saveServer })
  fns.current = { saveTopic, changeRoutinesDir, saveServer }
  const page = useSettingsPage()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const [version, setVersion] = useState('')
  useEffect(() => void window.turno.ui.version().then(setVersion), [])
  const agents = useAgents()
  const [mcpMissing, setMcpMissing] = useState(false)
  useEffect(() => {
    const load = (): void => void window.turno.mcp.list().then((l) => setMcpMissing(l.some((m) => (m.secrets ?? []).some((n) => !m.secretSet?.[n]))))
    load()
    window.addEventListener('turno:mcp-changed', load)
    return () => window.removeEventListener('turno:mcp-changed', load)
  }, [])
  const attention = {
    agents: agents.accounts.some((a) => a.enabled && (agents.signedOut.includes(a.id) || agents.usage[a.id]?.state === 'blocked')),
    mcp: mcpMissing,
  }
  // troca de pagina aplica antes o que estava digitado e nao salvo (ntfy, pasta de rotinas)
  useEffect(() => {
    setSettingsFlush(() => {
      if (topicVal.current !== undefined) void fns.current.saveTopic(topicVal.current)
      if (serverVal.current !== undefined) void fns.current.saveServer(serverVal.current)
      if (dirVal.current !== undefined) void fns.current.changeRoutinesDir(dirVal.current)
    })
    return () => setSettingsFlush(undefined)
  }, [])
  // navegou (busca, links de outras telas, troca de pagina): rola para o card pedido e destaca;
  // pagina nova sem card pedido volta ao topo (busca na pagina atual tambem rola)
  const nav = useSettingsNav()
  const shownPage = useRef(page)
  useEffect(() => {
    const a = takeSettingsAnchor()
    const el = a ? document.getElementById(a) : null
    if (el) {
      el.scrollIntoView({ block: 'start' })
      el.classList.add('flash')
      setTimeout(() => el.classList.remove('flash'), 1200)
    } else if (shownPage.current !== page) pageRef.current?.scrollTo({ top: 0 })
    shownPage.current = page
  }, [page, nav])
  // Ctrl+F dentro do Settings vai para a busca
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f' && document.querySelector('.modal-settings')?.contains(document.activeElement)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  const goTo = (p: SettingsPage, a?: string): void => {
    setQuery('')
    goToSettings(p, a)
  }
  // setas sobem e descem nas categorias (lista vertical de abas), Home/End vao para as pontas
  const tabKeys = (e: React.KeyboardEvent): void => {
    const tabs = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const j = e.key === 'ArrowDown' ? (i + 1) % tabs.length : e.key === 'ArrowUp' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1
    if (j < 0) return
    e.preventDefault()
    // so clica: quem troca a pagina move o foco (se um "Discard changes?" cancelar, o foco fica na aba atual)
    tabs[j].click()
  }
  if (!s) return <div className="panel-empty">Loading…</div>

  const patch = async (p: Partial<Settings>): Promise<void> => {
    if (!(await updateSettings(p))) return
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }
  const term = (p: Partial<TerminalSettings>): Promise<void> => patch({ terminal: { ...s.terminal, ...p } })
  const t = s.terminal
  // "pwsh.exe" salvo so pelo nome = o PowerShell detectado (nao lista o mesmo shell duas vezes)
  const baseName = (p: string): string => p.split(/[\\/]/).pop()!.toLowerCase()
  const shellValue = shells.find((x) => x.path === t.defaultShell)?.path ?? shells.find((x) => baseName(x.path) === baseName(t.defaultShell))?.path ?? t.defaultShell

  const PAGE_VIEWS: Record<SettingsPage, () => React.ReactElement> = {
    general: () => (
      <>
        <section className="card" id="settings-startup">
          <h3>Startup</h3>
          <label className="field toggle-field">
            <span>Start with Windows (stays in the tray, no window)</span>
            <Switch checked={s.openAtLogin} onChange={(v) => void patch({ openAtLogin: v })} />
          </label>
        </section>
        <section className="card" id="settings-background">
          <h3>Background</h3>
          <div className="field">
            <span id="awake-label">Keep the computer awake</span>
            <div className="seg" role="group" aria-labelledby="awake-label">
              {AWAKE.map((m) => (
                <button key={m.v} className={s.keepAwake === m.v ? 'on' : ''} aria-pressed={s.keepAwake === m.v} title={m.d} onClick={() => void patch({ keepAwake: m.v })}>
                  {m.t}
                </button>
              ))}
            </div>
            <small className="muted">{AWAKE.find((m) => m.v === s.keepAwake)?.d}. Closing the laptop lid follows the Windows power settings.</small>
          </div>
        </section>
      </>
    ),
    appearance: () => (
      <>
        <section className="card" id="settings-theme">
          <h3>Theme</h3>
          <div className="field">
            <span id="theme-label">Color theme</span>
            <ThemePicker labelId="theme-label" value={s.theme} onPick={(id) => patch({ theme: id as Settings['theme'] })} />
          </div>
        </section>
        <section className="card" id="settings-interface">
          <h3>Interface</h3>
          <label className="field">
            <span>Interface font</span>
            <FontSelect value={s.uiFontFamily} options={UI_FONTS} system={fonts} fallback="system-ui, sans-serif" onChange={(v) => void patch({ uiFontFamily: v })} />
          </label>
          <label className="field">
            <span>Interface size: {s.uiFontSize}px</span>
            <input type="range" min={11} max={16} step={0.5} value={s.uiFontSize} onChange={(e) => void patch({ uiFontSize: Number(e.target.value) })} />
          </label>
        </section>
        <section className="card" id="settings-window">
          <h3>Window</h3>
          <div className="field">
            <span id="opacity-label">Window opacity</span>
            {/* passo fino (0,1%): barra para ajustar no olho, campo para digitar o valor exato com casas decimais */}
            <div className="opacity-row">
              <input type="range" aria-labelledby="opacity-label" min={0.3} max={1} step={0.001} value={t.windowOpacity} onChange={(e) => void term({ windowOpacity: Number(e.target.value) })} />
              <span className="opacity-num">
                <NumInput aria-label="Window opacity (%)" min={30} max={100} step={0.1} value={Math.round(t.windowOpacity * 1000) / 10} onChange={(v) => void term({ windowOpacity: Math.round(v * 10) / 1000 })} />
                <span className="muted">%</span>
              </span>
            </div>
            <small className="muted">Main window only; dialogs stay opaque. You'll see it after closing Settings.</small>
          </div>
        </section>
      </>
    ),
    terminal: () => (
      <>
        <section className="card" id="settings-terminal-font">
          <h3>Font and cursor</h3>
          <label className="field">
            <span>Font</span>
            <FontSelect value={t.fontFamily} options={MONO_FONTS} system={fonts.filter((f) => MONO_HINT.test(f))} fallback="Consolas, monospace" onChange={(v) => void term({ fontFamily: v })} />
          </label>
          <div className="grid3">
            <label className="field">
              <span>Size</span>
              <NumInput integer min={8} max={28} value={t.fontSize} onChange={(v) => void term({ fontSize: v })} />
            </label>
            <label className="field">
              <span>Line height</span>
              <NumInput min={1} max={2} step={0.05} value={t.lineHeight} onChange={(v) => void term({ lineHeight: v })} />
            </label>
            <label className="field">
              <span>Letter spacing</span>
              <NumInput min={-2} max={4} step={0.5} value={t.letterSpacing} onChange={(v) => void term({ letterSpacing: v })} />
            </label>
          </div>
          <div className="field">
            <span>Weight</span>
            <div className="seg small">
              {(['normal', '500', '600'] as const).map((w) => (
                <button key={w} className={t.fontWeight === w ? 'on' : ''} aria-pressed={t.fontWeight === w} onClick={() => void term({ fontWeight: w })}>
                  {w === 'normal' ? 'normal' : w}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Cursor</span>
            <div className="row">
              <div className="seg small">
                {CURSORS.map((c) => (
                  <button key={c.v} className={t.cursorStyle === c.v ? 'on' : ''} aria-pressed={t.cursorStyle === c.v} onClick={() => void term({ cursorStyle: c.v })}>
                    {c.l}
                  </button>
                ))}
              </div>
              <label className="row small muted">
                <Switch checked={t.cursorBlink} onChange={(v) => void term({ cursorBlink: v })} /> blink
              </label>
            </div>
          </div>
          <div className="grid3">
            <label className="field">
              <span>Padding</span>
              <NumInput integer min={0} max={40} value={t.padding} onChange={(v) => void term({ padding: v })} />
            </label>
            <label className="field">
              <span>Cursor width</span>
              <NumInput integer min={1} max={5} value={t.cursorWidth} onChange={(v) => void term({ cursorWidth: v })} />
            </label>
            <label className="field">
              <span>Min. contrast</span>
              <NumInput min={1} max={21} step={0.5} value={t.minimumContrastRatio} onChange={(v) => void term({ minimumContrastRatio: v })} />
            </label>
          </div>
          <label className="field toggle-field">
            <span>Bold text uses bright colors</span>
            <Switch checked={t.drawBoldInBright} onChange={(v) => void term({ drawBoldInBright: v })} />
          </label>
          <div className="term-sample" style={{ fontFamily: t.fontFamily, fontSize: t.fontSize, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing, fontWeight: t.fontWeight as never }}>
            PS C:\routines&gt; claude -p "summarize the day" <span className="cursor-demo" data-style={t.cursorStyle} />
          </div>
        </section>
        <section className="card" id="settings-terminal-behavior">
          <h3>Behavior</h3>
          <label className="field">
            <span>Default shell</span>
            <select value={shellValue} onChange={(e) => void term({ defaultShell: e.target.value })}>
              {!shells.some((x) => x.path === shellValue) && <option value={t.defaultShell}>{t.defaultShell}</option>}
              {shells.map((sh) => (
                <option key={sh.id} value={sh.path}>{sh.name}</option>
              ))}
            </select>
            {shellMissing && <small className="tone-warn">This shell wasn't found; new terminals can't start. Pick another.</small>}
          </label>
          <label className="field">
            <span>Scrollback (lines)</span>
            <NumInput integer min={1000} max={100000} step={1000} value={t.scrollback} onChange={(v) => void term({ scrollback: v })} />
          </label>
          <label className="field toggle-field">
            <span>Copy on select</span>
            <Switch checked={t.copyOnSelect} onChange={(v) => void term({ copyOnSelect: v })} />
          </label>
          <label className="field toggle-field">
            <span>Right-click copies/pastes</span>
            <Switch checked={t.rightClickPaste} onChange={(v) => void term({ rightClickPaste: v })} />
          </label>
          <label className="field toggle-field">
            <span>Font ligatures (=&gt;, !=) — applies to new terminals</span>
            <Switch checked={t.ligatures} onChange={(v) => void term({ ligatures: v })} />
          </label>
          <small className="muted">Ctrl+Shift+C / Ctrl+Shift+V always copy and paste.</small>
        </section>
      </>
    ),
    notifications: () => (
      <>
        <section className="card" id="settings-windows-notifications">
          <h3>Windows notifications</h3>
          <p className="muted small">Turno shows a Windows notification when a routine fails, a run needs your permission and an agent finishes its turn or needs you. Each routine chooses when it notifies in its editor (Notify).</p>
        </section>
        <section className="card" id="settings-ntfy">
          <h3>Phone notifications (ntfy)</h3>
          <p className="muted small">
            Install the ntfy app on your phone and subscribe to a topic with a long, hard-to-guess name. Without a topic, only Windows notifications are shown.
          </p>
          <div className="grid2">
            <label className="field">
              <span>Server</span>
              <input
                defaultValue={s.ntfyServer}
                aria-invalid={ntfyErr ? true : undefined}
                aria-describedby={ntfyErr ? 'ntfy-err' : undefined}
                onChange={(e) => (setNtfyErr(false), (serverVal.current = e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && void saveServer(e.currentTarget.value)}
                onBlur={(e) => void saveServer(e.target.value)}
              />
              {ntfyErr && <small id="ntfy-err" className="tone-err">Use a full address like https://ntfy.sh (not saved).</small>}
            </label>
            <label className="field">
              <span>Topic</span>
              <input
                ref={topicRef}
                className="mono"
                defaultValue={s.ntfyTopic}
                placeholder="turno-8f3k2x9q…"
                aria-invalid={topicErr ? true : undefined}
                aria-describedby={topicErr ? 'ntfy-topic-err' : undefined}
                onChange={(e) => (setTopicErr(false), (topicVal.current = e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && void saveTopic(e.currentTarget.value)}
                onBlur={(e) => void saveTopic(e.target.value)}
              />
              {topicErr && <small id="ntfy-topic-err" className="tone-err">Topics use only letters, numbers, - and _ (not saved).</small>}
            </label>
          </div>
          <div>
            <button className="btn" onClick={() => void window.turno.settings.testNotify()}>Send test notification</button>
          </div>
        </section>
      </>
    ),
    shortcuts: () => (
      <section className="card" id="settings-shortcuts">
        <h3>Keyboard shortcuts</h3>
        {(['Workspace', 'Panels', 'Terminal'] as const).map((g) => (
          <div key={g} className="shortcut-group">
            <div className="nav-label">{g}</div>
            <dl className="shortcut-table">
              {SHORTCUTS.filter((x) => x.group === g).map((x) => (
                <div key={x.keys} className="shortcut-row">
                  <dt><kbd>{x.keys}</kbd></dt>
                  <dd>{x.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </section>
    ),
    agents: () => (
      <>
        <StartFolderCard />
        <AgentsSection />
      </>
    ),
    connections: () => <ConnectionsSection />,
    mcp: () => <McpSection />,
    integrations: () => <IntegrationsSection />,
    routines: () => (
      <section className="card" id="settings-routines-folder">
        <h3>Routines folder</h3>
        <label className="field">
          <span>Folder (one subfolder with ROUTINE.md per routine)</span>
          <div className="row">
            <input className="mono grow" title={s.routinesDir} defaultValue={s.routinesDir} ref={dirRef} onChange={(e) => (dirVal.current = e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void changeRoutinesDir(e.currentTarget.value)} onBlur={(e) => void changeRoutinesDir(e.currentTarget.value)} />
            <button className="btn" onClick={() => void window.turno.routines.openFolder()}>Open</button>
          </div>
        </label>
        <p className="muted small">Each routine's schedule, model, permissions, MCP servers and limits are set in its own editor (Configure in the sidebar).</p>
      </section>
    ),
    about: () => (
      <section className="card" id="settings-about">
        <h3 className="keep">Turno {version}</h3>
        <p className="muted small">Agents, terminals and routines on your PC. MIT license. Built on open-source work — see CREDITS.md.</p>
        <div className="row wrap">
          <button className="btn" onClick={() => void openWhatsNew(true)}>What's new</button>
          <button className="btn ghost" onClick={() => openOnboarding()}>Show the setup tour</button>
          <button className="btn ghost" onClick={() => void window.turno.ui.openExternal('https://github.com/eurafaeldecarvalho/turno').catch(() => {})}>Project page</button>
        </div>
      </section>
    ),
  }
  const results = query.trim() ? searchSettings(query) : []

  return (
    <div className="editor settings-editor">
      <header className="editor-head">
        <div className="editor-title">
          <h2>Settings</h2>
          <div className="editor-sub muted">{saved ? 'Saved.' : 'Changes apply immediately.'}</div>
        </div>
      </header>
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings categories">
          <input
            ref={searchRef}
            type="search"
            className="settings-search"
            placeholder="Search settings"
            aria-label="Search settings"
            data-esc-local={query ? true : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) (e.stopPropagation(), setQuery(''))
              if (e.key === 'Enter' && results[0]) goTo(results[0].page, results[0].anchor)
              if (e.key === 'ArrowDown') (e.preventDefault(), document.querySelector<HTMLElement>('.settings-nav [role="tab"], .settings-nav .settings-result')?.focus())
            }}
          />
          {query.trim() ? (
            <div className="settings-results" role="group" aria-label="Search results">
              {results.map((r) => (
                <button key={`${r.page}:${r.label}`} className="settings-result" onClick={() => goTo(r.page, r.anchor)}>
                  <span>{r.label}</span>
                  <small className="muted">{PAGES.find((p) => p.id === r.page)?.label}{r.card ? ` › ${r.card}` : ''}</small>
                </button>
              ))}
              {!results.length && <p className="muted small settings-noresult">No setting matches "{query.trim()}".</p>}
            </div>
          ) : (
            <div role="tablist" aria-orientation="vertical" aria-label="Settings categories" onKeyDown={tabKeys}>
              {GROUPS.map((g) => (
                <div key={g} className="settings-group">
                  {g !== 'About' && <div className="nav-label">{g}</div>}
                  {PAGES.filter((p) => p.group === g).map((p) => (
                    <button
                      key={p.id}
                      role="tab"
                      id={`settings-tab-${p.id}`}
                      aria-selected={page === p.id}
                      aria-controls="settings-page"
                      tabIndex={page === p.id ? 0 : -1}
                      className={`settings-tab ${page === p.id ? 'on' : ''}`}
                      onClick={() => goTo(p.id)}
                    >
                      <span>{p.label}</span>
                      {p.id === 'agents' && attention.agents && <span className="dot dot-warn" title="An account needs attention" />}
                      {p.id === 'mcp' && attention.mcp && <span className="dot dot-warn" title="An MCP server is missing a secret" />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </nav>
        <div className="settings-page" id="settings-page" role="tabpanel" aria-labelledby={`settings-tab-${page}`} ref={pageRef}>
          <div className="settings-page-head">
            <h2>{PAGES.find((p) => p.id === page)?.label}</h2>
            <p className="muted small">{PAGES.find((p) => p.id === page)?.description}</p>
          </div>
          {PAGE_VIEWS[page]()}
        </div>
      </div>
    </div>
  )
}
