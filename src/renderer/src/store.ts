import { useSyncExternalStore } from 'react'
import type { Routine, RunRecord, RunStatus } from '../../shared/types'
import { toast, type ToastTone } from './Toast'
import { STATUS_LABEL } from './fmt'

const TOAST_TONE: Partial<Record<RunStatus, ToastTone>> = {
  ok: 'ok',
  paused: 'run',
  failed: 'err',
  aborted: 'warn',
  timeout: 'warn',
  idle_timeout: 'warn',
  rate_limited: 'warn',
}

// Estado global minimo: rotinas e runs recentes, atualizados por eventos do processo main.
interface State {
  routines: Routine[]
  runs: RunRecord[]
  loaded: boolean // true apos a 1a carga (pra distinguir "carregando" de "vazio de verdade")
}

let state: State = { routines: [], runs: [], loaded: false }
const subs = new Set<() => void>()
const set = (patch: Partial<State>): void => {
  state = { ...state, ...patch }
  subs.forEach((f) => f())
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => sel(state),
  )
}

export async function initStore(): Promise<void> {
  const [routines, runs] = await Promise.all([window.turno.routines.list(), window.turno.run.list(undefined, 300)])
  set({ routines, runs, loaded: true })
  window.turno.routines.onChanged((rs) => set({ routines: rs }))
  window.turno.run.onChanged((run) => {
    const prev = state.runs.find((r) => r.id === run.id)
    const rest = state.runs.filter((r) => r.id !== run.id)
    set({ runs: [run, ...rest].sort((a, b) => sortKey(b).localeCompare(sortKey(a))).slice(0, 300) })
    // Toast in-app na transicao running/queued -> terminal (so numa mudanca ao vivo, nao no carregamento inicial).
    const tone = TOAST_TONE[run.status]
    if (prev && isActive(prev) && tone) toast(`${run.routine ?? 'Run'}: ${STATUS_LABEL[run.status]}`, tone)
    // ultima run tambem aparece na sidebar
    set({ routines: state.routines.map((r) => (r.id === run.routine ? { ...r, lastRun: run } : r)) })
  })
}

const sortKey = (r: RunRecord): string => r.started_at ?? r.ended_at ?? ''

export function isActive(r: RunRecord | undefined): boolean {
  return !!r && (r.status === 'running' || r.status === 'queued')
}
