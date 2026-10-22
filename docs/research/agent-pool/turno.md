# Turno codebase map for the "Agent" multi-account / auto-rotation feature

Source: C:\Users\Rafael\Desktop\turno (READ ONLY; nothing edited). Version 0.7.2 (working tree, uncommitted), HEAD d3bda67 (v0.7.1).
Stack (package.json): electron 44.9.0, react 19.3.1, dockview-react 8.6.0, @xterm/xterm 6.0.0 (+fit/webgl/search/unicode11/ligatures/web-links), node-pty 1.1.0, electron-vite 6, vitest 5, zod 4, croner 10. SQLite via db.ts (node:sqlite style `db.prepare`, migrations by PRAGMA user_version).

## 0. Note about the relayed user request (window opacity)

The user request relayed with this task is about the Window opacity control (wanted finer steps, decimals, a number input). That change ALREADY EXISTS, uncommitted, in the working tree:
- src/renderer/src/panels/SettingsPanel.tsx ~L463-474: range `step={0.001}` (0.1%), plus `<NumInput min={30} max={100} step={0.1}>` showing `Math.round(t.windowOpacity*1000)/10` and writing `Math.round(v*10)/1000`; styles `.opacity-row`/`.opacity-num` added in styles.css.
- CHANGELOG.md 0.7.2 entry: "Window opacity moves in 0.1% steps and has a number field for the exact percentage, decimals included."
- Validation already allows any float: src/main/settings.ts L73 `windowOpacity: range(0.3, 1)`; main/index.ts L27 `clampOpacity` clamps 0.3..1; applied via `win.setOpacity` (index.ts L79, L283, L321, L330).
- Uncommitted diff also touches providers.ts (qwen default model `qwen3:14b`), sidebarStore.ts (no hardcoded `--model qwen3.6:35b`), ConnectionsSection.tsx, tests, package.json version.
This subagent did not edit anything.

## 1. Entry points to replace with "Agent"

Three hardcoded "Claude" launchers, all `openTerminal(..., { profile: 'claude-max', initialCommand: 'claude --chrome' })`:
- Sidebar nav: src/renderer/src/Sidebar.tsx L444-446 (`<IconChat /> Claude` under "Workspace" nav, next to "New terminal" L441).
- Group "+" dropdown: src/renderer/src/App.tsx `GroupActions` L185-245; menu items L216-224: Terminal `{}`, Claude `{profile:'claude-max', initialCommand:'claude --chrome'}`, Qwen `{profile:'qwen-local', initialCommand:'claude --chrome'}`. `openNew(params)` -> `openTerminal(undefined, params, undefined, ref)`.
- Welcome watermark: App.tsx L259-261.
- Keyboard: App.tsx L374-381 (Ctrl+Shift+T new terminal; no Claude shortcut). Shortcut list L266-274.
"Is agent" detection is duplicated heuristics: layout.ts L117 (`syncOpenTabs`: `profile==='claude-max' || /^claude\b/.test(initialCommand) || !!lastSession`) and App.tsx L111 (Tab icon). Sidebar.tsx L18-30 `llmLabel`, L42 `agentLine`, L46 `AGENT_SHORT`, L399-419 subtitle per tab. These must move to a single `agentOf(panel)` that reads an explicit `agent`/`accountId` param.

## 2. How terminals launch agents (current pipeline)

1. `openTerminal(dir?, params: TerminalParams, title?, refId?, fixedId?)` — src/renderer/src/layout.ts L187-205. Adds dockview panel `component:'terminal'`, `renderer:'always'` (keeps xterm alive when hidden), `params:{...params, kind:'terminal'}`; title counter label derived from profile (`qwen-local`->qwen, `claude-max`->claude).
   `TerminalParams` L31-39: shell, cwd, profile (connection id), initialCommand, itemId, lastCwd, lastSession (TermSession).
