import { SHORTCUTS } from './shortcuts'

// Paginas e itens do Settings: a navegacao da esquerda, a busca e a paleta de comandos leem daqui.
export type SettingsPage = 'general' | 'appearance' | 'terminal' | 'notifications' | 'shortcuts' | 'agents' | 'connections' | 'mcp' | 'integrations' | 'routines' | 'about'
export type SettingsGroup = 'App' | 'AI' | 'Work' | 'About'

export interface PageDef {
  id: SettingsPage
  label: string
  group: SettingsGroup
  description: string
}

export const GROUPS: SettingsGroup[] = ['App', 'AI', 'Work', 'About']

export const PAGES: PageDef[] = [
  { id: 'general', label: 'General', group: 'App', description: 'Startup and keeping the computer awake while agents work.' },
  { id: 'appearance', label: 'Appearance', group: 'App', description: 'Theme, interface font and window opacity.' },
  { id: 'terminal', label: 'Terminal', group: 'App', description: 'How new and open terminals look and behave.' },
  { id: 'notifications', label: 'Notifications', group: 'App', description: 'Windows notifications and alerts on your phone.' },
  { id: 'shortcuts', label: 'Shortcuts', group: 'App', description: 'Every keyboard shortcut in Turno.' },
  { id: 'agents', label: 'Agents & accounts', group: 'AI', description: 'Accounts per agent, their order and when Turno switches to the next one. Used by the Agent button.' },
  { id: 'connections', label: 'Connections', group: 'AI', description: 'Where routines and ad hoc runs get their model: Claude, local models and providers from the catalog.' },
  { id: 'mcp', label: 'MCP servers', group: 'AI', description: 'Tools agents can use, set up once and picked per folder and per routine.' },
  { id: 'integrations', label: 'Integrations', group: 'Work', description: 'Where Tasks come from: GitHub and Jira.' },
  { id: 'routines', label: 'Routines', group: 'Work', description: 'Where your routines live.' },
  { id: 'about', label: 'About Turno', group: 'About', description: 'Version, release notes and the setup tour.' },
]

export interface SettingItem {
  label: string
  page: SettingsPage
  card?: string
  anchor?: string // id do card para rolar ate ele
  keywords?: string
}

export const ITEMS: SettingItem[] = [
  { label: 'Start with Windows', page: 'general', card: 'Startup', anchor: 'settings-startup', keywords: 'login boot tray autostart' },
  { label: 'Keep the computer awake', page: 'general', card: 'Background', anchor: 'settings-background', keywords: 'sleep power awake coffee' },
  { label: 'Color theme', page: 'appearance', card: 'Theme', anchor: 'settings-theme', keywords: 'dark light colors dracula nord' },
  { label: 'Interface font', page: 'appearance', card: 'Interface', anchor: 'settings-interface', keywords: 'ui font family' },
  { label: 'Interface size', page: 'appearance', card: 'Interface', anchor: 'settings-interface', keywords: 'zoom scale text size' },
  { label: 'Window opacity', page: 'appearance', card: 'Window', anchor: 'settings-window', keywords: 'transparency transparent' },
  { label: 'Terminal font', page: 'terminal', card: 'Font and cursor', anchor: 'settings-terminal-font', keywords: 'mono family size line height letter spacing weight' },
  { label: 'Cursor style and blink', page: 'terminal', card: 'Font and cursor', anchor: 'settings-terminal-font', keywords: 'block bar underline' },
  { label: 'Minimum contrast', page: 'terminal', card: 'Font and cursor', anchor: 'settings-terminal-font', keywords: 'contrast padding bold bright' },
  { label: 'Default shell', page: 'terminal', card: 'Behavior', anchor: 'settings-terminal-behavior', keywords: 'powershell cmd bash wsl pwsh' },
  { label: 'Scrollback', page: 'terminal', card: 'Behavior', anchor: 'settings-terminal-behavior', keywords: 'history lines buffer' },
  { label: 'Copy on select', page: 'terminal', card: 'Behavior', anchor: 'settings-terminal-behavior', keywords: 'clipboard right-click paste' },
  { label: 'Font ligatures', page: 'terminal', card: 'Behavior', anchor: 'settings-terminal-behavior' },
  { label: 'Phone notifications (ntfy)', page: 'notifications', card: 'Phone notifications', anchor: 'settings-ntfy', keywords: 'ntfy server topic push mobile test' },
  { label: 'Keyboard shortcuts', page: 'shortcuts', anchor: 'settings-shortcuts', keywords: `keys hotkeys keybindings command palette ctrl+k ${SHORTCUTS.map((s) => `${s.keys} ${s.label}`.toLowerCase()).join(' ')}` },
  { label: 'Switch thresholds', page: 'agents', card: 'Agents and accounts', anchor: 'settings-agents', keywords: 'limit usage 5-hour weekly percent quota' },
  { label: 'Which account goes first', page: 'agents', card: 'Agents and accounts', anchor: 'settings-agents', keywords: 'ranking strategy headroom reset order' },
  { label: 'Add or remove an account', page: 'agents', card: 'Agents and accounts', anchor: 'settings-agents', keywords: 'sign in login claude codex gemini copilot kiro' },
  { label: 'Claude connection', page: 'connections', card: 'Connections', keywords: 'login subscription cli' },
  { label: 'Add a provider from the catalog', page: 'connections', card: 'Connections', keywords: 'openrouter groq mistral ollama lm studio vllm deepseek api key endpoint model omniroute free local' },
  { label: 'MCP servers', page: 'mcp', anchor: 'settings-mcp', keywords: 'tools sentry atlassian bitbucket github playwright secrets' },
  { label: 'Jira', page: 'integrations', card: 'Jira Cloud', anchor: 'settings-jira', keywords: 'atlassian tasks token issues' },
  { label: 'GitHub issues', page: 'integrations', card: 'GitHub', anchor: 'settings-github', keywords: 'gh tasks issues' },
  { label: 'Routines folder', page: 'routines', card: 'Routines folder', anchor: 'settings-routines-folder', keywords: 'path directory routine.md' },
  { label: "What's new", page: 'about', anchor: 'settings-about', keywords: 'release notes changelog version' },
  { label: 'Setup tour', page: 'about', anchor: 'settings-about', keywords: 'onboarding intro welcome' },
]

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Busca simples: todas as palavras digitadas precisam aparecer no item (rotulo, card, pagina ou palavras-chave)
export function searchSettings(q: string): SettingItem[] {
  const words = norm(q).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const pageLabel = (id: SettingsPage): string => PAGES.find((p) => p.id === id)?.label ?? ''
  return ITEMS.filter((it) => {
    const hay = norm(`${it.label} ${it.card ?? ''} ${pageLabel(it.page)} ${it.keywords ?? ''}`)
    return words.every((w) => hay.includes(w))
  })
}

export const isPage = (v: unknown): v is SettingsPage => PAGES.some((p) => p.id === v)
