import { RoutineEditor } from './panels/RoutineEditor'
import { useRef } from 'react'
import { useModalLayer } from './modalStack'
import { IconClose } from './icons'
import { closeRoutineEditorModal, useRoutineEditorModal } from './layout'

const _fakeApi = {
  setTitle: (_v: string): void => {},
  close: closeRoutineEditorModal,
  onDidTitleChange: () => ({ dispose: (): void => {} }),
  getParameters: () => ({}),
} as unknown as import('dockview-react').IDockviewPanelProps<{ routineId: string | null }>['api']

const _fakeContainerApi = {} as unknown as import('dockview-react').IDockviewPanelProps<{ routineId: string | null }>['containerApi']

export function RoutineEditorModalHost() {
  const state = useRoutineEditorModal()
  const box = useRef<HTMLDivElement>(null)
  const z = useModalLayer(!!state, closeRoutineEditorModal, box)
  if (!state) return null
  return (
    <div className="modal-backdrop" style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), closeRoutineEditorModal())}>
      <div ref={box} tabIndex={-1} className="modal modal-wide" role="dialog" aria-label="Configure routine" aria-modal="true">
        <button className="modal-x" aria-label="Close" onClick={closeRoutineEditorModal}><IconClose size={14} /></button>
        <RoutineEditor params={{ routineId: state.id }} api={_fakeApi} containerApi={_fakeContainerApi} />
      </div>
    </div>
  )
}
