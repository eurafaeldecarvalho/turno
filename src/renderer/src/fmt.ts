import { WEEKDAYS, type RoutineConfig, type RunRecord, type RunStatus } from '../../shared/types'

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'na fila',
  running: 'rodando',
  ok: 'ok',
  failed: 'falhou',
  skipped: 'pulada',
  timeout: 'tempo esgotado',
  idle_timeout: 'travada (inativa)',
  rate_limited: 'limite de uso',
  stopped: 'parada',
}

export function statusTone(s: RunStatus | undefined): 'ok' | 'run' | 'warn' | 'err' | 'idle' {
  if (!s) return 'idle'
  if (s === 'ok') return 'ok'
  if (s === 'running' || s === 'queued') return 'run'
  if (s === 'skipped' || s === 'stopped' || s === 'rate_limited') return 'warn'
  return 'err'
}

const DAY_LABEL: Record<string, string> = { dom: 'dom', seg: 'seg', ter: 'ter', qua: 'qua', qui: 'qui', sex: 'sex', sab: 'sáb' }

export function scheduleSummary(c: RoutineConfig): string {
  if (c.schedule.cron) return `cron ${c.schedule.cron}`
  if (!c.schedule.times.length) return 'só manual'
  const d = [...c.schedule.days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
  const key = d.join(',')
  const days =
    d.length === 7 ? 'todo dia' : key === 'seg,ter,qua,qui,sex' ? 'seg–sex' : key === 'dom,sab' ? 'fim de semana' : d.map((x) => DAY_LABEL[x]).join(', ')
  return `${days} · ${[...c.schedule.times].sort().join(', ')}`
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now.getTime() + 86_400_000).toDateString() === d.toDateString()
  const yesterday = new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString()
  if (sameDay) return `hoje ${time}`
  if (tomorrow) return `amanhã ${time}`
  if (yesterday) return `ontem ${time}`
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} ${time}`
}

export function duration(r: RunRecord): string {
  if (!r.started_at) return ''
  const end = r.ended_at ? Date.parse(r.ended_at) : Date.now()
  const s = Math.max(0, Math.round((end - Date.parse(r.started_at)) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}min ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}min`
}

export const TRIGGER_LABEL: Record<string, string> = { manual: 'manual', cron: 'agendada', catchup: 'recuperada', adhoc: 'avulsa', followup: 'continuação' }
