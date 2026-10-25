# Changelog

## 0.9.9 (2026-10-25)

### Sidebar
- "Needs you" entries clear once you've seen them: clicking the entry, going to its tab, or clicking or typing in that tab removes it. A new request from the same agent (another permission, another question) shows up again.

## 0.9.8 (2026-10-25)

### Status bar
- The active account shows the time left until each usage window resets, next to its percentage: `5h 40% (2h 13m) · 7d 12% (3d 4h 10m)`. The countdown updates on its own, and the account switch menu shows the same for every account.

## 0.9.7 (2026-10-25)

### Accounts
- The status bar shows the active account — the one the focused agent tab runs on (or the one the next agent would use) — with the usage of that account only. Click it to switch the tab to another account.
- New "Switch account to …" commands in the command palette (Ctrl+Shift+P, type "switch"): the focused agent tab moves to the chosen account and the conversation continues there. A tab in the middle of a turn asks first.
- When a higher-ranked account comes back from its limit, Turno asks whether to move the agent tabs on lower-ranked accounts back to it. A tab in the middle of a turn switches when the turn ends.
- Switching an agent tab whose conversation has no messages yet opens a fresh session on the new account instead of failing with "No conversation found".

### Terminal
- Typing while Turno restarts an agent on another account (or while it opens a new one) no longer corrupts the command: keystrokes are held and delivered to the agent once it's up.
- Shift+Enter inserts a new line in the agent prompt again; before, the Enter also went through and sent the prompt.
- Ctrl+V pastes the clipboard text right away. It used to send a raw Ctrl+V to the program, which made Claude Code look for an image in the clipboard (slow) and never paste the text.
- Claude Code opened by Turno starts in the normal permission mode, even if your Claude settings default to bypass permissions.

### Status bar
- Spend only counts pay-as-you-go API usage. Runs on a subscription plan no longer record a cost (and past runs were cleaned up).
- The terminal count and RAM were removed from the status bar.

## 0.9.6 (2026-10-24)

### Accounts
- A late or out-of-turn usage report can no longer bring an account back into rotation after the app has already moved past it: a just-limited account stays out until it really resets, and only the live tab that owns an account updates that account's usage.
- Routines pinned to one specific Claude account are pre-checked — if that account was removed or is not signed in, the run skips with a clear reason instead of failing partway.

## 0.9.5 (2026-10-24)

### Housekeeping
- Documentation and in-app text cleanup. Two color themes were renamed to "Carbon Dark" and "Carbon Light" (your current theme is preserved). Third-party attributions are consolidated in CREDITS.md.

## 0.9.4 (2026-10-24)

### Cross-platform
- The app/taskbar icon is now crisp at every size — the icon generator was aliasing a 256px image; it now renders anti-aliased and ships a multi-size Windows `.ico`.
- Linux: terminal session detection (which Claude Code session runs in each terminal) and per-terminal memory now work — both were Windows-only and silently did nothing on Linux. `SystemRoot` is no longer added to child processes off Windows.

## 0.9.3 (2026-10-24)

### Agents & accounts
- Detects agent CLIs installed after Turno was already open: detection reads the current system PATH (not the one captured at launch), and the "Add account" dropdown re-checks when you open it — no restart needed.
- Grok shows an Install link in "Add account", like the other agents.

## 0.9.2 (2026-10-24)

### Routines
- Pick the Claude account per routine: the account ranking (best available, switches at the limit), the default sign-in, or one specific account. The account choice now lives in the routine's Connection card — Connection and Accounts are no longer two separate cards — and the editor layout is tidier, without the empty gap.

## 0.9.1 (2026-10-24)

### Agents & accounts
- "Add account" now lists every multi-account agent, not only the installed ones. Pick one that isn't installed and Turno shows a notice and an **Install** button that runs the official CLI install in a terminal (Claude Code, Codex, Gemini, Copilot, OpenCode); Kiro opens its install page.

### Runs
- The failures badge in the sidebar clears once you open Runs, and comes back only for runs that fail afterwards.

## 0.9.0 (2026-10-23)

