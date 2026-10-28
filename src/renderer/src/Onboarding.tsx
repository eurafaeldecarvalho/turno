import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AwakeMode, DetectedAgent, Settings, ShellInfo } from '../../shared/types'
import { useModalLayer } from './modalStack'
import { updateSettings, useSettings } from './appearance'
import { askConfirm } from './ConfirmDialog'
import { ThemePicker } from './panels/SettingsPanel'
import { Switch } from './panels/RoutineEditor'
import { useStore } from './store'
import { openHistory, openRoutine, openTerminal } from './layout'
import { IconCheck, IconClose, IconFolder } from './icons'
import { AWAKE_MODES } from './awake'
import { toast } from './Toast'
import { unseenNotes, type ReleaseNotes } from './whatsNew'
import { useAgents } from './agentStore'

// ---------- abrir/fechar (introducao e novidades sao modais do mesmo modulo) ----------
type View = { kind: 'tour' } | { kind: 'news'; notes: ReleaseNotes[]; version: string; all?: boolean } | null
let view: View = null
const subs = new Set<() => void>()
const emit = (): void => subs.forEach((f) => f())
const useView = (): View => useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => view)

export const openOnboarding = (): void => void ((view = { kind: 'tour' }), emit())
export async function openWhatsNew(all = false): Promise<void> {
  const version = await window.turno.ui.version()
  const s = useSettingsSnapshot()
  const notes = all ? unseenNotes('0.0.0', version) : unseenNotes(s?.seenVersion ?? '', version)
  if (!notes.length) return void (all && toast('No release notes for this version.', 'info'))
  view = { kind: 'news', notes, version, all }
  emit()
}
let lastSettings: Settings | undefined
const useSettingsSnapshot = (): Settings | undefined => lastSettings

// Na abertura do app: instalacao nova -> introducao; atualizacao -> novidades (uma vez por versao).
export async function maybeShowIntro(s: Settings): Promise<void> {
  lastSettings = s
  if (!s.onboardedAt) return openOnboarding()
  const version = await window.turno.ui.version()
  if (s.seenVersion === version) return
  if (unseenNotes(s.seenVersion, version).length) return openWhatsNew()
  void updateSettings({ seenVersion: version }) // nada a mostrar: marca como vista
}

function close(): void {
  view = null
  emit()
}

// ---------- passos ----------
const STEPS = [
  { id: 'agents', title: 'Your agents', subtitle: 'Turno opens coding agents in terminals and runs routines with Claude Code or a local model. Here is what it found on this PC.' },
  { id: 'look', title: 'Look and terminal', subtitle: 'Pick the theme and size you want to stare at for hours, and how the terminal behaves.' },
  { id: 'routines', title: 'Routines', subtitle: 'A routine is a folder with a ROUTINE.md: a prompt plus a schedule. Choose where they live.' },
  { id: 'background', title: 'Run in the background', subtitle: 'Scheduled routines only run while Turno is open and the PC is awake.' },
  { id: 'notifications', title: 'Notifications', subtitle: 'Turno tells you when a routine fails or needs your answer, and when one finishes if you ask it to.' },
] as const
type StepId = (typeof STEPS)[number]['id'] | 'done'

