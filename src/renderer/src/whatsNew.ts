// Novidades por versao (mais nova primeiro). A tela "What's new" mostra as versoes que o usuario ainda nao viu.
// Ao lancar uma versao, adicione uma entrada aqui com o que muda para quem USA o app (nao detalhes internos).
export interface ReleaseNotes {
  version: string
  items: Array<{ title: string; text: string }>
}

export const WHATS_NEW: ReleaseNotes[] = [
  {
    version: '0.9.14',
    items: [{ title: 'Search for a font', text: 'In Settings, type in the font field to filter the suggested and installed fonts, each shown in its own style. Installed fonts now show up on Linux too.' }],
  },
  {
    version: '0.9.13',
    items: [{ title: 'Choose where agents open', text: 'Pick a start folder for new agents and chats in Settings › Agents & accounts, or click the folder in the status bar.' }],
  },
  {
    version: '0.9.12',
    items: [{ title: 'Tidier account list', text: 'The Subscription/API badge and "opens next" now sit side by side in Agents & accounts.' }],
  },
  {
    version: '0.9.11',
    items: [
      { title: 'API connections in the ranking', text: 'Cohere, OpenRouter and other API connections now appear in Agents & accounts with an API badge. When your subscriptions hit their limit, the conversation continues on the next connection in the ranking.' },
      { title: 'Your e-mail on the Claude account', text: 'The default sign-in now reads "Claude · your e-mail" instead of "default sign-in".' },
      { title: 'Click Claude Code menus', text: 'Separate Claude accounts follow your ~/.claude/settings.json, so with "tui": "fullscreen" you can click menu options with the mouse.' },
      { title: 'Terminals open with your shell', text: 'New terminals use the system default shell, and a shell saved from another computer no longer stops terminals from opening.' },
    ],
  },
  {
    version: '0.9.10',
    items: [
      { title: 'Nothing you type gets lost', text: 'Keys typed right after opening a tab or asking to switch accounts now reach the new agent, and the text in Claude\'s input box moves with you to the new account.' },
      { title: 'Safer paste', text: 'Pasting several lines into a shell asks first, a single line never runs by itself, and pasted text can\'t carry hidden control keys. Right-click no longer pastes twice in Claude Code.' },
      { title: 'Smarter "account available again"', text: 'Only when a higher-ranked account truly reset, one dialog at a time, and a busy tab waits for its turn to end.' },
    ],
  },
  {
    version: '0.9.9',
    items: [
      { title: '"Needs you" clears when seen', text: 'Click the entry or go to its tab and it leaves the sidebar. A new request from that agent shows up again.' },
    ],
  },
  {
    version: '0.9.8',
    items: [
      { title: 'Time until reset', text: 'The status bar shows how long until the 5-hour and 7-day limits of the active account reset, next to the usage percentage.' },
    ],
  },
  {
    version: '0.9.7',
    items: [
      { title: 'See and switch the active account', text: 'The status bar shows the account your agent tab is on, with its usage. Click it — or use "Switch account to …" in the command palette — to move the conversation to another account.' },
      { title: 'Back to your preferred account', text: 'When a higher-ranked account resets its limit, Turno asks whether to move your agent tabs back to it.' },
      { title: 'Typing during a switch is safe', text: 'What you type while an agent restarts on another account is held and delivered once it is ready, instead of breaking the command.' },
      { title: 'Shift+Enter and Ctrl+V', text: 'Shift+Enter adds a new line in the agent prompt, and Ctrl+V pastes text instantly.' },
      { title: 'Normal permissions by default', text: 'Claude Code opened by Turno no longer starts in bypass permissions mode.' },
      { title: 'Real spend only', text: 'Subscription runs no longer count as spend in the status bar.' },
    ],
  },
  {
    version: '0.9.6',
    items: [
      { title: 'Steadier account switching', text: 'A late usage report from an account the app already switched away from no longer brings it back too early — a limited account stays out of rotation until it truly resets.' },
      { title: 'Clearer skips for pinned routines', text: 'A routine set to one specific Claude account now says so and skips if that account is missing or not signed in, instead of failing mid-run.' },
    ],
  },
  {
    version: '0.9.5',
    items: [
      { title: 'Theme names', text: 'Two color themes were renamed to "Carbon Dark" and "Carbon Light". Your current theme is unchanged.' },
    ],
  },
  {
    version: '0.9.4',
    items: [
      { title: 'Sharper app icon', text: 'The taskbar and app icon are crisp at every size now, with a proper multi-size Windows icon.' },
      { title: 'Linux fixes', text: 'Terminal session detection and per-terminal memory now work on Linux (they were Windows-only before).' },
    ],
  },
  {
    version: '0.9.3',
    items: [
      { title: 'Detects newly installed agents', text: 'Install an agent CLI while Turno is open and it shows up when you open the Add account dropdown — no restart needed. Grok now has an install link too.' },
    ],
  },
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
      { title: '196 model providers', text: 'Settings › Connections › Add from catalog: Groq, OpenRouter, Mistral, DeepSeek, LM Studio, vLLM and more. OpenAI-format providers work with Claude Code through a built-in translator.' },
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
