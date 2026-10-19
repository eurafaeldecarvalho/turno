import { useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { WEEKDAYS, type Effort, type PermissionMode, type RoutineConfig, type Weekday } from '../../../shared/types'
import { useStore } from '../store'
import { ModelSelect } from '../ModelSelect'
import { openHistory, openRoutine } from '../layout'
import { scheduleSummary, when } from '../fmt'
import { IconFolder, IconHistory, IconPlay, IconPlus, IconClose } from '../icons'

const DAY_LABEL: Record<Weekday, string> = { sun: 'S', mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S' }
const DAY_TITLE: Record<Weekday, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' }
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const PERMS: Array<{ v: PermissionMode; t: string; d: string }> = [
  { v: 'manual', t: 'Ask', d: 'Asks for approval in the app (and pings your phone). Without an answer, the run stays paused waiting.' },
  { v: 'dontAsk', t: 'Allowed only', d: 'Uses only the tools in the list below; everything else is denied without asking.' },
  { v: 'auto', t: 'Auto', d: 'A classifier approves safe actions and blocks risky ones.' },
  { v: 'acceptEdits', t: 'Accept edits', d: 'Edits files without asking; commands not on the list are denied.' },
  { v: 'bypassPermissions', t: 'Bypass all', d: 'Same as --dangerously-skip-permissions. Does anything without asking.' },
]

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

export function RoutineEditor({ params, api }: IDockviewPanelProps<{ routineId: string | null }>) {
  const routines = useStore((s) => s.routines)
  const [savedId, setSavedId] = useState<string | null>(params.routineId)
  const existing = routines.find((r) => r.id === savedId)
  const [cfg, setCfg] = useState<RoutineConfig>()
  const [prompt, setPrompt] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string }>()
  const [newTime, setNewTime] = useState('09:00')

  // Carrega do disco; recarrega se o arquivo mudar e nao houver edicao pendente.
  useEffect(() => {
    if (existing && !dirty) {
      setCfg(existing.config)
      setPrompt(existing.prompt)
      setId(existing.id)
    }
  }, [existing, dirty])
  useEffect(() => {
    if (!params.routineId)
      void window.turno.routines.template().then((t) => {
        setCfg({ ...t.config, schedule: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], times: ['09:00'] } })
        setPrompt('')
      })
  }, [])

  // Auto save: rotina existente grava sozinha ~0,6s depois da ultima mudanca.
  // A pasta (id) so grava ao sair do campo, para nao renomear o diretorio a cada tecla.
  const rev = useRef(0)
  const saveRef = useRef<() => Promise<boolean>>(undefined)
  const [folderFocus, setFolderFocus] = useState(false)
  const [status, setStatus] = useState<'saving' | 'saved'>()
  const touch = (): void => {
    rev.current++
    setDirty(true)
    setStatus(undefined)
  }
  useEffect(() => {
    if (!dirty || !savedId || folderFocus) return
    const t = setTimeout(() => void saveRef.current?.(), 600)
    return () => clearTimeout(t)
  }, [dirty, savedId, folderFocus, cfg, prompt, id])
  const pendingRef = useRef(false)
  pendingRef.current = dirty && !!savedId
  useEffect(() => () => void (pendingRef.current && saveRef.current?.()), []) // fechou a aba antes do debounce

  const up = (patch: Partial<RoutineConfig>): void => {
    setCfg((c) => (c ? { ...c, ...patch } : c))
    touch()
    setMsg(undefined)
  }
  const upSched = (patch: Partial<RoutineConfig['schedule']>): void => up({ schedule: { ...cfg!.schedule, ...patch } })

  const preview = useMemo(() => (cfg ? scheduleSummary(cfg) : ''), [cfg])
  if (!cfg) return <div className="panel-empty">Loading…</div>

  const isNew = !savedId
  const folder = isNew && !idTouched ? slug(cfg.name) : id

  async function save(): Promise<boolean> {
    const at = rev.current
    setStatus('saving')
    try {
      const r = await window.turno.routines.save({ id: folder, originalId: savedId ?? undefined, config: cfg!, prompt })
      setSavedId(folder)
      if (rev.current === at) setDirty(false) // mudou durante a gravacao: o proximo auto save pega
      api.setTitle(cfg!.name)
      setMsg(r?.error ? { tone: 'err', text: `Saved, but with an error: ${r.error}` } : undefined)
      setStatus('saved')
      return !r?.error
    } catch (e) {
      setStatus(undefined)
      setMsg({ tone: 'err', text: String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      return false
    }
  }
  saveRef.current = save

  async function remove(): Promise<void> {
    if (!savedId || !confirm(`Delete the routine "${cfg!.name}"? Its folder goes to the Recycle Bin; past runs stay in the history.`)) return
    try {
      pendingRef.current = false // nao regravar no fechamento da aba
      setDirty(false)
      await window.turno.routines.delete(savedId)
      api.close()
    } catch (e) {
      setMsg({ tone: 'err', text: String((e as Error).message) })
    }
  }

  async function runNow(): Promise<void> {
    if (dirty && !(await save())) return
    try {
      const runId = await window.turno.run.startRoutine(folder)
      if (runId) openRoutine(folder, cfg!.name)
      else setMsg({ tone: 'err', text: 'Did not run: see the reason in the history.' })
    } catch (e) {
      setMsg({ tone: 'err', text: String((e as Error).message) })
    }
  }

  const toggleDay = (d: Weekday): void => {
    const days = cfg.schedule.days.includes(d) ? cfg.schedule.days.filter((x) => x !== d) : [...cfg.schedule.days, d]
    upSched({ days })
  }
  const addTime = (): void => {
    if (!newTime || cfg.schedule.times.includes(newTime)) return
    upSched({ times: [...cfg.schedule.times, newTime].sort() })
  }
  const qwen = cfg.profile === 'qwen-local'

  return (
    <div className="editor">
      <header className="editor-head">
        <div className="editor-title">
          <input
            className="title-input"
            value={cfg.name}
            onChange={(e) => up({ name: e.target.value })}
            placeholder="Routine name"
            aria-label="Routine name"
          />
          <div className="editor-sub">
            <span className={`pill ${cfg.enabled ? 'pill-on' : ''}`}>{cfg.enabled ? 'on' : 'off'}</span>
            <span className="muted">{preview}</span>
            {existing?.nextRuns[0] && <span className="muted">· next {when(existing.nextRuns[0])}</span>}
            {!isNew && (status === 'saving' || dirty ? <span className="muted">· saving…</span> : status === 'saved' && <span className="muted">· saved</span>)}
          </div>
        </div>
        <div className="editor-actions">
          {!isNew && (
            <>
              <button className="btn ghost" onClick={() => openHistory(folder)} title="History for this routine">
                <IconHistory /> History
              </button>
              <button className="btn ghost" onClick={() => void window.turno.routines.openFolder(folder)} title="Open folder">
                <IconFolder /> Folder
              </button>
              <button className="btn" onClick={() => void runNow()} disabled={!!existing?.error && !dirty}>
                <IconPlay /> Run now
              </button>
              <button className="btn danger" onClick={() => void remove()} title="Delete routine (folder goes to the Recycle Bin)">
                Delete
              </button>
            </>
          )}
          {isNew && (
            <button className="btn primary" onClick={() => void save()}>
              Create routine
            </button>
          )}
        </div>
      </header>
      {(msg || existing?.error) && (
        <div className={`banner ${msg?.tone === 'ok' ? 'banner-ok' : 'banner-err'}`}>{msg?.text ?? `Error in ROUTINE.md: ${existing!.error}`}</div>
      )}

      <div className="editor-body">
        <section className="card">
          <h3>General</h3>
          <div className="grid2">
            <label className="field">
              <span>Folder</span>
              <input
                value={folder}
                onChange={(e) => {
                  setIdTouched(true)
                  setId(e.target.value)
                  touch()
                }}
                onFocus={() => setFolderFocus(true)}
                onBlur={() => setFolderFocus(false)}
                placeholder="daily-summary"
              />
            </label>
            <label className="field toggle-field">
              <span>Enabled</span>
              <Switch checked={cfg.enabled} onChange={(v) => up({ enabled: v })} />
            </label>
          </div>
          <label className="field">
            <span>Description</span>
            <input value={cfg.description} onChange={(e) => up({ description: e.target.value })} placeholder="What this routine does" />
          </label>
        </section>

        <section className="card">
          <h3>When it runs</h3>
          <div className="field">
            <span>Days</span>
            <div className="days">
              {WEEKDAYS.map((d) => (
                <button
                  key={d}
                  className={`day ${cfg.schedule.days.includes(d) ? 'on' : ''}`}
                  onClick={() => toggleDay(d)}
                  title={DAY_TITLE[d]}
                  aria-pressed={cfg.schedule.days.includes(d)}
                >
                  {DAY_LABEL[d]}
                </button>
              ))}
              <span className="day-presets">
                <button className="link" onClick={() => upSched({ days: [...WEEKDAYS] })}>all</button>
                <button className="link" onClick={() => upSched({ days: ['mon', 'tue', 'wed', 'thu', 'fri'] })}>weekdays</button>
              </span>
            </div>
          </div>
          <div className="field">
            <span>Times</span>
            <div className="times">
              {cfg.schedule.times.map((t) => (
                <span className="chip" key={t}>
                  {t}
                  <button aria-label={`remove ${t}`} onClick={() => upSched({ times: cfg.schedule.times.filter((x) => x !== t) })}>
                    <IconClose size={12} />
                  </button>
                </span>
              ))}
              <span className="time-add">
                <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTime()} />
                <button className="btn small" onClick={addTime}>
                  <IconPlus size={14} /> add
                </button>
              </span>
            </div>
            {!cfg.schedule.times.length && !cfg.schedule.cron && <small className="muted">No times: only runs via the "Run now" button.</small>}
          </div>
          <details className="advanced">
            <summary>Advanced</summary>
            <div className="grid2">
              <label className="field">
                <span>Cron (overrides days/times)</span>
                <input value={cfg.schedule.cron ?? ''} onChange={(e) => upSched({ cron: e.target.value || undefined })} placeholder="15 9,12,15,18 * * *" />
              </label>
              <label className="field">
                <span>Time zone</span>
                <input value={cfg.timezone} onChange={(e) => up({ timezone: e.target.value })} />
              </label>
              <label className="field toggle-field">
                <span>Catch up on missed runs (PC off/asleep)</span>
                <Switch checked={cfg.catchup} onChange={(v) => up({ catchup: v })} />
              </label>
              <label className="field">
                <span>Catch-up window (hours)</span>
                <input type="number" min={1} value={cfg.catchup_window_h} onChange={(e) => up({ catchup_window_h: Number(e.target.value) || 1 })} />
              </label>
            </div>
          </details>
        </section>

        <section className="card">
          <h3>Model</h3>
          <div className="seg">
            <button className={!qwen ? 'on' : ''} onClick={() => up({ profile: 'claude-max' })}>
              Claude <small>subscription</small>
            </button>
            <button className={qwen ? 'on' : ''} onClick={() => up({ profile: 'qwen-local', chrome: cfg.chrome })}>
              Local Qwen <small>Ollama</small>
            </button>
          </div>
          <div className="grid2">
            <label className="field">
              <span>Model</span>
              {qwen ? (
                <input value="qwen3.6:35b" disabled />
              ) : (
                <ModelSelect value={cfg.model} onChange={(v) => up({ model: v })} />
              )}
            </label>
            <div className="field">
              <span>Effort</span>
              <div className="seg small">
                {EFFORTS.map((e) => (
                  <button key={e} className={cfg.effort === e ? 'on' : ''} onClick={() => up({ effort: e })}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <h3>Permissions</h3>
          <div className="perm-grid">
            {PERMS.map((p) => (
              <button
                key={p.v}
                className={`perm ${cfg.permission_mode === p.v ? 'on' : ''} ${p.v === 'bypassPermissions' ? 'danger' : ''}`}
                onClick={() => up({ permission_mode: p.v })}
              >
                <strong>{p.t}</strong>
                <span>{p.d}</span>
              </button>
            ))}
          </div>
          {cfg.permission_mode !== 'bypassPermissions' && (
            <label className="field">
              <span>Allowed tools (one per line)</span>
              <textarea
                rows={3}
                className="mono"
                value={cfg.allowed_tools.join('\n')}
                onChange={(e) => up({ allowed_tools: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                placeholder={'Read\nBash(python tools/*)\nmcp__claude-in-chrome__*'}
              />
            </label>
          )}
          <label className="field toggle-field">
            <span>Use Chrome (Claude in Chrome, signed-in session)</span>
            <Switch checked={cfg.chrome} onChange={(v) => up({ chrome: v })} />
          </label>
        </section>

        <section className="card">
          <h3>Execution</h3>
          <div className="grid3">
            <label className="field">
              <span>Max time (min)</span>
              <input type="number" min={1} value={cfg.timeout_min} onChange={(e) => up({ timeout_min: Number(e.target.value) || 1 })} />
            </label>
            <label className="field">
              <span>Stop if idle for (min)</span>
              <input type="number" min={1} value={cfg.idle_timeout_min} onChange={(e) => up({ idle_timeout_min: Number(e.target.value) || 1 })} />
            </label>
            <label className="field">
              <span>Notify</span>
              <select value={cfg.notify} onChange={(e) => up({ notify: e.target.value as RoutineConfig['notify'] })}>
                <option value="failures">failures only</option>
                <option value="always">always</option>
                <option value="never">never</option>
              </select>
            </label>
            <label className="field">
              <span>Extra locks</span>
              <input
                value={cfg.locks.join(', ')}
                onChange={(e) => up({ locks: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                placeholder="e.g. site-x"
              />
            </label>
            <label className="field">
              <span>If the lock is busy</span>
              <select value={cfg.lock_policy} onChange={(e) => up({ lock_policy: e.target.value as 'skip' | 'queue' })}>
                <option value="queue">wait (up to 45 min)</option>
                <option value="skip">skip</option>
              </select>
            </label>
            <label className="field">
              <span>Precheck (command; error = skip)</span>
              <input className="mono" value={cfg.precheck ?? ''} onChange={(e) => up({ precheck: e.target.value || undefined })} placeholder="python check.py" />
            </label>
          </div>
          <small className="muted">
            Automatic locks: <code>chrome</code> when using Chrome, <code>gpu</code> for Qwen. Two routines with the same lock never run at the same time.
          </small>
        </section>

        <section className="card grow">
          <h3>Prompt</h3>
          <textarea
            className="prompt mono"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              touch()
            }}
            placeholder="What the agent should do on each run. Be explicit: nobody will be watching to answer questions."
          />
        </section>
      </div>
    </div>
  )
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  )
}