export function OnboardingHost() {
  const v = useView()
  const s = useSettings()
  if (s) lastSettings = s
  const box = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  const [firstRoutine, setFirstRoutine] = useState(false)
  useEffect(() => void (v?.kind === 'tour' && setStep(0)), [v?.kind])

  const finishTour = async (): Promise<void> => {
    const version = await window.turno.ui.version()
    await updateSettings({ onboardedAt: new Date().toISOString(), seenVersion: version })
    close()
  }
  const skip = async (): Promise<void> => {
    if (v?.kind !== 'tour') return close()
    // ultimo passo (ja terminou) ou tour reaberto pelo Settings: fecha direto, sem "Skip the setup?"
    if (step >= STEPS.length) return finishTour()
    if (s?.onboardedAt) return close()
    const ok = await askConfirm({ title: 'Skip the setup?', message: 'Everything here is also in Settings, and you can reopen this tour from there.', confirmLabel: 'Skip' })
    if (ok) await finishTour()
  }
  const closeNews = async (): Promise<void> => {
    if (v?.kind === 'news') await updateSettings({ seenVersion: v.version })
    close()
  }
  const z = useModalLayer(!!v, () => void (v?.kind === 'news' ? closeNews() : skip()), box)
  if (!v || !s) return null

  if (v.kind === 'news')
    return (
      <div className="modal-backdrop" style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), void closeNews())}>
        <div ref={box} tabIndex={-1} className="modal onb news" role="dialog" aria-modal="true" aria-labelledby="news-title">
          <button className="modal-x" aria-label="Close" onClick={() => void closeNews()}><IconClose size={14} /></button>
          <header className="onb-head">
            <img src="./icon.png" alt="" width={36} height={36} />
            <div>
              <h2 id="news-title">What's new in Turno {v.version}</h2>
              <p className="muted">{v.all ? 'Release notes of the recent versions.' : 'Changes since you last opened it.'}</p>
            </div>
          </header>
          <div className="onb-body">
            {v.notes.map((r) => (
              <section key={r.version} className="news-version">
                {v.notes.length > 1 && <h3>{r.version}</h3>}
                <ul className="news-list">
                  {r.items.map((it) => (
                    <li key={it.title}>
                      <span className="news-dot" aria-hidden />
                      <div>
                        <strong>{it.title}</strong>
                        <p className="muted">{it.text}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <footer className="onb-foot">
            <span />
            <button className="btn primary" autoFocus onClick={() => void closeNews()}>Got it</button>
          </footer>
        </div>
      </div>
    )

  const id: StepId = step < STEPS.length ? STEPS[step].id : 'done'
  const meta = step < STEPS.length ? STEPS[step] : { title: "You're all set", subtitle: 'A few shortcuts to get going. Everything you chose is in Settings.' }
  const next = async (): Promise<void> => {
    if (step < STEPS.length) return setStep(step + 1)
    await finishTour()
    if (firstRoutine) openRoutine(null, 'New routine')
  }
  return (
    <div className="modal-backdrop" style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), void skip())}>
      <div
        ref={box}
        tabIndex={-1}
        className="modal onb"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onb-title"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.preventDefault(), void next())
        }}
      >
        <button className="modal-x" aria-label="Skip setup" onClick={() => void skip()}><IconClose size={14} /></button>
        <header className="onb-head">
          <img src="./icon.png" alt="" width={36} height={36} />
          <div>
            <h2 id="onb-title">{meta.title}</h2>
            <p className="muted">{meta.subtitle}</p>
          </div>
        </header>
        <ol className="onb-steps" aria-label="Setup steps">
          {STEPS.map((st, i) => (
            <li key={st.id} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <button onClick={() => setStep(i)} title={st.title}>
                <span className="onb-num">{i < step ? <IconCheck size={11} /> : i + 1}</span>
                <span className="onb-label">{st.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="onb-body" key={id}>
          {id === 'agents' && <AgentsStep s={s} />}
          {id === 'look' && <LookStep s={s} />}
          {id === 'routines' && <RoutinesStep s={s} first={firstRoutine} setFirst={setFirstRoutine} />}
          {id === 'background' && <BackgroundStep s={s} />}
          {id === 'notifications' && <NotificationsStep s={s} />}
          {id === 'done' && <DoneStep onAction={() => void finishTour()} />}
        </div>
        <footer className="onb-foot">
          {id === 'done' ? <span /> : <button className="btn ghost" onClick={() => void skip()}>Skip setup</button>}
          <span className="row">
            {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
            <button className="btn primary" onClick={() => void next()} title="Ctrl+Enter">
              {id === 'done' ? (firstRoutine ? 'Finish and create a routine' : 'Start using Turno') : 'Continue'}
            </button>
          </span>
        </footer>
      </div>
    </div>
  )
}

// ---------- 1. agentes ----------
function AgentsStep({ s }: { s: Settings }) {
  const agentsSt = useAgents()
  const [agents, setAgents] = useState<DetectedAgent[]>()
  const [claude, setClaude] = useState<'checking' | 'in' | 'out' | 'busy'>('checking')
  const [models, setModels] = useState<string[]>()
  const local = s.connections.find((c) => c.kind === 'endpoint' && /localhost:11434|127\.0\.0\.1:11434/.test(c.baseUrl ?? ''))
  useEffect(() => {
    void window.turno.ui.detectAgents().then((a) => {
      setAgents(a)
      if (a.find((x) => x.id === 'claude')?.path) void window.turno.provider.claudeStatus().then((ok) => setClaude(ok ? 'in' : 'out'))
      if (a.find((x) => x.id === 'ollama')?.path) void window.turno.ui.ollamaModels(local?.baseUrl).then(setModels)
    })
  }, [])
  const [installing, setInstalling] = useState(false)
  const installClaudeHere = async (): Promise<void> => {
    setInstalling(true)
    const r = await window.turno.ui.installClaude().catch((e) => ({ ok: false, log: String((e as Error).message) }))
    const found = await window.turno.ui.detectAgents()
    setAgents(found)
    setInstalling(false)
    if (r.ok && found.find((x) => x.id === 'claude')?.path) {
      toast('Claude Code installed. Sign in to start using it.', 'ok')
      setClaude('checking')
      void window.turno.provider.claudeStatus().then((ok) => setClaude(ok ? 'in' : 'out'))
    } else toast(`Claude Code didn't install.${r.log ? ` ${r.log.split('\n').slice(-2).join(' ')}` : ''} Try Settings › Accounts › Install, which runs it in a terminal.`, 'warn', { sticky: true })
  }
  const signIn = async (): Promise<void> => {
    setClaude('busy')
    const ok = await window.turno.provider.claudeLogin().catch(() => false)
    setClaude(ok ? 'in' : 'out')
  }
  const setLocalModel = (model: string): void =>
    void updateSettings({ connections: s.connections.map((c) => (c.id === local?.id ? { ...c, model } : c)) })
  if (!agents) return <p className="muted">Looking for agents on this PC…</p>
  const found = agents.filter((a) => a.path)
  const missing = agents.filter((a) => !a.path)
  return (
    <>
      <ul className="onb-agents">
        {[...found, ...missing].map((a) => (
          <li key={a.id} className={a.path ? 'found' : ''}>
            <span className={`dot dot-${a.path ? 'ok' : 'idle'}`} />
            <span className="onb-agent-name">
              <strong>{a.name}</strong>
              <small className={`muted${a.path ? ' mono' : ''}`} title={a.path}>{a.path ?? 'Not installed'}</small>
            </span>
            {a.id === 'claude' && a.path ? (
              claude === 'in' ? (
                // nenhuma conta entra sozinha: o login deste PC vira conta quando a pessoa pede
                agentsSt.accounts.some((x) => x.id === 'default-claude') ? (
                  <span className="tone-ok small">Signed in · in Turno</span>
                ) : (
                  <button className="btn small" onClick={() => void window.turno.agents.addDefault('claude').then(() => toast('Claude added to your accounts.', 'ok'), (e) => toast(String((e as Error).message), 'err'))}>
                    Add to Turno
                  </button>
                )
              )
              : claude === 'out' ? <button className="btn small" onClick={() => void signIn()}>Sign in</button>
              : <span className="muted small">{claude === 'busy' ? 'Finish signing in in your browser…' : 'Checking…'}</span>
            ) : a.id === 'ollama' && a.path ? (
              local && models?.length ? (
                <select aria-label="Model for the local connection" value={models.includes(local.model ?? '') ? local.model : ''} onChange={(e) => setLocalModel(e.target.value)}>
                  {!models.includes(local.model ?? '') && <option value="">{local.model ? `${local.model} (not installed)` : 'Pick a model'}</option>}
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : <span className="muted small">{models && !models.length ? 'Ollama is not running or has no models' : local ? 'Reading models…' : 'Add it in Settings › Accounts'}</span>
            ) : !a.path && a.id === 'claude' ? (
              // Claude Code e o que o Turno usa: instala aqui mesmo, com o instalador oficial (sem Node)
              installing ? (
                <span className="muted small">Installing Claude Code… (about a minute)</span>
              ) : (
                <button className="btn small primary" onClick={() => void installClaudeHere()}>Install Claude Code</button>
              )
            ) : !a.path ? (
              <button className="btn ghost small" onClick={() => void window.turno.ui.openExternal(a.url)}>How to install</button>
            ) : (
              <span className="tone-ok small">Ready</span>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">{found.length ? 'Open any of them from the sidebar or a terminal. You can add more later; Turno finds them on your PATH.' : 'No agents found. Install Claude Code to run routines, or Ollama to use local models.'}</p>
    </>
  )
}

// ---------- 2. aparencia + terminal ----------
function LookStep({ s }: { s: Settings }) {
  const [shells, setShells] = useState<ShellInfo[]>([])
  useEffect(() => void window.turno.settings.shells().then(setShells), [])
  const t = s.terminal
  const term = (p: Partial<Settings['terminal']>): void => void updateSettings({ terminal: { ...t, ...p } })
  const base = (p: string): string => p.split(/[\\/]/).pop()!.toLowerCase()
  const shellValue = shells.find((x) => x.path === t.defaultShell)?.path ?? shells.find((x) => base(x.path) === base(t.defaultShell))?.path ?? t.defaultShell
  return (
    <div className="onb-grid">
      <div className="field">
        <span id="onb-theme">Color theme</span>
        <ThemePicker labelId="onb-theme" value={s.theme} onPick={(id) => updateSettings({ theme: id }).then(() => {})} />
      </div>
      <label className="field">
        <span>Interface size: {s.uiFontSize}px</span>
        <input type="range" min={11} max={16} step={0.5} value={s.uiFontSize} onChange={(e) => void updateSettings({ uiFontSize: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Default shell for new terminals</span>
        <select value={shellValue} onChange={(e) => term({ defaultShell: e.target.value })}>
          {!shells.some((x) => x.path === shellValue) && <option value={t.defaultShell}>{t.defaultShell}</option>}
          {shells.map((sh) => <option key={sh.id} value={sh.path}>{sh.name}</option>)}
        </select>
      </label>
      <label className="field toggle-field">
        <span>Right-click pastes (or copies the selection)</span>
        <Switch checked={t.rightClickPaste} onChange={(v) => term({ rightClickPaste: v })} />
      </label>
      <label className="field toggle-field">
        <span>Copy text when you select it</span>
        <Switch checked={t.copyOnSelect} onChange={(v) => term({ copyOnSelect: v })} />
      </label>
    </div>
  )
}

// ---------- 3. rotinas ----------
function RoutinesStep({ s, first, setFirst }: { s: Settings; first: boolean; setFirst: (v: boolean) => void }) {
  const count = useStore((x) => x.routines.length)
  const [dir, setDir] = useState(s.routinesDir)
  const [missing, setMissing] = useState(false)
  useEffect(() => void window.turno.ui.pathExists(s.routinesDir).then((ok) => setMissing(!ok)), [s.routinesDir])
  const apply = async (raw: string): Promise<void> => {
    const v = raw.trim()
    if (!v || v === s.routinesDir) return setDir(s.routinesDir)
    if (await window.turno.ui.fileExists(v)) return void (toast(`"${v}" is a file, not a folder.`, 'warn'), setDir(s.routinesDir))
    await updateSettings({ routinesDir: v })
  }
  return (
    <>
      <label className="field">
        <span>Routines folder</span>
        <div className="row">
          <input className="mono grow" value={dir} onChange={(e) => setDir(e.target.value)} onBlur={(e) => void apply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void apply(e.currentTarget.value)} />
          <button className="btn" aria-label="Choose folder" title="Choose folder" onClick={async () => { const d = await window.turno.ui.pickFolder(); if (d) (setDir(d), void apply(d)) }}>
            <IconFolder />
          </button>
        </div>
        <small className="muted">
          {missing ? "This folder doesn't exist yet; Turno creates it when you save a routine." : count ? `${count} ${count === 1 ? 'routine' : 'routines'} found here.` : 'No routines here yet.'}
        </small>
      </label>
      <label className="field toggle-field">
        <span>Create my first routine when I finish</span>
        <Switch checked={first} onChange={setFirst} />
      </label>
      <p className="muted small">Routines run on the days and times you set, with Claude Code or a local model, and every run is kept in Runs with its full conversation.</p>
    </>
  )
}

// ---------- 4. segundo plano ----------
const AWAKE = AWAKE_MODES
function BackgroundStep({ s }: { s: Settings }) {
  return (
    <>
      <label className="field toggle-field">
        <span>Start Turno with Windows (in the tray, without a window)</span>
        <Switch checked={s.openAtLogin} onChange={(v) => void updateSettings({ openAtLogin: v })} />
      </label>
      <div className="field" role="radiogroup" aria-labelledby="onb-awake">
        <span id="onb-awake">Keep the computer awake</span>
        <div className="onb-choices">
          {AWAKE.map((m) => (
            <button
              key={m.v}
              role="radio"
              aria-checked={s.keepAwake === m.v}
              // grupo de radio: uma parada de Tab (a marcada) e setas trocam a opcao
              tabIndex={s.keepAwake === m.v ? 0 : -1}
              className={`onb-choice ${s.keepAwake === m.v ? 'on' : ''}`}
              onClick={() => void updateSettings({ keepAwake: m.v })}
              onKeyDown={(e) => {
                const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
                if (!d) return
                e.preventDefault()
                const i = AWAKE.findIndex((x) => x.v === m.v)
                const next = AWAKE[(i + d + AWAKE.length) % AWAKE.length]
                void updateSettings({ keepAwake: next.v })
                const btns = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')
                btns?.[(i + d + AWAKE.length) % AWAKE.length]?.focus()
              }}
            >
              <strong>{m.t}</strong>
              <small className="muted">{m.d}</small>
            </button>
          ))}
        </div>
      </div>
      <p className="muted small">Closing the window keeps Turno in the tray, so routines keep running. Quit from the tray icon.</p>
    </>
  )
}

// ---------- 5. notificacoes ----------
function NotificationsStep({ s }: { s: Settings }) {
  const [topic, setTopic] = useState(s.ntfyTopic)
  const [bad, setBad] = useState(false)
  const save = async (v: string): Promise<void> => {
    const t = v.trim()
    if (t && !/^[A-Za-z0-9_-]{1,64}$/.test(t)) return setBad(true)
    setBad(false)
    if (t !== s.ntfyTopic) await updateSettings({ ntfyTopic: t })
  }
  const generate = (): void => {
    const a = new Uint8Array(9)
    crypto.getRandomValues(a)
    const t = `turno-${Array.from(a, (b) => (b % 36).toString(36)).join('')}`
    setTopic(t)
    void save(t)
  }
  return (
    <>
      <p className="small">Windows notifications are on: you get one when a routine fails or asks for permission. Each routine's Notify setting can also tell you when it finishes.</p>
      <label className="field">
        <span>Also on your phone (optional, with the free ntfy app)</span>
        <div className="row">
          <input className="mono grow" placeholder="ntfy topic, e.g. turno-8f3k2x9q" value={topic} aria-invalid={bad || undefined} onChange={(e) => (setBad(false), setTopic(e.target.value))} onBlur={(e) => void save(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save(e.currentTarget.value)} />
          <button className="btn" onClick={generate}>Generate</button>
        </div>
        {bad ? <small className="tone-err">Use only letters, numbers, - and _.</small> : <small className="muted">Install ntfy on your phone and subscribe to this topic. A long random name keeps it private.</small>}
      </label>
      <div>
        <button className="btn" onClick={() => void window.turno.settings.testNotify()}>Send a test notification</button>
      </div>
    </>
  )
}

// ---------- fim ----------
function DoneStep({ onAction }: { onAction: () => void }) {
  return (
    <>
      <dl className="onb-keys">
        <dt>Ctrl+Shift+P</dt><dd>Command palette: every action and setting</dd>
        <dt>Ctrl+Shift+N</dt><dd>New agent on the best account</dd>
        <dt>Ctrl+Shift+T</dt><dd>New terminal</dd>
        <dt>Ctrl+Shift+H</dt><dd>Runs: every routine run and its conversation</dd>
        <dt>Ctrl+,</dt><dd>Settings (this tour is there too)</dd>
        <dt>Ctrl+B</dt><dd>Show or hide the sidebar</dd>
        <dt>Alt+Shift+= / -</dt><dd>Split the terminal right / down</dd>
      </dl>
      <div className="row">
        <button className="btn" onClick={() => (onAction(), openTerminal())}>Open a terminal</button>
        <button className="btn" onClick={() => (onAction(), openHistory())}>See Runs</button>
      </div>
    </>
  )
}
