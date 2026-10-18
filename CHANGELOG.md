# Changelog

## 0.2.0 (unreleased)

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
