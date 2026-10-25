// Atalhos do app numa lista so: a tela de boas-vindas, Settings › Shortcuts e a paleta de comandos leem daqui.
// Regra: atalhos do app usam Ctrl+Shift+letra (Ctrl+letra fica para o shell), layout usa Alt+Shift.
export interface Shortcut {
  keys: string
  label: string
  group: 'Workspace' | 'Panels' | 'Terminal'
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl+Shift+P', label: 'Command palette (Ctrl+K outside a terminal)', group: 'Workspace' },
  { keys: 'Ctrl+Shift+N', label: 'New agent (best account)', group: 'Workspace' },
  { keys: 'Ctrl+Shift+T', label: 'New terminal', group: 'Workspace' },
  { keys: 'Ctrl+Shift+R', label: 'New ad hoc run', group: 'Workspace' },
  { keys: 'Ctrl+Shift+J', label: 'Tasks', group: 'Workspace' },
  { keys: 'Ctrl+Shift+H', label: 'Runs (history)', group: 'Workspace' },
  { keys: 'Ctrl+,', label: 'Settings', group: 'Workspace' },
  { keys: 'F2', label: 'Rename the focused tab, routine or folder', group: 'Workspace' },
  { keys: 'Ctrl+B', label: 'Show or hide the sidebar (outside a terminal)', group: 'Workspace' },
  { keys: 'Alt+Shift+= / Alt+Shift+-', label: 'Split right / down', group: 'Panels' },
  { keys: 'Ctrl+Shift+M', label: 'Maximize or restore the pane', group: 'Panels' },
  { keys: 'Ctrl+Shift+W', label: 'Close the pane', group: 'Panels' },
  { keys: 'Ctrl+F', label: 'Find in terminal', group: 'Terminal' },
  { keys: 'Ctrl+Shift+A', label: 'Ask AI for a command', group: 'Terminal' },
  { keys: 'Ctrl+Shift+C / Ctrl+V', label: 'Copy / paste (Ctrl+Shift+V also pastes)', group: 'Terminal' },
  { keys: 'Shift+Enter', label: 'New line in the Claude Code prompt', group: 'Terminal' },
]

export const shortcutFor = (label: string): string | undefined => SHORTCUTS.find((s) => s.label.startsWith(label))?.keys
