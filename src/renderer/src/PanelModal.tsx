import { useEffect, useState } from 'react'
import { RunViewer } from './panels/RunViewer'
import { HistoryPanel } from './panels/HistoryPanel'
import { AdhocPanel } from './panels/AdhocPanel'
import { FanoutPanel } from './panels/FanoutPanel'
import { isConfirmOpen } from './ConfirmDialog'
import { closePanelModal, usePanelModal } from './layout'

// Shim: HistoryPanel/AdhocPanel/FanoutPanel nao usam api; RunViewer usa updateParameters para navegar entre runs.
function makeFakeApi(onUpdateParams?: (p: Record<string, unknown>) => void) {
  return {
    setTitle: (_v: string): void => {},
    close: closePanelModal,
    updateParameters: (p: Record<string, unknown>): void => onUpdateParams?.(p),
    onDidTitleChange: () => ({ dispose: (): void => {} }),
    getParameters: () => ({}),
  } as unknown as import('dockview-react').IDockviewPanelProps<Record<string, unknown>>['api']
}

const _fakeContainerApi = {} as unknown as import('dockview-react').IDockviewPanelProps<Record<string, unknown>>['containerApi']

const TITLES: Record<string, string> = {
  run: 'Run',
  history: 'Runs',
  adhoc: 'Ad hoc run',
  fanout: 'Fan-out',
}

export function PanelModalHost() {
  const state = usePanelModal()
  // Tracks the current head run as RunViewer navigates follow-up runs.
  const runIdFromState = state?.kind === 'run' ? state.runId : undefined
  const [runHeadId, setRunHeadId] = useState<string | undefined>(runIdFromState)

  // Reset head to the freshly opened run each time openRun() is called with a new id.
  useEffect(() => {
    if (runIdFromState) setRunHeadId(runIdFromState)
  }, [runIdFromState])

  useEffect(() => {
    if (!state) return
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (isConfirmOpen()) return
      e.preventDefault()
      e.stopPropagation()
      closePanelModal()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [!!state])
  if (!state) return null

  const title = state.kind === 'run' ? state.title : TITLES[state.kind] ?? state.kind
  const fakeApi = makeFakeApi()
  const runFakeApi = makeFakeApi((p) => {
    if (typeof p.runId === 'string') setRunHeadId(p.runId)
  })

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closePanelModal()}>
      <div className="modal modal-wide" role="dialog" aria-label={title} aria-modal="true">
        <button className="modal-x" aria-label="Close" onClick={closePanelModal}>✕</button>
        {state.kind === 'run' && (
          <RunViewer
            params={{ runId: runHeadId ?? state.runId }}
            api={runFakeApi}
            containerApi={_fakeContainerApi}
          />
        )}
        {state.kind === 'history' && (
          <HistoryPanel
            params={{ routine: state.routine }}
            api={fakeApi}
            containerApi={_fakeContainerApi}
          />
        )}
        {state.kind === 'adhoc' && (
          <AdhocPanel
            params={{}}
            api={fakeApi}
            containerApi={_fakeContainerApi}
          />
        )}
        {state.kind === 'fanout' && (
          <FanoutPanel
            params={{}}
            api={fakeApi}
            containerApi={_fakeContainerApi}
          />
        )}
      </div>
    </div>
  )
}
