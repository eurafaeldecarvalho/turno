import { useEffect, useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { WEEKDAYS, type Effort, type PermissionMode, type RoutineConfig, type Weekday } from '../../../shared/types'
import { useStore } from '../store'
import { ModelSelect } from '../ModelSelect'
import { openHistory, openRoutine } from '../layout'
import { scheduleSummary, when } from '../fmt'
import { IconFolder, IconHistory, IconPlay, IconPlus, IconClose } from '../icons'

const DAY_LABEL: Record<Weekday, string> = { dom: 'D', seg: 'S', ter: 'T', qua: 'Q', qui: 'Q', sex: 'S', sab: 'S' }
const DAY_TITLE: Record<Weekday, string> = { dom: 'domingo', seg: 'segunda', ter: 'terça', qua: 'quarta', qui: 'quinta', sex: 'sexta', sab: 'sábado' }
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const PERMS: Array<{ v: PermissionMode; t: string; d: string }> = [
  { v: 'manual', t: 'Perguntar', d: 'Pede aprovação no app (e avisa no celular). Sem resposta, a execução fica parada esperando.' },
  { v: 'dontAsk', t: 'Só o liberado', d: 'Usa apenas as ferramentas da lista abaixo; o resto é negado sem perguntar.' },
  { v: 'auto', t: 'Auto', d: 'Um classificador aprova ações seguras e bloqueia as arriscadas.' },
  { v: 'acceptEdits', t: 'Aceitar edições', d: 'Edita arquivos sem pedir; comandos fora da lista são negados.' },
  { v: 'bypassPermissions', t: 'Ignorar tudo', d: 'Equivale a --dangerously-skip-permissions. Faz qualquer coisa sem perguntar.' },
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
        setCfg({ ...t.config, schedule: { days: ['seg', 'ter', 'qua', 'qui', 'sex'], times: ['09:00'] } })
        setPrompt('')
      })
  }, [])

  const up = (patch: Partial<RoutineConfig>): void => {
    setCfg((c) => (c ? { ...c, ...patch } : c))
    setDirty(true)
    setMsg(undefined)
  }
  const upSched = (patch: Partial<RoutineConfig['schedule']>): void => up({ schedule: { ...cfg!.schedule, ...patch } })

  const preview = useMemo(() => (cfg ? scheduleSummary(cfg) : ''), [cfg])
  if (!cfg) return <div className="panel-empty">Carregando…</div>

  const isNew = !savedId
  const folder = isNew && !idTouched ? slug(cfg.name) : id

  async function save(): Promise<boolean> {
    try {
      const r = await window.turno.routines.save({ id: folder, originalId: savedId ?? undefined, config: cfg!, prompt })
      setSavedId(folder)
      setDirty(false)
      api.setTitle(cfg!.name)
      setMsg(r?.error ? { tone: 'err', text: `Salvo, mas com erro: ${r.error}` } : { tone: 'ok', text: 'Salvo.' })
      return !r?.error
    } catch (e) {
      setMsg({ tone: 'err', text: String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      return false
    }
  }

  async function runNow(): Promise<void> {
    if (dirty && !(await save())) return
    try {
      const runId = await window.turno.run.startRoutine(folder)
      if (runId) openRoutine(folder, cfg!.name)
      else setMsg({ tone: 'err', text: 'Não rodou: veja o motivo no histórico.' })
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
            placeholder="Nome da rotina"
            aria-label="Nome da rotina"
          />
          <div className="editor-sub">
            <span className={`pill ${cfg.enabled ? 'pill-on' : ''}`}>{cfg.enabled ? 'ligada' : 'desligada'}</span>
            <span className="muted">{preview}</span>
            {existing?.nextRuns[0] && <span className="muted">· próxima {when(existing.nextRuns[0])}</span>}
          </div>
        </div>
        <div className="editor-actions">
          {!isNew && (
            <>
              <button className="btn ghost" onClick={() => openHistory(folder)} title="Histórico desta rotina">
                <IconHistory /> Histórico
              </button>
              <button className="btn ghost" onClick={() => void window.turno.routines.openFolder(folder)} title="Abrir pasta">
                <IconFolder /> Pasta
              </button>
              <button className="btn" onClick={() => void runNow()} disabled={!!existing?.error && !dirty}>
                <IconPlay /> Rodar agora
              </button>
            </>
          )}
          <button className="btn primary" onClick={() => void save()} disabled={!dirty && !isNew}>
            {isNew ? 'Criar rotina' : 'Salvar'}
          </button>
        </div>
      </header>
      {(msg || existing?.error) && (
        <div className={`banner ${msg?.tone === 'ok' ? 'banner-ok' : 'banner-err'}`}>{msg?.text ?? `Erro no ROUTINE.md: ${existing!.error}`}</div>
      )}

      <div className="editor-body">
        <section className="card">
          <h3>Geral</h3>
          <div className="grid2">
            <label className="field">
              <span>Pasta</span>
              <input
                value={folder}
                onChange={(e) => {
                  setIdTouched(true)
                  setId(e.target.value)
                  setDirty(true)
                }}
                placeholder="resumo-diario"
              />
            </label>
            <label className="field toggle-field">
              <span>Ligada</span>
              <Switch checked={cfg.enabled} onChange={(v) => up({ enabled: v })} />
            </label>
          </div>
          <label className="field">
            <span>Descrição</span>
            <input value={cfg.description} onChange={(e) => up({ description: e.target.value })} placeholder="O que esta rotina faz" />
          </label>
        </section>

        <section className="card">
          <h3>Quando roda</h3>
          <div className="field">
            <span>Dias</span>
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
                <button className="link" onClick={() => upSched({ days: [...WEEKDAYS] })}>todos</button>
                <button className="link" onClick={() => upSched({ days: ['seg', 'ter', 'qua', 'qui', 'sex'] })}>úteis</button>
              </span>
            </div>
          </div>
          <div className="field">
            <span>Horários</span>
            <div className="times">
              {cfg.schedule.times.map((t) => (
                <span className="chip" key={t}>
                  {t}
                  <button aria-label={`remover ${t}`} onClick={() => upSched({ times: cfg.schedule.times.filter((x) => x !== t) })}>
                    <IconClose size={12} />
                  </button>
                </span>
              ))}
              <span className="time-add">
                <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTime()} />
                <button className="btn small" onClick={addTime}>
                  <IconPlus size={14} /> adicionar
                </button>
              </span>
            </div>
            {!cfg.schedule.times.length && !cfg.schedule.cron && <small className="muted">Sem horário: só roda pelo botão "Rodar agora".</small>}
          </div>
          <details className="advanced">
            <summary>Avançado</summary>
            <div className="grid2">
              <label className="field">
                <span>Cron (substitui dias/horários)</span>
                <input value={cfg.schedule.cron ?? ''} onChange={(e) => upSched({ cron: e.target.value || undefined })} placeholder="15 9,12,15,18 * * *" />
              </label>
              <label className="field">
                <span>Fuso horário</span>
                <input value={cfg.timezone} onChange={(e) => up({ timezone: e.target.value })} />
              </label>
              <label className="field toggle-field">
                <span>Recuperar horário perdido (PC desligado/dormindo)</span>
                <Switch checked={cfg.catchup} onChange={(v) => up({ catchup: v })} />
              </label>
              <label className="field">
                <span>Janela de recuperação (horas)</span>
                <input type="number" min={1} value={cfg.catchup_window_h} onChange={(e) => up({ catchup_window_h: Number(e.target.value) || 1 })} />
              </label>
            </div>
          </details>
        </section>

        <section className="card">
          <h3>Modelo</h3>
          <div className="seg">
            <button className={!qwen ? 'on' : ''} onClick={() => up({ profile: 'claude-max' })}>
              Claude <small>assinatura</small>
            </button>
            <button className={qwen ? 'on' : ''} onClick={() => up({ profile: 'qwen-local', chrome: cfg.chrome })}>
              Qwen local <small>Ollama</small>
            </button>
          </div>
          <div className="grid2">
            <label className="field">
              <span>Modelo</span>
              {qwen ? (
                <input value="qwen3.6:35b" disabled />
              ) : (
                <ModelSelect value={cfg.model} onChange={(v) => up({ model: v })} />
              )}
            </label>
            <div className="field">
              <span>Esforço</span>
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
          <h3>Permissões</h3>
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
              <span>Ferramentas liberadas (uma por linha)</span>
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
            <span>Usar o Chrome (Claude in Chrome, sessão logada)</span>
            <Switch checked={cfg.chrome} onChange={(v) => up({ chrome: v })} />
          </label>
        </section>

        <section className="card">
          <h3>Execução</h3>
          <div className="grid3">
            <label className="field">
              <span>Tempo máximo (min)</span>
              <input type="number" min={1} value={cfg.timeout_min} onChange={(e) => up({ timeout_min: Number(e.target.value) || 1 })} />
            </label>
            <label className="field">
              <span>Parar se inativa por (min)</span>
              <input type="number" min={1} value={cfg.idle_timeout_min} onChange={(e) => up({ idle_timeout_min: Number(e.target.value) || 1 })} />
            </label>
            <label className="field">
              <span>Notificar</span>
              <select value={cfg.notify} onChange={(e) => up({ notify: e.target.value as RoutineConfig['notify'] })}>
                <option value="falhas">só falhas</option>
                <option value="sempre">sempre</option>
                <option value="nunca">nunca</option>
              </select>
            </label>
            <label className="field">
              <span>Travas extras</span>
              <input
                value={cfg.locks.join(', ')}
                onChange={(e) => up({ locks: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                placeholder="ex.: site-x"
              />
            </label>
            <label className="field">
              <span>Se a trava estiver ocupada</span>
              <select value={cfg.lock_policy} onChange={(e) => up({ lock_policy: e.target.value as 'skip' | 'queue' })}>
                <option value="queue">esperar (até 45 min)</option>
                <option value="skip">pular</option>
              </select>
            </label>
            <label className="field">
              <span>Precheck (comando; erro = pula)</span>
              <input className="mono" value={cfg.precheck ?? ''} onChange={(e) => up({ precheck: e.target.value || undefined })} placeholder="python check.py" />
            </label>
          </div>
          <small className="muted">
            Travas automáticas: <code>chrome</code> quando usa o Chrome, <code>gpu</code> no Qwen. Duas rotinas com a mesma trava nunca rodam juntas.
          </small>
        </section>

        <section className="card grow">
          <h3>Prompt</h3>
          <textarea
            className="prompt mono"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              setDirty(true)
            }}
            placeholder="O que o agente deve fazer a cada execução. Seja explícito: ninguém vai estar olhando para responder perguntas."
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