2. `TerminalPanel` — src/renderer/src/panels/TerminalPanel.tsx. Key design: terminal+pty are DECOUPLED from the panel (`TermHandle`, L28-44; `createTerm` L50-273). Handle can be parked/unparked (liveTerms.ts) and rebound to another panel (`bind`, L97-100).
   - pty creation L233-245: `window.turno.pty.create({shell,cwd,profile,cols,rows})` -> stores `ptyId` in closure (L64, `let ptyId`).
   - initialCommand L208-221: written to the pty after the shell prints its first output (+150 ms); if command starts with `claude`, calls `routines.prepareClaude(cwd, chrome)` first (main/claudeprep.ts: sets hasTrustDialogAccepted / Chrome onboarding in `~/.claude.json` or `$CLAUDE_CONFIG_DIR/.claude.json`).
   - `runCommand(cmd)` L93-95 writes `cmd+'\r'` into the pty (used by NL->command). This is the natural injection primitive.
   - `lastOutput()` L87-92: last 40 buffer lines, 4000 chars — a primitive for scraping limit messages from the screen.
   - OSC 9;9 handler L144-149 tracks cwd (shell integration injected in main/pty.ts L26-29 for pwsh, L40 for cmd).
   - session tracking: `pty.onSession` L222-226 -> `remember({lastSession})` -> `patchItem(itemId,{agent:'claude', sessionId, cwd})` (L135-143, hardcodes agent 'claude').
   - exit L227-232 writes "[process exited: N]" and marks dead. The *shell* is the pty process; the agent CLI is a child of the shell, so an agent exiting does NOT end the pty.
   - Shift+Enter -> writes `\x1b\n` (L249-251) for Claude multiline.
   - Cleanup L385-404: park if bound to a sidebar item, else dispose (kills pty).
3. Main side — src/main/pty.ts:
   - `pty:create` L48-70: `pty.spawn(shell, args, { name:'xterm-256color', cols, rows, cwd, env: childEnv({...providerEnv(profile), ...shellEnv}), useConpty:true })`. ids are a module counter `nextId`. `trackPty(id, pid)` for Claude session discovery.
   - `providerEnv(profile)` L33-36 = `resolveProviderEnv(getConnection(settings, profile), connectionToken(conn))` — NOTE uses tolerant `getConnection` (falls back to first connection / claude-max) for interactive terminals.
   - write/resize/kill IPC L71-80; `pty:memory` L81-109; `killAllPtys` L120-123 (called index.ts L91, L365).
   - Env cleaning: main/env.ts `childEnv` strips `CLAUDECODE`, `CLAUDE_CODE_*`, `ELECTRON_RUN_AS_NODE`. NOTE: this strips any CLAUDE_CODE_* the parent has, but extra env passed in `extra` wins. Also L67 `env.SystemRoot ??= 'C:\Windows'` — in a TS string `'\W'` is not an escape, so the fallback value is `C:Windows` (only matters if SystemRoot is unset; low impact, but a real bug).
4. Claude session discovery — src/main/termsessions.ts: watches `$CLAUDE_CONFIG_DIR/sessions` or `~/.claude/sessions/<pid>.json` (written by Claude Code: pid, sessionId, cwd, name, kind), walks the Win32_Process parent chain (PowerShell `Get-CimInstance`, L13-28, up to 12 levels L51) to map the claude pid to a pty shell pid, emits `pty:session` (ptyId, TermSession|null). Watcher is single and bound to ONE dir at first `trackPty` (L99-108): with per-account `CLAUDE_CONFIG_DIR` it will only watch the main process's dir -> must become a set of watchers (one per account config dir).
5. Sidebar items / presets — src/renderer/src/sidebarStore.ts:
   - `AGENTS` presets (L304-313 in printed listing; ~L165-175 in file): claude (`claude --session-id {id}` / `claude --resume {id}`, hasModel), claude-qwen, codex (`codex` / `codex resume {id}`), gemini (`gemini --resume {id}`, "check the resume command"), qwen-code, opencode (`opencode --session {id}`), custom. `AgentId` union in shared/types.ts L206.
   - `resolveCommand(item)` builds command; only Claude checks session existence (`sidebar.claudeSessionExists`).
   - `openItem(item)` — terminal items resume `claude --resume <id> --chrome`; chat items use resolveCommand; profile defaults to `qwen-local` for claude-qwen; fixed panel id `chat:<itemId>`.
   - Persistence: `%APPDATA%\turno\sidebar.json` via main/sidebar.ts (`getSidebar` with shape validation + `blocked` flag, `saveSidebar` -> writeJsonAtomic). `listClaudeSessions` (L74-113 of file) reads `projects/*/*.jsonl` heads under `$CLAUDE_CONFIG_DIR ?? ~/.claude` — single config dir assumption again.