### Navigation
- Sidebar: a "New agent" split button opens the New menu (agent, chat, terminal, Claude Code on each connection, routine, ad hoc run, fan-out, folder, and each account). The + of every dock pane has the same items.
- Destinations Tasks and Runs; user folders grouped under Folders; Open tabs collapsed by default; Help menu in the footer (palette, shortcuts, tour, What's new, About).
- Settings is a two-pane window with categories (App, AI, Work, About) and search (Ctrl+F). Keep awake and window opacity moved into Settings; Jira also lives in Settings › Integrations.
- Command palette: Ctrl+Shift+P anywhere, Ctrl+K outside a terminal. New shortcuts: Ctrl+Shift+N (new agent), Ctrl+Shift+R (ad hoc run), Ctrl+Shift+J (Tasks).
- A render error shows a recovery panel instead of a blank window.

### Providers
- Settings › Connections › Add from catalog: 196 API-key, free and local providers, with search and filters.
- Built-in local translator so Claude Code can use OpenAI-format providers: tools, images and streaming are translated; the provider key stays in Turno (the agent only gets a local address). Retries with max_completion_tokens when a provider rejects max_tokens; long local generations allowed (30 min).
- Anthropic's own API key is sent the way the API expects (x-api-key).

### Accounts
- Which account goes first: list order, most quota left, or the one that resets soonest.
- Limit messages of non-Claude CLIs are classified (limit, credits, suspended) and their reset time is read (at most 5 hours); "Use it now" clears a limit by hand.

## 0.8.0 (2026-10-22)

### Agents and accounts
- The sidebar "Claude" button is now "Agent": opens the best-ranked account that still has quota. Catalog of 44 agent CLIs.
- Several accounts per agent (Claude Code, Codex, Gemini, Copilot, Kiro, OpenCode, Grok), each in its own config folder; Claude accounts share history with ~/.claude.
- Ranking and thresholds (5-hour 90%, weekly 95%) in Settings › Agents and accounts. Usage shows in the status bar.
- Automatic switch: near the limit the tab moves to the next account at the end of the turn (same agent resumes the same conversation; another agent gets a handoff note). At the hard limit it switches immediately. With no account left, the session waits for the reset.
- Tab status dots and a "Needs you" list in the sidebar (permission requests, finished turns).
- Chat tab: structured Claude chat that continues on the next account at the limit.

### Tasks
- GitHub issues (via `gh`) and Jira Cloud (e-mail + API token) in one list. Start a task in a new worktree branch with the agent of your choice.

### MCP
- MCP hub in Settings: presets for Sentry, Atlassian, Bitbucket, GitHub (read-only), Playwright, or custom. Secrets stay in the Windows encrypted store and reach the agent only through the environment.
- Per folder (folder menu › Agent setup) and per routine: MCP servers and a short context card. Routines can use the account pool and strict MCP.

### Changed
- Turno no longer accepts Claude Code's "trust this folder" prompt for you. It only copies a trust you already gave to an extra account, so a cloned repo's hooks can't run without Claude asking first.
- Prompts that Turno types on a command line drop the characters `$`, backtick, `%` and `!` (the shell could run them). Task titles and issue text never go on the command line; they stay in the task file.
- Folder fields in the Chat tab and in folder items accept pasted "Copy as path" values and need a full path. Checking a network folder no longer freezes the app.
- Accounts, MCP servers and the context card only apply to Claude connections; routines using a sandbox skip with a clear reason when they also use them.

## 0.7.3 (2026-10-21)

- Setup tour on first launch, in 5 skippable steps:
  - Agents: detects the agent CLIs on your PATH, shows the Claude sign-in and picks the local Ollama model from the installed ones.
  - Look and terminal.
  - Routines folder.
  - Running in the background: start with Windows, keep awake.
  - Notifications: Windows and ntfy, with a test.
  Reopen it from Settings.
- "What's new" after each update; also in Settings.
- Fix: SystemRoot fallback path for child processes.

## 0.7.2 (2026-10-21)

- Fix: Qwen (local Ollama) terminals and "Claude Code with local Qwen" items no longer force a hardcoded model with `--model`. The model always comes from the connection's settings (passed to Claude Code through the connection's environment), so changing the model in Settings › Connections takes effect. New installs default to `qwen3:14b`.
- Window opacity moves in 0.1% steps and has a number field for the exact percentage, decimals included.

## 0.7.1 (2026-10-21)

- Modals can be dragged by their top strip. While a modal is open the title bar no longer drags the window, and a dragged modal is pulled back into view if the window shrinks.
- Modals open below the title bar, so the system minimize/maximize/close buttons never sit on top of them.
- Window opacity applies only to the main screen: the window turns fully opaque while a modal is open.
- Sidebar: routines show only their schedule/state; Open tabs and folder items show agent · model · effort.

## 0.7.0 (2026-10-21)

