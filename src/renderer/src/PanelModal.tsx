import { useEffect, useRef, useState } from 'react'
import { RunViewer } from './panels/RunViewer'
import { HistoryPanel } from './panels/HistoryPanel'
import { AdhocPanel } from './panels/AdhocPanel'
import { FanoutPanel } from './panels/FanoutPanel'
import { useModalLayer } from './modalStack'
import { closePanelModal, openHistory, usePanelModal } from './layout'
import { IconChevron, IconClose } from './icons'
import { useStore } from './store'

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
  // follow-up navegado dentro da run aberta; so vale para a run de origem (trocar de run zera sem esperar um efeito)
  const [nav, setNav] = useState<{ from: string; head: string }>()
  const runHeadId = runIdFromState && nav?.from === runIdFromState ? nav.head : runIdFromState
  const setRunHeadId = (id: string): void => void (runIdFromState && setNav({ from: runIdFromState, head: id }))


  // Run aberta a partir de Runs: Esc e "Runs" voltam para a lista em vez de fechar tudo.
  const back = state?.kind === 'run' ? state.back : undefined
  const goBack = (): void => (back ? openHistory(back.routine, true) : closePanelModal())
  const box = useRef<HTMLDivElement>(null)
  const layerKey = state ? `${state.kind}:${state.kind === 'run' ? state.runId : ''}` : undefined
  const z = useModalLayer(!!state, goBack, box, layerKey)
  // nome atual da rotina da run (renomeada/corrigida no disco depois de aberta)
  const liveName = useStore((s) => {
    const r = runIdFromState ? s.runs.find((x) => x.id === runIdFromState) : undefined
    return r?.routine ? s.routines.find((x) => x.id === r.routine)?.config.name : undefined
  })
  if (!state) return null

  const title = state.kind === 'run' ? (liveName ?? state.title) : TITLES[state.kind] ?? state.kind
  const fakeApi = makeFakeApi()
  const runFakeApi = makeFakeApi((p) => {
    if (typeof p.runId === 'string') setRunHeadId(p.runId)
  })

  return (
    <div className={`modal-backdrop ${state.kind === 'adhoc' || state.kind === 'fanout' ? 'modal-backdrop-top-anchored' : ''}`} style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), closePanelModal())}>
      <div ref={box} tabIndex={-1} className={`modal modal-wide ${state.kind === 'history' || state.kind === 'run' ? 'modal-xl modal-tall' : ''}`} role="dialog" aria-label={title} aria-modal="true">
        <button className="modal-x" aria-label="Close" onClick={closePanelModal}><IconClose size={14} /></button>
        {(state.kind === 'adhoc' || state.kind === 'fanout' || state.kind === 'history') && (
          <header className="modal-title">
            <h2>{title}</h2>
          </header>
        )}
        {back && (
          <header className="modal-title modal-back-bar">
            <button className="btn ghost small" onClick={goBack}>
              <IconChevron size={14} className="flip" /> Runs
            </button>
          </header>
        )}
        {state.kind === 'run' && (
          <RunViewer
            key={state.runId}
            params={{ runId: runHeadId ?? state.runId }}
            api={runFakeApi}
            containerApi={_fakeContainerApi}
          />
        )}
        {state.kind === 'history' && (
          <HistoryPanel
            params={{ routine: state.routine, keepFilter: state.keepFilter }}
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