6. Layout persistence: layout.ts L247-286, localStorage key `turno.layout.v1`; on save strips `initialCommand`, `autoStart`, `lastSession`; on restore closes `chat:*` and item-bound panels. So an "agent tab" will NOT survive restart unless its state lives in a sidebar item / a new store.

## 3. Connections / providers / secrets

- Type `Connection` (shared/types.ts L8-19): `{id, name, kind:'claude'|'endpoint', baseUrl?, model?, tokenRef?, token?, extraEnv?, bootCommand?, healthUrl?}`. Only TWO kinds; everything is "how to drive the `claude` binary". No notion of agent CLI, account, config dir, quota, priority.
- src/main/providers.ts: `DEFAULT_CONNECTIONS` (claude-max, qwen-local Ollama with `CLAUDE_CODE_MAX_CONTEXT_TOKENS`), `resolveProviderEnv` (claude kind -> only extraEnv; endpoint -> ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL + DEFAULT_*_MODEL + SUBAGENT_MODEL), `effectiveModel`, `findConnection` (strict), `getConnection` (tolerant fallback), `requireConnection` (throws; "money > convenience").
  -> `extraEnv` already allows `CLAUDE_CONFIG_DIR` per connection today (e.g. second Claude account) — but termsessions/sidebar/claudeprep/provider-auth read the main process env, not the connection's.
- src/main/settings.ts: `%APPDATA%\turno\settings.json`, cached; `clean()` validates; `validConn` L55-56 rejects unknown kinds (a new kind like 'codex' would be DROPPED and reported as bad shape -> must extend validConn and Connection.kind together; old app versions reading a new file would drop them too). `setSettings` merges `terminal` deeply but replaces `connections` wholesale.
- src/main/secrets.ts: `%APPDATA%\turno\secrets.json`, Electron safeStorage (DPAPI), map key->base64; refuses to store if encryption unavailable. `connectionToken(conn)`. Key naming `tokenKey(connId)` in index.ts L265-270.
- src/main/provider-auth.ts: `claude auth status|login|logout` with `childEnv()` only — no per-account `CLAUDE_CONFIG_DIR`. Needs an `env` param per account.
- src/main/doctor.ts: preflight `checkConnection` (claude: `claude --version` + auth status; endpoint: fetch healthUrl). IPC `provider:preflight` (index.ts L271).
- UI: src/renderer/src/panels/ConnectionsSection.tsx (list/add/edit, Claude connect/logout, preflight badges, token to vault); reducer/validation in src/renderer/src/connectionsStore.ts.

## 4. Routine runner, limits, abort policies

- src/main/runner.ts: `buildArgs` L46-63 (`claude -p --input-format stream-json --output-format stream-json --verbose --replay-user-messages --thinking-display summarized [--resume id] [--model] [--effort] --permission-mode ... [--permission-prompt-tool stdio | --permission-prompts none] [--allowedTools] --chrome|--no-chrome`).
  `startRun` L237-470: requireConnection, optional worktree isolation, writes runs/<id>/{events.ndjson, turno-events.ndjson, stderr.log, request.json}; spawns with `childEnv({...resolveProviderEnv(conn), TURNO_RUN_ID, TURNO_RUN_DIR})`; prompt via stdin stream-json (`writeUser` L147-150); line loop L350-401: tracks session_id, result cost/turns, threshold policies, `api_retry` 429 -> rateLimited, and `parseRateLimit(line)` -> if `rejected` and policy enabled -> `pauseUntil = resetsAt` and `stopRun`. `finish` L408-466 sets status paused/aborted/ok/rate_limited/failed and `resume_at`.
  `sendToRun` L176-182 (live message), `stopRun` L474-491 (control_request interrupt, then taskkill /T after 8 s).
