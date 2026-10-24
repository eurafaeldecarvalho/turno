// Novidades por versao (mais nova primeiro). A tela "What's new" mostra as versoes que o usuario ainda nao viu.
// Ao lancar uma versao, adicione uma entrada aqui com o que muda para quem USA o app (nao detalhes internos).
export interface ReleaseNotes {
  version: string
  items: Array<{ title: string; text: string }>
}

export const WHATS_NEW: ReleaseNotes[] = [
  {
    version: '0.9.2',
    items: [
      { title: 'Choose which account a routine uses', text: 'Each routine can run on the account ranking, your default sign-in, or one specific Claude account — picked right in the routine Connection card.' },
    ],
  },
  {
    version: '0.9.1',
    items: [
      { title: 'Install agents from Add account', text: 'Agents & accounts lists every multi-account agent, even ones you have not installed. Pick one and Turno runs its official CLI install in a terminal (Codex, Gemini, Copilot, OpenCode…); Kiro opens its install page.' },
      { title: 'Runs badge clears when seen', text: 'The failures badge in the sidebar goes away after you open Runs, and comes back only for new failures.' },
    ],
  },
  {
    version: '0.9.0',
    items: [
      { title: 'One New menu, clearer sidebar', text: 'The "New agent" button opens everything you can create: agent, chat, terminal, routine, ad hoc run, fan-out, folder. The + of every pane has the same items (opening next to that pane). Your folders live in one Folders group.' },
      { title: 'Settings in categories, with search', text: 'General, Appearance, Terminal, Notifications, Shortcuts, Agents & accounts, Connections, MCP servers, Integrations, Routines. Press Ctrl+F inside Settings to search.' },
      { title: 'Command palette', text: 'Ctrl+Shift+P (or Ctrl+K outside a terminal) finds any action, tab, routine or setting.' },
      { title: '196 model providers', text: 'Settings › Connections › Add from catalog: Groq, OpenRouter, Mistral, DeepSeek, LM Studio, vLLM and more (catalog from OmniRoute). OpenAI-format providers work with Claude Code through a built-in translator.' },
      { title: 'Smarter account switching', text: 'Pick which account goes first (list order, most quota left, resets soonest), and use an account again right away with "Use it now".' },
    ],
  },
  {
    version: '0.8.0',
    items: [
      { title: 'Agent button with ranked accounts', text: 'Works with 40+ agent CLIs, and you can add several accounts of Claude Code, Codex, Gemini, Copilot, Kiro, OpenCode and Grok. Rank them, and the Agent button opens the best one with quota left. Near the limit, the tab moves to the next account without losing the conversation.' },
      { title: 'Chat tab', text: 'A structured Claude chat that continues on the next account when one hits its limit.' },
      { title: 'Tasks', text: 'Your GitHub issues and Jira Cloud tasks in one list. Start one in its own worktree with an agent.' },
      { title: 'MCP servers', text: 'Set up MCP servers once and pick them per folder and per routine, with secrets kept in the Windows encrypted store.' },
    ],
  },
  {
    version: '0.7.3',
    items: [
      { title: 'A quick tour', text: 'New installs get a short setup: agents, look and terminal, routines, running in the background and notifications. Reopen it any time from Settings.' },
      { title: "What's new", text: 'After each update, this screen lists what changed.' },
    ],
  },
  {
    version: '0.7.2',
    items: [
      { title: 'Local model follows your settings', text: 'Qwen terminals and items use the model set in Settings › Connections instead of a fixed one.' },
      { title: 'Finer window opacity', text: 'Adjust it in 0.1% steps or type the exact percentage.' },
    ],
  },
  {
    version: '0.7.1',
    items: [
      { title: 'Draggable dialogs', text: 'Move any dialog by its top edge. Dialogs open below the title bar, and window opacity only applies to the main screen.' },
      { title: 'Cleaner sidebar', text: 'Routines show only their schedule; open tabs and folder items show agent · model · effort.' },
    ],
  },
]

const parts = (v: string): number[] => v.split('.').map((n) => Number(n) || 0)
export const newerThan = (a: string, b: string): boolean => {
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

// Notas que o usuario ainda nao viu (ate a versao instalada). seen vazio = so a versao atual.
export function unseenNotes(seen: string, current: string): ReleaseNotes[] {
  return WHATS_NEW.filter((r) => !newerThan(r.version, current) && (seen ? newerThan(r.version, seen) : r.version === current)).slice(0, 3)
}
