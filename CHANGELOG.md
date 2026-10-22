# Changelog

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