- src/main/abort.ts: `AbortPolicy` (cost_usd, steps, duration_min, session_limit, weekly_limit); `RL_MAP {five_hour:'session_limit', seven_day:'weekly_limit'}`; `parseRateLimit` recursively finds an object with `rateLimitType`, returns `{rateLimitType, resetsAt, rejected: status==='rejected'}`. Comment: `allowed`/`allowed_warning` do NOT pause. => The "near limit" signal (`allowed_warning`) is already parsed but discarded; this is the cheapest near-limit trigger for Claude in headless mode. (Exact event schema not re-verified here; it matches what the code expects.)
- src/main/engine.ts: `resumePaused` L53-72 every 120 s (+ on startup L148) -> `followUp(runId, 'Usage limit reset. Continue...')`; `followUp` L305-356: live -> sendToRun, else new run with `--resume session_id`, same profile (requireConnection), cumulative cost via `priorCost(threadOf)`.
  => Today's limit strategy is PAUSE-and-wait on the SAME account. Rotation = instead of pausing, start a follow-up on another account. For Claude->Claude (same vendor, different CLAUDE_CONFIG_DIR) `--resume <session_id>` will NOT find the session in the other account's config dir (sessions live under `<configdir>/projects/<cwd-slug>/<id>.jsonl`) unless the jsonl is copied over (unverified whether Claude Code accepts a copied transcript; plausible since it is a local file, needs testing on a throwaway account).
- DB: src/main/db.ts `runs` table (+ parent_id, resume_at migrations; PRAGMA user_version). RunRecord has `profile` but no `account`.
- Fan-out (main/fanout.ts + run:fanout IPC index.ts L200) already runs one prompt across N connections — useful precedent for a multi-account picker.
- One-shot headless helper: main/ai.ts `suggestCommand` runs `claude -p` with all tools denied (`--permission-mode dontAsk --permission-prompts none`) for a connection — exact template for a "handoff summarizer" call (cheap model / local Qwen, tools disabled, transcript as input).

## 5. Run viewer / composer

- src/renderer/src/panels/RunViewer.tsx `Conversation` (~L368+): `useThread(head)` loads the chain of runs (parent_id thread); composer textarea L595-630; `send()` L469-487 -> `window.turno.run.send(last.id, text)` -> `followUp`; when mode==='followup' it moves `head` to the new run id (same view continues across processes). `resume()` L489-494 opens a terminal with `claude --resume <session_id>` on the run's profile.
  => The headless/chat path ALREADY implements "swap the underlying process while the same view stays open" (thread of runs, head moves). An account switch is just a follow-up run whose `profile/account` differs and whose first prompt is the handoff summary instead of `--resume`.

## 6. Proposed integration points

A. Data model (shared/types.ts + settings.ts)
- New `AgentAccount { id, agent: AgentKind ('claude'|'codex'|'gemini'|'qwen-code'|'copilot'|'kiro'|'opencode'|'endpoint'...), label, priority:number, enabled, configDir? (isolated), connectionId? (for endpoint-backed), env?, tokenRef?, plan?: 'free'|'pro'|..., limits?: {session?, weekly?}, state: {status:'ok'|'near'|'exhausted'|'auth', resetsAt?, lastCheck?} }`.
- Keep `Connection` for "how to talk to a model endpoint"; accounts reference it. Store accounts in a NEW file `%APPDATA%\turno\accounts.json` (jsonStore readJson/writeJsonAtomic + reportBadShape pattern, like sidebar.ts) rather than inside settings.json — avoids `validConn` dropping unknown kinds and avoids wholesale `connections` replacement races; runtime quota state in SQLite (new table `account_usage`, migration via user_version) so it is not rewritten on every tick.
- Extend `AgentId` union / AGENTS presets into an `AgentDriver` registry in main (not renderer): `{id, binary, newCmd, resumeCmd, envFor(account) (e.g. CLAUDE_CONFIG_DIR, CODEX_HOME, GEMINI_* ...), sessionLocator, limitDetectors, headlessArgs?}`. Per-agent env var names for isolation must be verified per CLI (Claude: CLAUDE_CONFIG_DIR is used by this codebase already; others unverified here).

