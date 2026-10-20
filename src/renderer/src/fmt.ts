import { WEEKDAYS, type RoutineConfig, type RunRecord, type RunStatus } from '../../shared/types'

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'queued',
  running: 'running',
  ok: 'ok',
  failed: 'failed',
  skipped: 'skipped',
  timeout: 'timed out',
  idle_timeout: 'stalled (idle)',
  rate_limited: 'usage limit',
  stopped: 'stopped',
  aborted: 'aborted (limit)',
  paused: 'paused (rate limit)',
}

export function statusTone(s: RunStatus | undefined): 'ok' | 'run' | 'warn' | 'err' | 'idle' {
  if (!s) return 'idle'
  if (s === 'ok') return 'ok'
  if (s === 'running' || s === 'queued' || s === 'paused') return 'run'
  if (s === 'skipped' || s === 'stopped' || s === 'rate_limited' || s === 'aborted') return 'warn'
  return 'err'
}

const DAY_LABEL: Record<string, string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' }

export function scheduleSummary(c: RoutineConfig): string {
  if (c.schedule.cron) return `cron ${c.schedule.cron}`
  if (!c.schedule.times.length) return 'manual only'
  const d = [...c.schedule.days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
  const key = d.join(',')
  const days =
    d.length === 7
      ? 'every day'
      : key === 'mon,tue,wed,thu,fri'
        ? 'Mon–Fri'
        : key === 'sun,sat' || key === 'sat,sun'
          ? 'weekends'
          : d.map((x) => DAY_LABEL[x]).join(', ')
  return `${days} · ${[...c.schedule.times].sort().join(', ')}`
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now.getTime() + 86_400_000).toDateString() === d.toDateString()
  const yesterday = new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString()
  if (sameDay) return `today ${time}`
  if (tomorrow) return `tomorrow ${time}`
  if (yesterday) return `yesterday ${time}`
  return `${d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: '2-digit' })} ${time}`
}

export function duration(r: RunRecord): string {
  if (!r.started_at) return ''
  const end = r.ended_at ? Date.parse(r.ended_at) : Date.now()
  const s = Math.max(0, Math.round((end - Date.parse(r.started_at)) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}min ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}min`
}

export const TRIGGER_LABEL: Record<string, string> = { manual: 'manual', cron: 'scheduled', catchup: 'catch-up', adhoc: 'ad hoc', followup: 'follow-up', watch: 'file change' }
