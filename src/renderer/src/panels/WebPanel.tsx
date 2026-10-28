import { createElement, useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'

// Aba com um <webview> do Electron: abre uma pagina (ex.: o dashboard de um gateway como o OmniRoute) DENTRO do Turno,
// em vez do navegador do sistema. partition persistente => o login no painel do gateway sobrevive entre reaberturas.
// webviewTag e ligado em main/index.ts (webPreferences). Barra simples: recarregar e, se preciso, abrir no navegador.
export function WebPanel({ params }: IDockviewPanelProps<{ url: string }>) {
  const url = params.url
  const ref = useRef<HTMLElement>(null)
  const reload = (): void => {
    const w = ref.current as unknown as { reload?: () => void } | null
    w?.reload?.()
  }
  return (
    <div className="webpanel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="webpanel-bar" style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 8px' }}>
        <button className="btn ghost small" onClick={reload} title="Reload">↻</button>
        <span className="muted small mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
        <button className="btn ghost small" onClick={() => void window.turno.ui.openExternal(url).catch(() => {})}>Open in browser</button>
      </div>
      {createElement('webview', { ref, src: url, partition: 'persist:turno-web', style: { flex: 1, border: 'none', background: '#fff' } })}
    </div>
  )
}