B. Per-account isolated config dirs
- Main: `accountEnv(account)` merged in `pty:create` (pty.ts L58) alongside/instead of `providerEnv(profile)`; extend `PtyCreateOptions` with `accountId`. Same in runner.ts L304-309 and ai.ts.
- Fix single-dir assumptions: termsessions.ts `dir()` (L10) -> one watcher per configDir; sidebar.ts `projectsDir()` -> list/exists per account; claudeprep.ts `configFile()` -> take configDir argument (it WRITES `.claude.json`; must target the account's dir); provider-auth.ts -> pass env so `claude auth login/status` run per account (login is user-initiated; Turno must never script credentials).
- Dirs under `%APPDATA%\turno\accounts\<id>\` created by Turno; never touch `~/.claude` of the default account except via the existing prepareClaude behavior.

C. Agent button + picker
- Replace Sidebar.tsx L444-446, App.tsx L219-224 and L259-261 with one `openAgent(opts?)` in a new renderer module (e.g. agentStore.ts) that: asks main `agents:pick({agent?, cwd})` -> best account (enabled, not exhausted, highest priority), then `openTerminal(undefined, {kind:'terminal', agentSession: <brokerId>, accountId, profile, initialCommand}, ...)`. Picker = small menu (agent kinds + "Auto (best available)") reusing `new-term-dropdown` / `menuKeyNav` patterns. Add Settings > "Agents & accounts" section next to ConnectionsSection (drag to rank -> priority).

D. Limit monitor (main, new `limits.ts`)
- Sources, in order of reliability: (1) headless stream-json `rateLimitType` events (abort.ts parseRateLimit; use `allowed_warning` as "near"); (2) agent-specific local files/APIs (to be researched per CLI; e.g. usage/status commands) polled without spending quota; (3) interactive TUI screen scraping of known limit strings via a main-side tap on `pty.onData` (pty.ts L63) — strip ANSI, regex per driver; (4) process exit codes. Emit `agent:limit` IPC {accountId, level:'near'|'hit', resetsAt}. Persist to account state; `resumePaused`-style timer flips accounts back to ok after resetsAt.

E. Session broker (where the swap happens)
- Interactive terminal: the pty is the SHELL, the agent is its child. Cheapest swap that keeps the same tab AND xterm: keep the TermHandle, kill only the agent child (send Ctrl+C/`/exit`, or taskkill the agent pid found via the termsessions parent walk), then write a new command into the same pty. BUT the env (account isolation) is fixed at pty spawn -> swapping accounts needs either (a) prefixing the command with env (`$env:CLAUDE_CONFIG_DIR='...'; claude ...` in pwsh, `set X=... &&` in cmd — shell-specific, see shellArgs pty.ts L38-43), or (b) a new pty attached to the SAME TermHandle/xterm: add `TermHandle.swapPty(newOpts)` in TerminalPanel.tsx that kills old ptyId, creates a new one, keeps `term` (xterm scrollback stays visible), rewires `ptyId` (closure var L64 already supports reassign), writes a banner line ("switched to account X"), then sends the new agent command + injects the handoff. (b) is cleaner and shell-agnostic; (a) avoids a ConPTY respawn.
- Recommend a main-side `broker.ts` that owns `brokerSession {id, panelId, accountId, agent, cwd, transcriptRef, handoffs[]}` and exposes `broker:swap(brokerId, toAccountId?)`; renderer TerminalPanel subscribes and calls `swapPty`. Put the "agent tab" identity in panel params (`agentSession`) and persist broker sessions in SQLite so a restart can offer "resume on best account".
- Headless/chat path: reuse runner + followUp; add `followUp(runId, text, {accountId})` and an engine policy `rotate_on_limit` alongside `session_limit/weekly_limit` (abort.ts types + RoutineEditor UI). On `rejected` (or `allowed_warning` when "rotate early" is set): stop current run, generate handoff, start follow-up on next account WITHOUT `--resume` (different account/vendor) but with handoff prompt; RunViewer already follows `head` to the new run.

F. Handoff summary — where generated / injected
- Generate in main (new `handoff.ts`), modeled on ai.ts: input = transcript source per agent (Claude: `<configDir>/projects/<slug>/<sessionId>.jsonl`, located via termsessions TermSession.sessionId; headless: runs/<id>/events.ndjson / turno-events.ndjson which Turno already owns; fallback: xterm buffer via `lastOutput()` widened), + `git status/diff --stat` of cwd. Summarizer = a connection with tools disabled (`--permission-prompts none`), preferably local Qwen (no quota) or the NEXT account's model. Write to `%APPDATA%\turno\handoffs\<brokerId>-<n>.md`.
- Inject: interactive -> pass as the first prompt (many CLIs accept a positional prompt; else paste via `term.paste`/bracketed paste after the TUI is ready — readiness detection is per driver), or point the agent at the file ("Read <path> and continue"), which avoids pasting large text through ConPTY. Headless -> the follow-up prompt text (stdin stream-json, no size issue).
- "Detect near-limit, summarize ahead of time": precompute/refresh the handoff when `near` fires, so the swap at `hit` is instant.

## 7. Risky areas

- pty lifecycle: ptyId is a closure variable in createTerm (TerminalPanel.tsx L64) and all listeners filter by it (L210, L223, L228); a swap must update it atomically, ignore the old pty's late `pty:exit` (currently would print "[process exited]" and set `dead=true` -> `alive()` false -> park/unpark logic disposes the handle, L330-333, L399). Add a generation counter.
- Initial command timing: sent 150 ms after first shell output (L213-220) — fragile for agent TUIs; injection of a handoff into an agent TUI needs per-driver "ready" detection.
- ConPTY: resize reflow issues already worked around (refit ignores <20 cols/<4 rows L105-106; `windowsPty` option L58; debounce L363-367). Killing/respawning a ConPTY under the same xterm may leave screen state (alt-screen from TUI) — send `\x1b[?1049l` / reset before reattaching. node-pty 1.1.0 `useConpty:true` hardcoded.
- Process tree: interactive agent is a grandchild; `pty:kill` only kills the shell; runner uses `taskkill /T /F` (runner.ts L21-33). Broker should kill the tree.
- termsessions: PowerShell CIM process scan (20 s timeout) on every unknown session; single watcher/dir; agent hardcoded 'claude'.
- Persistence files: `%APPDATA%\turno\settings.json` (connections replaced wholesale; `validConn` drops unknown kinds; `blocked` mode), `sidebar.json` (blocked mode; item kinds whitelist `KINDS` L15 of sidebar.ts), `secrets.json` (DPAPI, non-atomic writeFileSync), localStorage `turno.layout.v1` (strips lastSession/initialCommand), SQLite runs DB (migrations by index), runs/<id>/ dirs (pruned per routine). Old builds reading new files will drop unknown fields/kinds.
- claudeprep.ts writes the user's real `~/.claude.json` (trust flags); with per-account dirs it must write the account's `.claude.json` — and never touch other agents' configs.
- Money guard: interactive path uses tolerant `getConnection` (falls back to first connection). Rotation logic must use strict lookups (`requireConnection` philosophy) so a removed account never silently falls back to a paid one.
- env.ts strips `CLAUDE_CODE_*` from parent env (fine), and has the `'C:\Windows'` escape bug (L10 of env.ts).
- ToS: rotating several accounts/free tiers of one vendor to evade per-account limits may violate provider terms; the design should keep it user-driven and transparent (not verified per vendor here).

## 8. File index (all under C:\Users\Rafael\Desktop\turno\src)
main: pty.ts, termsessions.ts, providers.ts, settings.ts, secrets.ts, provider-auth.ts, doctor.ts, claudeprep.ts, env.ts, runner.ts, abort.ts, engine.ts (resumePaused/followUp), ai.ts (one-shot claude -p), fanout.ts, db.ts, sidebar.ts, index.ts (IPC L199-337, lifecycle L91/L365/L388)
preload: index.ts (pty API L16-23)
renderer: App.tsx (GroupActions/"+" menu, Welcome, shortcuts), Sidebar.tsx (nav button L444), layout.ts (openTerminal, persistence), sidebarStore.ts (AGENTS, resolveCommand, openItem), liveTerms.ts (park/unpark), panels/TerminalPanel.tsx, panels/RunViewer.tsx (Conversation/composer), panels/ConnectionsSection.tsx, connectionsStore.ts, panels/SettingsPanel.tsx
shared: types.ts (Connection L8, RunRequest ~L79, AbortPolicy ~L97, RunRecord ~L111, PtyCreateOptions ~L143, AgentId L206, TermSession L208, SidebarItem L215)
