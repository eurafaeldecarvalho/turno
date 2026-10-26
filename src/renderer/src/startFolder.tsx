import { useEffect, useState } from 'react'
import { startFolderLabel } from '../../shared/agents'
import { updateSettings, useSettings } from './appearance'

// Pasta inicial do agente (Settings › Agents e rodape): onde o Agent/Chat abre quando a origem nao pede uma pasta.
export async function chooseStartFolder(): Promise<void> {
  const dir = await window.turno.ui.pickFolder()
  if (dir) await updateSettings({ agentStartDir: dir })
}
export const resetStartFolderToHome = (): Promise<boolean> => updateSettings({ agentStartDir: '' })

// Pasta salva que sumiu (renomeada/apagada): o agente abriria na home sem avisar
export function useStartFolderMissing(dir: string): boolean {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    if (!dir) return setMissing(false)
    void window.turno.ui.fileExists(dir).then((ok) => setMissing(!ok))
  }, [dir])
  return missing
}

export function StartFolderCard() {
  const s = useSettings()
  const dir = s?.agentStartDir ?? ''
  const missing = useStartFolderMissing(dir)
  if (!s) return null
  return (
    <section className="card" id="settings-agent-start">
      <h3>Start folder</h3>
      <label className="field">
        <span>Where a new agent or chat opens (Tasks and sidebar folders still open in their own folder)</span>
        <div className="row">
          <input className="mono grow" readOnly value={dir || 'Home folder'} title={dir || 'Your home folder'} aria-label="Agent start folder" />
          <button className="btn" onClick={() => void chooseStartFolder()}>Browse…</button>
          {dir && (
            <button className="btn ghost" onClick={() => void resetStartFolderToHome()}>
              Use home
            </button>
          )}
        </div>
      </label>
      {missing && <small className="tone-warn">This folder wasn't found; agents open in your home folder until you pick another.</small>}
      <p className="muted small">Also changeable from the status bar: click the folder ({startFolderLabel(dir)}) at the bottom.</p>
    </section>
  )
}