### Interface
- Sidebar regrouped into Workspace and Automation, with Settings in the footer. Open tabs can be dragged into folders; hover actions no longer cover names; long names show a tooltip.
- Settings: two-column layout, aligned Connections card, and a theme picker that previews each theme on hover. Interface size now scales every piece of text.
- Readable status colors (≥ 4.5:1) in every theme; new contrast tests guard the theme list.
- One modal system for all dialogs: Escape closes the top one, focus is trapped inside and returns to whoever opened it; shortcuts pause behind modals.
- Terminal Find shows the match count and highlights the current match in a strong color; Find and the ask-AI bar fit narrow panes and keep their text.
- Run viewer: reply box grows with the text, drafts are kept per run, scroll position survives resizes, tab switches and moves; skipped runs name the routine that held the lock.

### Safety and data
- Routine editor never overwrites an external edit (content compare-and-swap) and never rewrites a ROUTINE.md it couldn't read; renaming or toggling a broken routine from the sidebar is refused.
- settings.json and sidebar.json are written atomically. A damaged, locked or wrongly shaped file is backed up once, reported, and never silently replaced with defaults.
- Connection tokens only change after the connection list is saved.
- Windows-reserved folder names (con, nul, com1…) are rejected; a terminal that can't start says why instead of showing a blank tab.

### Release
- GitHub Actions builds Windows (NSIS) and Linux (AppImage, deb, rpm) natively on each `v*` tag.

## 0.6.1 (2026-10-20)

- Fix: the installed app opened to a blank window. The sidebar's connections selector returned a new empty array on every snapshot before settings loaded, which sent `useSyncExternalStore` into an update loop (React error #185) and unmounted the UI.
- Fix: the installer ignored `electron-builder.yml` because `package.json` also had a `build` block, so the app and tray icons were missing from installed builds. The config now lives only in `electron-builder.yml` (Windows and Linux).

## 0.2.0 (2026-10-18)

- Drag a terminal tab onto a sidebar folder to keep it as an item. The item follows the terminal's current folder (shell integration via OSC 9;9) and the Claude Code session running in it. Clicking the item reopens `claude --resume <last session>` in that folder, or a shell there.
- Terminals opened from sidebar items keep updating their item, so a new session (for example after `/clear`) is remembered.
- Rename folders and items in place with a double click.
- The whole app is now in English. Routine files keep accepting the Portuguese day names and `notify` values from 0.1.0.

## 0.1.0 (2026-10-18)

First public release.

### Routines
- One folder per routine with `ROUTINE.md` (YAML frontmatter + prompt) and a form-based editor for days, times, model, effort, permission mode, tools, Chrome, locks, timeouts, catch-up and precheck.
- Scheduler (croner) with time zones and catch-up of the latest missed slot after sleep or reboot. Catch-up never runs slots from before the routine was turned on.
- Profiles: Claude Code with your subscription, or a local model (`qwen3.6:35b`) through Ollama's Anthropic-compatible endpoint. Turno starts Ollama if it is down.
- Named locks (`chrome`, `gpu`, custom) with queue/skip policy. Skip reasons are recorded in the history.
- Timeout, idle watchdog and a clean stop: an `interrupt` control request first, then `taskkill /T` on the whole process tree.
- SQLite run history with a status filter, a per-routine filter, retention of 200 runs per routine, and the raw event stream for each run.
- Importer for Claude Code Desktop scheduled tasks. Routines come in disabled.

### Live chat
- Each run is shown as a chat with collapsed thinking ("Thought for Ns"), grouped tool calls with expandable input/output, and run durations.
- Messages sent during a run go to the live process stdin (stream-json). After the run ends they continue the session with `--resume`.
- *Ask* permission mode: inline Allow / Allow for session / Deny cards (`--permission-prompt-tool stdio`) with a notification.

### Workspace
- xterm.js + node-pty (ConPTY) terminals in dockview. Panes split by dragging onto a drop compass, with header buttons or with shortcuts, and the layout is saved between launches.
- Terminal search, clickable links, Unicode 11, bracketed paste, copy-on-select, right-click paste and Shift+Enter for Claude Code.
- Sidebar with collapsible sections and folders of agent chats (Claude Code, Codex, Gemini CLI, Qwen Code, OpenCode, custom command) and links.
- 10 themes, UI and terminal fonts chosen from the installed system fonts, and default shell detection.
- Status bar with "keep the computer awake" modes (on / while agents work / off), also available in the tray menu.
- Tray icon, start with Windows, single instance, Windows toasts and ntfy push notifications.
