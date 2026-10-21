import { useEffect, useMemo, useRef, useState } from 'react'
import type { RunRecord, RunStatus } from '../../../shared/types'
import type { IDockviewPanelProps } from 'dockview-react'
import { useStore } from '../store'
import { STATUS_LABEL, TRIGGER_LABEL, duration, statusTone, when } from '../fmt'
import { openRoutine, openRun, rememberHistoryRoutine } from '../layout'
import { IconHistory } from '../icons'

// Resumo de uma linha: tira a marcacao Markdown (**, `, #, marcadores de lista) que o agente escreve.
const plainText = (s: string): string =>
  s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()

type Filter = 'todas' | 'problemas' | 'rodando'
const FILTER_LABEL: Record<Filter, string> = { todas: 'all', problemas: 'problems', rodando: 'running' }
// Lembrado entre aberturas: voltar de uma run para Runs mantem o filtro.
let lastFilter: Filter = 'todas'
let lastOpened: string | undefined // run aberta por ultimo: ao voltar, o foco volta para a linha dela

export function HistoryPanel({ params }: IDockviewPanelProps<{ routine?: string; keepFilter?: boolean }>) {
  const runs = useStore((s) => s.runs)
  const routines = useStore((s) => s.routines)
  const loaded = useStore((s) => s.loaded)
  // aberto a partir de uma rotina: comeca em "all" (filtro antigo deixava a lista vazia); voltando de uma run, mantem
  const [filter, setFilterState] = useState<Filter>(params.routine && !params.keepFilter ? 'todas' : lastFilter)
  const setFilter = (f: Filter): void => {
    lastFilter = f
    setFilterState(f)
  }
  // '' = todas; '__adhoc' = execuções avulsas; senão o id da rotina.
  const [routine, setRoutineState] = useState(params.routine ?? '')
  const setRoutine = (r: string): void => {
    rememberHistoryRoutine(r)
    setRoutineState(r)
  }
  const [older, setOlder] = useState<RunRecord[]>([])
  const names = useMemo(() => new Map(routines.map((r) => [r.id, r.config.name])), [routines])

  // O store guarda só as 300 mais recentes de todas; ao filtrar uma rotina, busca o histórico dela inteiro.
  useEffect(() => {
    setOlder([])
    if (routine && routine !== '__adhoc') void window.turno.run.list(routine, 500).then(setOlder)
  }, [routine])

  const options = useMemo(() => {
    const ids = new Set([...routines.map((r) => r.id), ...runs.map((r) => r.routine).filter((x): x is string => !!x)])
    return [...ids].map((id) => ({ id, name: names.get(id) ?? `${id} (removed)` })).sort((a, b) => a.name.localeCompare(b.name, 'en-US'))
  }, [routines, runs, names])

  const source = useMemo(() => {
    if (!older.length) return runs
    const live = new Map(runs.map((r) => [r.id, r]))
    const merged = [...runs, ...older.filter((r) => !live.has(r.id))]
    return merged.sort((a, b) => (b.started_at ?? b.ended_at ?? '').localeCompare(a.started_at ?? a.ended_at ?? ''))
  }, [runs, older])

  const list = source.filter((r) => {
    if (routine === '__adhoc' ? r.routine !== null : routine && r.routine !== routine) return false
    if (filter === 'problemas') return !['ok', 'running', 'queued', 'paused'].includes(r.status)
    if (filter === 'rodando') return r.status === 'running' || r.status === 'queued'
    return true
  })

  const tableRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!loaded || !lastOpened) return
    const row = tableRef.current?.querySelector<HTMLElement>(`tr[data-run="${CSS.escape(lastOpened)}"]`)
    row?.focus({ preventScroll: false })
    lastOpened = undefined
  }, [loaded])

  // so as runs da rotina escolhida (o total geral confundia: "29 escondidas" numa rotina com 3)
  const hiddenCount = source.filter((r) => (routine === '__adhoc' ? r.routine === null : !routine || r.routine === routine)).length

  // Ctrl+A dentro de Runs seleciona so a lista (nao o que esta atras do modal)
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const wrap = tableRef.current
      const t = e.target as HTMLElement | null
      if (!wrap || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a' || t?.closest?.('input, textarea, select, .xterm')) return
      const scope = wrap.closest('.modal') ?? wrap.closest('.history')
      if (!scope || !t || !scope.contains(t)) return
      e.preventDefault()
      const range = document.createRange()
      range.selectNodeContents(wrap.querySelector('tbody') ?? wrap)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [])

  // "held by <id da run>" -> nome da rotina e hora local da run que segurava o lock
  const holderText = (reason: string): string =>
    reason.replace(/held by (\d{4}-\d{2}-\d{2}T[\w-]+)/, (m, id) => {
      const h = source.find((x) => x.id === id)
      return h ? `held by ${h.routine ? (names.get(h.routine) ?? h.routine) : 'ad hoc'} · ${when(h.started_at ?? h.ended_at)}` : m
    })

  // Flash na linha que mudou de status (feedback de atualizacao ao vivo).
  const prevStatus = useRef(new Map<string, RunStatus>())
  const changed = new Set<string>()
  for (const r of list) {
    const p = prevStatus.current.get(r.id)
    if (p && p !== r.status) changed.add(r.id)
  }
  useEffect(() => {
    const m = new Map<string, RunStatus>()
    for (const r of source) m.set(r.id, r.status)
    prevStatus.current = m
  })

  return (
    <div className="history">
      <header className="history-head">
        <div className="seg small">
          {(['todas', 'problemas', 'rodando'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        <select className="history-routine" value={routine} onChange={(e) => setRoutine(e.target.value)} aria-label="Filter by routine">
          <option value="">All routines</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
          <option value="__adhoc">Ad hoc runs</option>
        </select>
        <span className="muted small history-count">{list.length} {list.length === 1 ? 'run' : 'runs'}</span>
      </header>
      <div className="table-wrap" ref={tableRef}>
        <table className="table table-fixed">
          <colgroup>
            <col style={{ width: 22 }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 96 }} />
            <col className="col-opt" style={{ width: 96 }} />
            <col className="col-opt" style={{ width: 84 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th />
              <th>Routine</th>
              <th>Status</th>
              <th>When</th>
              <th>Duration</th>
              <th>Trigger</th>
              <th>Model</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {!loaded &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} className="sk-row">
                  <td><span className="sk sk-dot" /></td>
                  <td><span className="sk sk-bar" style={{ width: 120 }} /></td>
                  <td><span className="sk sk-bar" style={{ width: 60 }} /></td>
                  <td><span className="sk sk-bar" style={{ width: 70 }} /></td>
                  <td><span className="sk sk-bar" style={{ width: 40 }} /></td>
                  <td><span className="sk sk-bar" style={{ width: 50 }} /></td>
                  <td><span className="sk sk-bar" style={{ width: 60 }} /></td>
                  <td><span className="sk sk-bar" style={{ width: 160 }} /></td>
                </tr>
              ))}
            {loaded &&
              list.map((r) => {
              const name = r.routine ? (names.get(r.routine) ?? r.routine) : 'ad hoc'
              return (
                <tr key={r.id} data-run={r.id} className={changed.has(r.id) ? 'row-flash' : undefined} onClick={() => ((lastOpened = r.id), openRun(r.id, name))} tabIndex={0} onKeyDown={(e) => {
                  if (e.key === 'Enter') return void ((lastOpened = r.id), openRun(r.id, name))
                  const rows = e.currentTarget.parentElement
                  const sib =
                    e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling
                    : e.key === 'ArrowUp' ? e.currentTarget.previousElementSibling
                    : e.key === 'Home' ? rows?.firstElementChild
                    : e.key === 'End' ? rows?.lastElementChild
                    : null
                  if (sib instanceof HTMLElement) (e.preventDefault(), sib.focus())
                }}>
                  <td><span className={`dot dot-${statusTone(r.status)}`} /></td>
                  <td className="strong" title={name}>{name}</td>
                  <td><span className={`pill pill-${statusTone(r.status)}`}>{STATUS_LABEL[r.status]}</span></td>
                  <td title={r.started_at ?? r.ended_at ? new Date((r.started_at ?? r.ended_at)!).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }) : undefined}>{when(r.started_at ?? r.ended_at)}</td>
                  <td className="muted">{duration(r)}</td>
                  <td className="muted">{TRIGGER_LABEL[r.trigger]}</td>
                  <td className="muted">{r.model ?? '—'}</td>
                  {(() => {
                    const full = r.skip_reason ? holderText(r.skip_reason) : plainText(r.result ?? '')
                    return <td className="muted clip" title={full}>{full.slice(0, 160)}</td>
                  })()}
                </tr>
              )
            })}
          </tbody>
        </table>
        {loaded && !list.length && !source.length && (
          <div className="empty-state">
            <div className="empty-icon"><IconHistory size={22} /></div>
            <div className="empty-title">No runs yet</div>
            <div className="muted small">Runs from your routines and ad-hoc prompts show up here.</div>
            <button className="btn primary" onClick={() => openRoutine(null, 'New routine')}>Create a routine</button>
          </div>
        )}
        {loaded && !list.length && source.length > 0 && (
          <div className="empty-state">
            <div className="empty-title">{filter === 'rodando' ? 'Nothing running right now' : filter === 'problemas' ? 'No problems' : routine === '__adhoc' ? 'No ad hoc runs' : 'No runs for this routine'}</div>
            <div className="muted small">{hiddenCount ? `${hiddenCount} ${hiddenCount === 1 ? 'run is' : 'runs are'} hidden by the current filter.` : `${source.length} ${source.length === 1 ? 'run' : 'runs'} from other routines ${source.length === 1 ? 'is' : 'are'} hidden by the routine filter.`}</div>
            <button className="btn" onClick={() => (setFilter('todas'), setRoutine(''), requestAnimationFrame(() => tableRef.current?.querySelector<HTMLElement>('tbody tr')?.focus()))}>Show all runs</button>
          </div>
        )}
      </div>
    </div>
  )
}
