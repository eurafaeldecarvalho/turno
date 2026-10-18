import { useSyncExternalStore } from 'react'
import type { Routine, RunRecord } from '../../shared/types'

// Estado global minimo: rotinas e runs recentes, atualizados por eventos do processo main.
interface State {
  routines: Routine[]
  runs: RunRecord[]
}

let state: State = { routines: [], runs: [] }
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
  set({ routines, runs })
  window.turno.routines.onChanged((rs) => set({ routines: rs }))
  window.turno.run.onChanged((run) => {
    const rest = state.runs.filter((r) => r.id !== run.id)
    set({ runs: [run, ...rest].sort((a, b) => sortKey(b).localeCompare(sortKey(a))).slice(0, 300) })
    // ultima run tambem aparece na sidebar
    set({ routines: state.routines.map((r) => (r.id === run.routine ? { ...r, lastRun: run } : r)) })
  })
}

const sortKey = (r: RunRecord): string => r.started_at ?? r.ended_at ?? ''

export function isActive(r: RunRecord | undefined): boolean {
  return !!r && (r.status === 'running' || r.status === 'queued')
}
