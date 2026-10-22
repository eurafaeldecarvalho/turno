import { useEffect, useId, useRef, useState } from 'react'
import { AgentsSection } from './AgentsSection'
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

function FontSelect({ value, options, onChange, system = [], fallback }: {
  value: string
  options: Array<{ v: string; l: string }>
  onChange: (v: string) => void
  system?: string[]
  fallback: string
}) {
  const suggested = new Set(options.map((o) => /^"?([^",]+)/.exec(o.v)?.[1].toLowerCase()))
  const sysOpts = system.filter((f) => !suggested.has(f.toLowerCase())).map((f) => ({ v: `"${f}", ${fallback}`, l: f }))
  const known = options.some((o) => o.v === value) || sysOpts.some((o) => o.v === value)
  const [custom, setCustom] = useState(!known)
  return (
    <div className="row">
      <select
        value={custom ? '__custom' : value}
        onChange={(e) => {
          if (e.target.value === '__custom') return setCustom(true)
          setCustom(false)
          onChange(e.target.value)
        }}
      >
        <optgroup label="Suggested">
          {options.map((o) => (
            <option key={o.v} value={o.v}>{o.l}</option>
          ))}
        </optgroup>
        {sysOpts.length > 0 && (
          <optgroup label="Installed on Windows">
            {sysOpts.map((o) => (
              <option key={o.v} value={o.v}>{o.l}</option>
            ))}
          </optgroup>
        )}
        <option value="__custom">Other…</option>
      </select>
      {custom && <input className="mono" defaultValue={value} placeholder='"My Font", monospace' onBlur={(e) => e.target.value && onChange(e.target.value)} />}
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

  return (
    <div className="editor">
      <header className="editor-head">
        <div className="editor-title">
          <h2>Settings</h2>
          <div className="editor-sub muted">{saved ? 'Saved.' : 'Changes apply immediately.'}</div>
        </div>
      </header>
      <div className="editor-body settings-body">
        <div className="settings-col">
        <section className="card">
          <h3>Appearance</h3>
          <div className="field">
            <span id="theme-label">Color theme</span>
            <ThemePicker labelId="theme-label" value={s.theme} onPick={(id) => patch({ theme: id as Settings['theme'] })} />
          </div>
          <label className="field">
            <span>Interface font</span>
            <FontSelect value={s.uiFontFamily} options={UI_FONTS} system={fonts} fallback="system-ui, sans-serif" onChange={(v) => void patch({ uiFontFamily: v })} />
          </label>
          <label className="field">
            <span>Interface size: {s.uiFontSize}px</span>
            <input type="range" min={11} max={16} step={0.5} value={s.uiFontSize} onChange={(e) => void patch({ uiFontSize: Number(e.target.value) })} />
          </label>
        </section>

        <ConnectionsSection />
        <AgentsSection />
        <McpSection />

        <section className="card">
          <h3>General</h3>
          <div className="row">
            <button className="btn" onClick={() => openOnboarding()}>Show the setup tour</button>
            <button className="btn ghost" onClick={() => void openWhatsNew(true)}>What's new</button>
          </div>
          <label className="field toggle-field">
            <span>Start with Windows (stays in the tray, no window)</span>
            <Switch checked={s.openAtLogin} onChange={(v) => void patch({ openAtLogin: v })} />
          </label>
          <label className="field">
            <span>Routines folder (one subfolder with ROUTINE.md per routine)</span>
            <div className="row">
              <input className="mono grow" title={s.routinesDir} defaultValue={s.routinesDir} ref={dirRef} onChange={(e) => (dirVal.current = e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void changeRoutinesDir(e.currentTarget.value)} onBlur={(e) => void changeRoutinesDir(e.currentTarget.value)} />
              <button className="btn" onClick={() => void window.turno.routines.openFolder()}>Open</button>
            </div>
          </label>
        </section>

        <section className="card">
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
        </div>

        <div className="settings-col">
        <section className="card">
          <h3>Terminal: font and cursor</h3>
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

        <section className="card">
          <h3>Terminal: behavior</h3>
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
          <small className="muted">Ctrl+Shift+C / Ctrl+Shift+V always copy and paste.</small>
        </section>

        </div>
      </div>
    </div>
  )
}
