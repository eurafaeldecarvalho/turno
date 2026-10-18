import { useEffect, useMemo, useState } from 'react'
import type { RunRecord } from '../../../shared/types'
import type { IDockviewPanelProps } from 'dockview-react'
import { useStore } from '../store'
import { STATUS_LABEL, TRIGGER_LABEL, duration, statusTone, when } from '../fmt'
import { openRun } from '../layout'

type Filter = 'todas' | 'problemas' | 'rodando'
const FILTER_LABEL: Record<Filter, string> = { todas: 'all', problemas: 'problems', rodando: 'running' }

export function HistoryPanel({ params }: IDockviewPanelProps<{ routine?: string }>) {
  const runs = useStore((s) => s.runs)
  const routines = useStore((s) => s.routines)
  const [filter, setFilter] = useState<Filter>('todas')
  // '' = todas; '__adhoc' = execuções avulsas; senão o id da rotina.
  const [routine, setRoutine] = useState(params.routine ?? '')
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
    if (filter === 'problemas') return !['ok', 'running', 'queued'].includes(r.status)
    if (filter === 'rodando') return r.status === 'running' || r.status === 'queued'
    return true
  })

  return (
    <div className="history">
      <header className="history-head">
        <div className="seg small">
          {(['todas', 'problemas', 'rodando'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
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
        <span className="muted small history-count">{list.length} runs</span>
      </header>
      <div className="table-wrap">
        <table className="table">
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
            {list.map((r) => {
              const name = r.routine ? (names.get(r.routine) ?? r.routine) : 'ad hoc'
              return (
                <tr key={r.id} onClick={() => openRun(r.id, name)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openRun(r.id, name)}>
                  <td><span className={`dot dot-${statusTone(r.status)}`} /></td>
                  <td className="strong">{name}</td>
                  <td><span className={`pill pill-${statusTone(r.status)}`}>{STATUS_LABEL[r.status]}</span></td>
                  <td>{when(r.started_at ?? r.ended_at)}</td>
                  <td className="muted">{duration(r)}</td>
                  <td className="muted">{TRIGGER_LABEL[r.trigger]}</td>
                  <td className="muted">{r.profile === 'qwen-local' ? 'qwen' : r.model ?? '—'}</td>
                  <td className="muted clip">{r.skip_reason ?? (r.result ?? '').replace(/\s+/g, ' ').slice(0, 140)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!list.length && <div className="panel-empty">No runs yet.</div>}
      </div>
    </div>
  )
}
