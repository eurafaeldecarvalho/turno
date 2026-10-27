import type { ReactElement } from 'react'
import { newAgentAsk } from './AgentFolderDialog'
import { useSettings } from './appearance'
import { openAdhoc, openAgentChat, openFanout, openRoutine, openTerminal } from './layout'
import { IconChat, IconFanout, IconFolder, IconRoutine, IconSpark, IconTerminal } from './icons'
import { shortcutFor } from './shortcuts'

// Pasta nova: o dialogo mora na sidebar; escondida (Ctrl+B), ela aparece antes de pedir
export function requestNewFolder(): void {
  if (document.querySelector('.sidebar')) return void window.dispatchEvent(new Event('turno:new-folder'))
  window.dispatchEvent(new Event('turno:toggle-sidebar'))
  setTimeout(() => window.dispatchEvent(new Event('turno:new-folder')), 150)
}

// Itens do menu "New": o mesmo no botao da sidebar e no "+" de cada painel (uma casa so para cada verbo).
// refId: aba de referencia para abrir ao lado dela (o "+" do grupo); sem ele, abre no grupo ativo.
export function NewItems({ onPick, refId }: { onPick: (run: () => void) => void; refId?: string }): ReactElement {
  const conns = useSettings()?.connections ?? []
  const endpoints = conns.filter((c) => c.kind === 'endpoint')
  const item = (label: string, icon: ReactElement, run: () => void, keys?: string): ReactElement => (
    <button key={label} role="menuitem" className="new-item" onClick={() => onPick(run)}>
      <span className="new-item-main">
        {icon}
        {label}
      </span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  )
  return (
    <>
      {item('Agent (best account)', <IconChat size={13} />, () => newAgentAsk({ refId }), shortcutFor('New agent'))}
      {item('Chat', <IconSpark size={13} />, () => openAgentChat(undefined, refId))}
      {item('Terminal', <IconTerminal size={13} />, () => openTerminal(undefined, {}, undefined, refId), shortcutFor('New terminal'))}
      {/* Claude Code num terminal, falando com cada conexao de modelo (Ollama, provedores do catalogo) */}
      {endpoints.map((c) => item(`Claude Code on ${c.name}`, <IconTerminal size={13} />, () => openTerminal(undefined, { profile: c.id, initialCommand: 'claude --chrome' }, undefined, refId)))}
      <div className="menu-sep" role="separator" />
      {item('Routine…', <IconRoutine size={13} />, () => openRoutine(null, 'New routine'))}
      {item('Ad hoc run…', <IconSpark size={13} />, () => openAdhoc(), shortcutFor('New ad hoc run'))}
      {item('Fan-out…', <IconFanout size={13} />, () => openFanout())}
      <div className="menu-sep" role="separator" />
      {item('Folder…', <IconFolder size={13} />, requestNewFolder)}
    </>
  )
}
