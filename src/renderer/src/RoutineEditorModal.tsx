import { useEffect } from 'react'
import { RoutineEditor } from './panels/RoutineEditor'
import { isConfirmOpen } from './ConfirmDialog'
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
  useEffect(() => {
    if (!state) return
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (isConfirmOpen()) return
      e.preventDefault()
      e.stopPropagation()
      closeRoutineEditorModal()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [!!state])
  if (!state) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeRoutineEditorModal()}>
      <div className="modal modal-wide" role="dialog" aria-label="Configure routine" aria-modal="true">
        <button className="modal-x" aria-label="Close" onClick={closeRoutineEditorModal}>✕</button>
        <RoutineEditor params={{ routineId: state.id }} api={_fakeApi} containerApi={_fakeContainerApi} />
      </div>
    </div>
  )
}
