# Orca (stablyai/orca, MIT): reverse engineering of the AGENTS subsystem

Scope: supported agents, detection and launch, accounts and credentials, usage/limit tracking, session storage, resume and transfer, switching. Reusable patterns for the Turno "Agent" button (ranked sessions, auto-switch at the limit).

Sources:
- Source checkout: C:\rx\orca, HEAD fcac5cf0 (2026-10-21), package.json 1.4.214. Paths below are relative to C:\rx\orca\src.
- Shipped build: %LOCALAPPDATA%\Programs\orca\resources\app.asar, package.json **1.4.237**, extracted to C:\rx\orca-asar.
- REA on the shipped build: output in C:\rx\notes\raw\rea-orca-subset.json; summary in section 9.
- Docs: https://www.onorca.dev/docs/agents/{codex-hot-swap,usage-tracking,claude-code}

Legend:
- [V] = verified in source and present in the shipped asar (string grep)
- [D] = docs claim
- [U] = inference or not verified

Safety: nothing was run against real accounts. No Orca or cux process was launched. All analysis is static.

---

## 0. TL;DR

1. **Orca has NO automatic account switching or fallback at limits.**
   - grep for autoSwitch, rotate, "fallback account" etc. returned 0 hits in source and 0 in the asar.
   - The docs say switching is manual: from the status-bar chip or the usage roster [D].
   - What Orca does at a limit:
     - shows the limit and its reset time;
     - in native chat, a "Continue" button sends `Continue where you left off.` once the user has switched or waited (`shared/native-chat-usage-limit-cut.ts:11`).
2. Orca does have every building block an auto-switcher needs:
   - (a) multiple isolated accounts per provider: Claude and Codex fully; OpenCode/Devin via XDG homes; Antigravity native accounts; Grok/Cursor status only;
   - (b) live usage percentages per account: the Claude statusline hook (free, no quota) plus OAuth/backend usage endpoints for every provider;
   - (c) structured limit-hit events: Claude stream-json `rate_limit_event` / `api_error=usage_limit_reached`, Codex `account/rateLimits/updated` / `usageLimitExceeded`, ACP `stopReason: rate_limit`;
   - (d) "move the running session to the newly selected account" via kill + `claude --resume <id>` / `codex resume <id>`, after the turn ends;
   - (e) shared history across accounts, so a resume works under the other account.
3. Orca never switches **provider** inside a session. An `AgentSessionRecord` has one `provider` (`shared/agent-session-record.ts:148`). There is no cross-agent handoff/summary. Cross-agent continuity is the part Turno must build itself (see handoff.md T2).

---

## 1. Supported agents, detection, launch

### Catalog
- `shared/tui-agent-config.ts` (381 lines), types in `shared/tui-agent-config-types.ts`.
- 44 TUI agents, display names in `shared/tui-agent-display-names.ts:9-53`. The list (detectCmd → launch):

| Agent | detectCmd / launch |
|---|---|
| claude | `claude` |
| claude-agent-teams | `orca claude-teams` |
| codebuddy | |
| openclaude | |
| codex | |
| autohand | |
| ante | |
| trae | `traecli` |
| opencode | |
| opencode2 | `opencode2 --standalone` |
| mimo-code | `mimo` |
| pi | |
| omp | |
| prime-agent | |
| qoder | `qodercli` |
| qoder-cn | `qoderclicn` |
| gemini | |
| antigravity | `agy` |
| aider | |
| goose | |
| amp | |
| kilo | |
| kiro | `kiro-cli chat --tui` |
| crush | |
| aug | `auggie` |
| cline | |
| freebuff | |
| codebuff | |
| command-code | `command-code --trust` |
| continue | `cn` |
| cursor | `cursor-agent` |
| droid | |
| kimi | |
| mistral-vibe | `vibe` |
| qwen-code | `qwen` |
| rovo | `acli rovodev run` |
| hermes | `hermes --tui` |
| openclaw | |
| copilot | |
| grok | |
| muse | `muse --trust-workspace` |
| dsh | `dsh-tui .` |
| zcode | |
| devin | |
| jcode | |

- Per-agent config fields:
  - `detectCmd`, `detectCmdAliases`, `detectRequiredCommands`, `detectUnsupportedRuntimes`
  - `launchCmd`, `launchCmdByPlatform`
  - `expectedProcess`
  - `promptInjectionMode`: argv | flag-prompt | flag-prompt-interactive | flag-interactive | hermes-query | stdin-after-start
  - `draftPromptFlag`: claude `--prefill`
  - `preflightTrust`
  - paste-ready signals, and Windows Shift/Ctrl+Enter encodings.
- **Pattern for Turno:** a declarative agent table that covers detection, launch, prompt injection and resume.

### Detection
- `shared/tui-agent-detection-commands.ts:17-75` builds probe commands from the catalog.
- `main/preflight/agent-detection.ts` runs them on the host after hydrating PATH from the login shell (`detectInstalledAgentsWithShellPathHydration`) on local, WSL or SSH targets.
- IPC: `preflight:detectAgents`, `preflight:refreshAgents`, `preflight:detectRemoteAgents` [V shipped].
- Pure PATH lookup (`command -v`/`where`); no auth check.

### Trust preflight
- `main/agent-trust-presets.ts:10-28` pre-writes the agent's own "trusted folder" artifacts so the first-run trust menu doesn't eat a pasted prompt.
- Applies to cursor, copilot, codex, claude, antigravity and qoder.

### State detection (3 layers)
- **(a) Managed hooks.** Per-agent hook installers live in `main/agent-hooks/managed-agent-hook-registry.ts`; each agent's code is in `main/<agent>/hook-service.ts`.
  - Hooks POST to a loopback HTTP hook server, with the port and token in PTY env `ORCA_AGENT_HOOK_PORT/TOKEN`, `ORCA_PANE_KEY`.
  - Claude events: SessionStart, UserPromptSubmit, Stop, StopFailure, SubagentStop, PostCompact… (`main/claude/claude-managed-hook-events.ts`).
  - Hooks carry the **provider session id + transcript path**. These are what make resume possible (`main/agent-hooks/README.md`).
- **(b) OSC 7501** ("Program Status Protocol"): the agent prints its status into the terminal stream.
  - Claude ≥2.1.295, Grok, pi, omp and Codex send it.
  - It is a fallback; it has no session id. Same README, support matrix dated 2026-10-17.
- **(c) Screen/title rules.** `main/runtime/agent-state-rules/*.json` holds per-agent zod-validated rules: regex on title or screen regions → idle/working/blocked.
  - Example: `claude.json` = `✳` title glyph → idle.
  - Rules are live-updated from GitHub release assets (`agent-state-rules-live-update.ts:44`).
  - **None of the shipped rules detects usage-limit text** (grep "limit" in *.json = 0).

### Two execution surfaces

**(1) Terminal TUI**
- Runs in a PTY via node-pty plus an Orca daemon.
- The agent is typed or injected into a shell. A shell function wraps `claude` (see §2).
- Native-chat "view" over a TUI = parse the agent's transcript file and render it as chat. Supported for claude/openclaude/codex/grok/omp/opencode/opencode2/zcode (`shared/native-chat-agent-support.ts:6-15`).
  - Selector answers are sent as keystrokes (`shouldStepNativeChatAskAnswer`).

**(2) Structured sessions ("Chat UI"), with no terminal:**

Registry: `main/runtime/structured-agent-runtime-registrations.ts:157-170`. Kinds:

- **claude**: `@anthropic-ai/claude-agent-sdk` 0.3.284 (shipped package.json).
  - Uses `query()` with `pathToClaudeCodeExecutable`, i.e. the stream-json protocol over stdio (`main/claude/claude-stream-json-connection.ts:139-160`).
  - Options (`main/claude/claude-structured-launch-resolution.ts:70-77`): `includePartialMessages`, the `claude_code` system-prompt preset, `extraArgs {'replay-user-messages'}`, and `resume: <id>` or `sessionId: <id>` (:276-279).
  - Env is built explicitly: the SDK would otherwise inherit `process.env`, and the pinned CLAUDE_CONFIG_DIR must be the only home (:147-156).
- **codex**: `codex app-server` JSON-RPC over stdio (`main/codex/codex-structured-launch-resolution.ts:101`).
- **pi**: its own RPC.
- **acp**: Agent Client Protocol over stdio for 5 agents (`main/acp/acp-launch-specs.ts:348-354`):
  - grok: `grok agent [--always-approve] [--plugin-dir] stdio`
  - opencode: `opencode acp`, env `OPENCODE_CLIENT=acp`
  - opencode2
  - omp: `omp acp`
  - antigravity: `ANTIGRAVITY_ACP_COMMAND`
- An ACP spec declares (`acp-launch-specs.ts:110-172`):
  - command, args and env;
  - `authMethod` chooser: e.g. Grok picks `xai.api_key` if `XAI_API_KEY` is set, else `cached_token`, never interactive;
  - `loginCommand`;
  - **`account: AcpAccountBinding`**;
  - modelDiscovery, transcriptImport, sessionHistory and `resumePreference`.
- ACP session setup (`main/acp/acp-session-setup.ts:34-62`): `session/new`; for an existing id, `session/load` if the `loadSession` capability is present, else `session/resume`.
  - Antigravity prefers resume because load replays the whole conversation.
- `main/acp/acp-account-binding.ts:28-73`: the account is "one config dir named by an env var".
  - `directoryAccountBinding('GROK_HOME', ~/.grok)` and `PI_CODING_AGENT_DIR` for omp.
  - `hostFolderAccountBinding` makes a private Orca-owned folder (0700).
  - **Pattern:** `{pin: {accountHomeVariable}, resolve(), environment(home, env) => ({...env, [VAR]: path}), prepare()}`.

---

## 2. Claude: multiple accounts (the core mechanism)

Files: `main/claude-accounts/*` (≈9.1k LOC incl. tests).
- Entry: `service.ts` (ClaudeAccountService).
- Persistence: `claude-account-selection.ts`.
- Sign-in: `claude-account-registration.ts`.
- Launch routing: `runtime-auth-service.ts` + `claude-profile-router.ts`.
- Folder setup: `claude-profile-provisioning.ts`, `claude-profile-history.ts`, `claude-profile-sharing.ts`.

**Account = one CLAUDE_CONFIG_DIR.**
- Location: `<userData>/claude-profiles/<accountId>/home`, with an ownership marker at `<userData>/claude-profiles/<accountId>/profile.json` (`claude-profile-paths.ts` describeClaudeProfile, claudeProfileMarkerPath).
- The accountId is a random UUID.
- Note in the code: Claude names the macOS Keychain item from the exact CLAUDE_CONFIG_DIR text, so the path spelling must be canonical (`claude-profile-paths.ts` comment above describeClaudeProfile).
- On Windows/Linux the credentials are `.credentials.json` inside that dir [U for Windows, consistent with the provisioning skip list].

**Sign-in (registration)**
- `claude-account-registration.ts:49-72`: prepare the folder, then run hidden `claude auth login` with `CLAUDE_CONFIG_DIR=<folder>`. The browser opens and the link can be copied (`claude-login-session.ts`). A pasted-code variant exists for remote devices (`claude-pasted-code-login.ts`).
- `finish()` (:88-142) reads `<folder>/.claude.json` → `oauthAccount.{emailAddress, organizationUuid, organizationName}` (`claude-account-folder.ts:66-77`).
- Duplicate check: same email + org (`claude-duplicate-account.ts`, `isSameClaudeLogin` :54-64).
- Saved row in settings `claudeManagedAccounts[]`: `{id, email, organizationUuid, organizationName, managedAuthPath, managedAuthRuntime host|wsl, wslDistro, authMethod:'subscription-oauth', createdAt, updatedAt, lastAuthenticatedAt}`.
- Selection: `activeClaudeManagedAccountId` + `activeClaudeManagedAccountIdsByRuntime` (host plus one per WSL distro).
- A failed sign-in deletes the folder (:62-71).
- A folder becomes an account only once it holds a login, so an abandoned sign-in never shows as a row.

**Provisioning: how accounts coexist without losing config** (`claude-profile-provisioning.ts:266-318`)
- The default home (`~/.claude` or the user's CLAUDE_CONFIG_DIR) is the master copy. Each profile is refreshed from it:
  - Every **directory** in the default home is **linked**: junction on Windows (`claude-profile-sharing.ts:56`), symlink elsewhere. Examples: skills, agents, commands, plugins.
  - **Files** are **copied**, not linked, because a rename-replace save would cut a link (:60-63).
  - `CLAUDE.md` becomes a one-line import `@~/.claude/CLAUDE.md` (:24, :299).
  - `settings.json` is copied whole, Orca hook entries excluded (:171).
  - `.claude.json` is merged key-by-key, **minus account-bound keys**: `oauthAccount` and the model/org caches, the same list Claude's own logout resets (:129-160). Folder trust (`hasTrustDialogAccepted`) is preserved per project (:200-213).
- Never shared (the runtime-state list :30-95): `.credentials.json`, `.claude.json`, `sessions`, `statsig`, `cache`, `history.jsonl`, `daemon*`, `agent-memory*`, and every hidden entry.
- **History is linked the other way** (`claude-profile-history.ts:28-39`). These dirs inside each profile are junctions to the default home:
  - `projects, session-env, file-history, shell-snapshots, todos, paste-cache, tasks, plans, transcripts`
  - NOT `sessions` (the live-process registry).
  - Effect: every account sees every transcript, so `claude --resume <id>` works under any account. Prompt history (`history.jsonl`) is merged by `claude-profile-prompt-history.ts`.
- Safety detail: before deleting a profile, Orca unlinks the junctions first. A recursive delete that followed a junction would wipe the user's real history (`claude-account-folder.ts:172-199`).
- Setup runs in a worker thread (`claude-profile-setup-worker.ts`), one per account at a time; launches wait at most 5 s (`claude-profile-router.ts:44, 204-210`).

**Routing a launch to the selected account** (`claude-profile-router.ts`)
- **Pointer file** `<userData>/claude-profiles/selected-host` holds the selected profile home ('' = System default). It is written atomically (:162-174).
- Every terminal pane gets env:
  - `ORCA_CLAUDE_PROFILE_POINTER=<pointer path>`
  - `CLAUDE_CONFIG_DIR` + `ORCA_CLAUDE_INJECTED_CONFIG_DIR`
  - `ORCA_CLAUDE_USER_CONFIG_DIR` (the user's own value)
  - Code: :281-319; names in `shared/claude-profile-routing.ts`.
- A **shell function `claude`** injected into bash/zsh, fish and PowerShell (`shared/claude-shell-function.ts:11-120`) **re-reads the pointer on every invocation** and exports `CLAUDE_CONFIG_DIR` before calling the real binary.
  - Result: switching the account in the UI affects the next `claude` typed in an already-open terminal, with no respawn.
  - A CLAUDE_CONFIG_DIR the user set in that pane wins.
- Orca's own launches: `prepareLaunch()` (:183-211) refreshes the profile, then `preparation()` (:321-332) returns `{configDir, envPatch, provenance:'profile:<id>'|'system'}`.
- "System default" = the user's own `~/.claude` login.
- An account whose own folder has no login but whose email matches the System default "runs on System default" (`coveredBySystemDefault` :125-132), so legacy users aren't logged out.
- Shared env allow-list for remote/WSL hosts: only `CLAUDE_CONFIG_DIR`, `ORCA_CLAUDE_INJECTED_CONFIG_DIR`, `ORCA_CLAUDE_PROFILE_POINTER`, `CODEX_HOME`, all absolute paths (`shared/agent-launch-account-env.ts:16-59`). "A dropped home would start the agent under another account", so an invalid value is refused rather than dropped.

**IPC (shipped):** `claudeAccounts:add|list|select|remove|reauthenticate|cancelPendingLogin|waitForSignInLink`, `rateLimits:fetchInactiveClaudeAccounts`, `rateLimits:refreshClaudeForTarget`.

---

## 3. Codex, OpenCode/Devin, Antigravity, Grok/Cursor accounts

**Codex** (`main/codex-accounts/*`)
- Account = its own `CODEX_HOME` at `<userData>/codex-accounts/<id>/home` (`codex-managed-home-path.ts:18`), with `auth.json` inside.
- `runtime-home-service-managed-home.ts:127-140`: link the user's real `~/.codex` resources and mirror `config.toml` into the account home, never mutating `~/.codex`.
- Session bridge (:143-170): Codex's `/resume` only lists rollouts under the launch CODEX_HOME. Orca **hardlinks every other home's rollouts** into the selected account home, in the background after launch.
- Docs: switching is manual and "instant"; running sessions keep their account until restarted [D codex-hot-swap].
- Also a "reset credit" ledger: `rateLimits:consumeCodexResetCredit`, `codex-reset-credit-*`.

**OpenCode / Devin** ("managed data accounts", `main/managed-data-accounts/launch-environment.ts`)
- Account = `XDG_DATA_HOME`/`XDG_STATE_HOME` override.
- OpenCode additionally gets `OPENCODE_AUTH_CONTENT=''`, `OPENCODE_DB=opencode.db`, so inline auth cannot bypass the profile.

**Antigravity**
- `main/antigravity/native-account-*.ts`: native account store, credential backend and sign-in callback. Usage via `agy -p /usage --output-format json`, which spends no quota (`main/rate-limits/antigravity-usage-command.ts:6-18`).

**Grok, Cursor**
- Status only (`grokAccounts:getStatus`, `cursorAccounts:getStatus`). They use the agent's existing login.

**Structured chats pin their account**
- `shared/agent-session-account-home.ts:5-11`: the "Account root pinned at launch by the account selector, so a resume cannot drift to another login."
- ACP refuses to open a CLI copy of a chat under a different account (`main/acp/acp-conversation-copy.ts:18-22,146`).
- Claude structured chats, however, follow the current selection at the next spawn via `resolveClaudeStructuredLaunchHome` (`main/claude/claude-structured-launch-home.ts:12-32`).
  - The transcript-existence check under the new home decides `resume` vs a fresh `sessionId` (`claude-structured-launch-resolution.ts:221-260`).
  - This works because `projects/` is shared (§2).

---

## 4. Usage / limit tracking

Service: `main/rate-limits/service.ts` (thin facade over `service/*`, ≈22k LOC dir). Types: `shared/rate-limit-types.ts`.
- Window: `{usedPercent, windowMinutes 300|10080, resetsAt, resetDescription}`, plus buckets and extra-usage balance.
- Failure kinds: missing-credentials, stale-token, no-subscription, rate-limited, …

Polling (`service/service-types.ts:97-121`):
- default every 15 min;
- minimum 30 s;
- refetch debounce 5 min;
- stale after 30 min;
- live-Claude ingest dedupe 30 s.
- 429 Retry-After is honored (`service-fetch-policy.ts:42-72`).
- Inactive accounts are fetched when the switcher opens (`service-inactive-accounts.ts:8,87`).

Per-provider sources (endpoints verified in source; all present in the shipped asar):

| Provider | Source |
|---|---|
| Claude | `GET https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer <accessToken>`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: claude-code/2.1.0` (`claude-oauth-usage-request.ts:18,82-88`). Response: `five_hour`, `seven_day`, `fable_*`/`limits[] weekly_scoped`, `spend`, `extra_usage`. Token read from `<configDir>/.credentials.json` or the macOS Keychain (`claude-oauth-credentials.ts`). The endpoint 429s under polling, which is why the statusline path below exists. |
| Claude **live (free)** | Orca installs a managed **statusLine command** (`main/claude/statusline-script.ts`). Claude Code ≥2.1.80 pipes `rate_limits` (`five_hour`/`seven_day` `used_percentage`, `resets_at`) to it on every turn, piggybacked on Messages API responses. The script prints nothing (status line unchanged), throttles to one post per pane every 15 s, and only posts when the payload contains `"rate_limits"`. It curls `POST http://127.0.0.1:$ORCA_AGENT_HOOK_PORT/statusline/claude` with `paneKey`, `configDir=$CLAUDE_CONFIG_DIR` (→ attributes usage to the account), and the payload. Parser: `shared/claude-statusline-rate-limits.ts:1-80`. **Best near-limit signal for terminal Claude sessions; costs no quota.** |
| Codex | app-server JSON-RPC `account/rateLimits/read` (`codex-rpc-rate-limit-probe.ts:223`), plus `GET https://chatgpt.com/backend-api/wham/usage` (`codex-backend-usage-client.ts:69`). Live notification `account/rateLimits/updated` (`main/codex/codex-usage-limits.ts:14`). |
| Gemini | `POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota {project}` with the CLI's OAuth token (`gemini-usage-fetcher.ts:20,57-66`). |
| Antigravity | `agy -p /usage --output-format json`. |
| Grok | `https://cli-chat-proxy.grok.com/v1` (`grok-fetcher.ts:19`). |
| Kimi | `https://api.kimi.com/coding/v1` (`kimi-fetcher.ts:21`). |
| Cursor | cursor.com dashboard with the existing session (`cursor-fetcher.ts:18`). |
| OpenCode Go | `https://opencode.ai/zen/go/v1/usage` (cookie). |
| Others | MiniMax, ZCode/GLM coding plan, Muse (local logs). |

**Limit-hit events (structured chats)**
- Claude, `main/claude/claude-usage-limits.ts`:
  - `rate_limit_event.rate_limit_info {status: allowed|allowed_warning|rejected, rateLimitType five_hour|seven_day|seven_day_opus|seven_day_sonnet|overage, resetsAt (s), overageStatus}` (:53-57, :100-118);
  - assistant `api_error === 'usage_limit_reached'` with `api_error_params.rate_limit_info`, or `error === 'rate_limit'` (:59-77);
  - result with status 429 / `terminal_reason api_error` (:79-98).
  - **`allowed_warning` is a near-limit signal** that Orca records but does not act on.
- Codex, `main/codex/codex-usage-limits.ts`: error codes `usageLimitExceeded`/`rateLimitExceeded` (:15). Plan `free`/`go` uses a 30-day primary window (:73-78).
- ACP: `stopReason === 'rate_limit'` (`main/acp/acp-turn-failures.ts:100-121`).
- All of these map to one failure fact, `usageLimitReached {window: session|weekly|weeklyModel|credits, resetsAt}` (`shared/agent-session-usage-limit.ts`). The UI shows "{{agent}} hit its {{window}} limit." plus a Continue button.

Terminal TUI sessions: there is no screen-text limit detection. Usage comes only from the statusline (Claude) and polling.

---

## 5. Session storage, resume, transfer

**Provider session id capture:** hooks (SessionStart etc.) give `session_id` + `transcript_path`, stored as `providerSession {key: session_id|conversation_id, id, transcriptPath}` (`shared/agent-session-resume.ts:36-48`).

**Resume argv table** (`shared/agent-resume-argv.ts:6-81`):

| Agent | Resume argv |
|---|---|
| claude | `--resume <id>` |
| codex | `resume <id>` |
| cursor-agent | `--resume <id>` |
| gemini | `--resume <id>` |
| agy | `--conversation <id>` |
| opencode | `--session <id>` |
| pi | `--session <path>` |
| copilot | `--resume=<id>` |
| kimi | `--session <id>` |
| kiro-cli | `--resume-id <id>` |
| qwen | `--resume <id>` |
| droid | `--resume <id>` |
| grok | `--resume <id>` |
| devin | `--resume <id>` |
| omp | `--resume <file>` |
| muse | `resume <id>` |
| zcode | `--resume <id>` |
| dsh-tui | `--resume <id>` |
| jcode | `--resume <id>` |
| qodercli | `--resume <id>` |

- Fork (copy without a second writer, :85-92): `claude --resume <id> --fork-session`, `codex fork <id>`, `grok --resume <id> --fork-session`, `pi --fork <path>`.
- ACP `session/fork` for opencode/opencode2/omp (:98-102).

**Session history ("AI Vault")**
- `main/ai-vault/*` scans every agent's store read-only: `~/.claude/projects`, `~/.codex/sessions`, `~/.gemini/tmp`, `~/.gemini/antigravity-cli/brain`, `~/.copilot/session-state`, `~/.grok/sessions`, `~/.factory/sessions`, …
- It lists, searches, titles and prepares a resume (`aiVault:prepareSessionResume`).
- **Pattern:** a cross-agent session index. Reusable as Turno's source reader for building handoff summaries.

**Structured chat persistence**
- SQLite `agent-session-journal.db` (`main/native-chat/agent-session-journal/journal-host-database.ts:18`).
- `AgentSessionRecord` (`shared/agent-session-record.ts:144-160`): `{sessionId, location, provider, providerHandleChain[], providerContextBoundary, accountHome, launchDirectory, options, permissionMode, rewind…}`.
- **providerHandleChain** = one Orca session maps to a chain of native provider session ids, for clear, rewind and fork. Plus owner leases with fences and HMAC claims for single-writer safety.
- **Pattern for Turno lineage:** extend the chain to `{provider, account, nativeId, reason}` links.

**Moving a running session to another account** (renderer; manual trigger)
1. The user selects an account in `ClaudeSwitcherMenu`.
2. The setting `claudeAccountSwitchRunningSessions: 'ask'|'restart'|'keep'` applies (`shared/claude-account-switch-settings.ts`), with `ClaudeAccountSwitchDialog`.
3. `findMovableClaudeSessions` (`renderer/src/lib/claude-session-account-move.ts:180-219`):
   - local terminal panes with Claude in the foreground and a known providerSession;
   - the old account is inferred **from the transcript path prefix** `<CLAUDE_CONFIG_DIR>/projects/...` (:79-97).
4. `queuePaneAccountRestarts(ptyIds,'claude')`.
5. A Claude restart runs only when the pane is **not mid-turn** (`components/terminal-pane/pane-account-restart-readiness.ts:6-16`); Codex restarts at once.
6. The restart command comes from `buildAgentResumeStartupPlan`, which replays the recorded agentArgs/env (`renderer/src/lib/agent-account-restart-startup.ts:43-134`).
   - It is delivered at "shell-ready".
   - The old PTY is released and the replacement spawn names it, so main stops it before launching (`pane-restart-transport-handoff.ts:5-22`).
   - Same pane/tab, new process.
   - A hand-started Claude never gets default flags such as a permission bypass (:47-48).
7. The new launch reads the pointer, so it lands on the new CLAUDE_CONFIG_DIR. The shared `projects/` makes `--resume <id>` find the transcript.

---

## 6. Switching / fallback: what's missing

- No ranking, no auto-select by remaining quota. The usage roster only sorts providers "tightest limit first" for display [D].
- No pre-limit trigger. `allowed_warning` and statusline percentages are displayed only.
- No cross-provider continuation and no summary/handoff generation.
- The docs confirm all switching is manual [D usage-tracking, codex-hot-swap, claude-code].

---

## 7. Reusable patterns for Turno, with exact files (ideas; MIT, so code reuse with attribution is allowed)

1. **Per-account config dir plus a shared-history junction.** For Claude, create `profiles/<id>/home`. Junction `projects, session-env, file-history, shell-snapshots, todos, paste-cache, tasks, plans, transcripts` to `~/.claude`. Link the skill/agent/command dirs; copy settings.json; merge `.claude.json` minus `oauthAccount` etc.
   - Files: `claude-profile-provisioning.ts`, `claude-profile-history.ts`, `claude-profile-sharing.ts`, `claude-account-folder.ts`.
   - Note: writing inside `~/.claude` (the junction targets) is not needed. Orca only writes into the profile folders, which it owns.
2. **Sign-in into an isolated folder:** `CLAUDE_CONFIG_DIR=<new> claude auth login` (hidden), then read `.claude.json.oauthAccount.emailAddress` → account row. Codex: `CODEX_HOME=<new> codex login`. Agents with an ACP/env home: `GROK_HOME`, `PI_CODING_AGENT_DIR`, `XDG_DATA_HOME`.
3. **Pointer file plus a shell function**, so already-open terminals follow the selection (`shared/claude-shell-function.ts`). For Turno, which spawns the agent process itself, set env at spawn instead; a pointer isn't needed.
4. **Statusline usage feed** (`main/claude/statusline-script.ts` + `shared/claude-statusline-rate-limits.ts`). This is the cheapest accurate near-limit detector: per turn, per CONFIG_DIR, no API call.
   - Turno trigger example: `five_hour.used_percentage ≥ 90` or `seven_day ≥ 95` → prepare the handoff.
   - Caveat: it modifies the profile's settings.json `statusLine`. In Turno that is only acceptable for Turno-owned profile dirs; never for `~/.claude` without user consent.
5. **OAuth usage poll for idle/ranked accounts** (`claude-oauth-usage-request.ts`). Rank sessions by remaining % and reset time. Respect 429/Retry-After and poll ≥5–15 min.
6. **Structured limit events** (`claude-usage-limits.ts`, `codex-usage-limits.ts`, `acp-turn-failures.ts`). If Turno drives Claude via the Agent SDK (stream-json), `rate_limit_event` with `status: allowed_warning|rejected` gives an exact trigger and the reset time.
7. **Account-switch restart** = wait for turn end → kill → spawn `claude --resume <id>` in the same pane under the new home (`pane-account-restart-readiness.ts`, `agent-account-restart-startup.ts`, `shared/agent-resume-argv.ts`).
8. **Declarative agent catalog** (`shared/tui-agent-config.ts`) plus detection (`tui-agent-detection-commands.ts`) plus resume argv: a ready template for "connect all agents".
9. **ACP adapter with account binding** (`main/acp/acp-launch-specs.ts`, `acp-account-binding.ts`, `acp-session-setup.ts`): one code path for every ACP agent. See the ACP registry in `notes/raw/acp-registry.json` (other investigator).
10. **Session record with a provider-handle chain** (`shared/agent-session-record.ts`) → the Turno conversation lineage.

---

## 8. Risks / caveats observed in Orca's code comments

- Windows: deleting a profile must unlink junctions first (`claude-account-folder.ts:172-199`).
- The OAuth usage endpoint 429s under polling (`claude-statusline-rate-limits.ts:1-3`, `service-fetch-policy.ts:48`).
- A restart during a permission prompt or question drops it, hence "not mid-turn" (`claude-session-account-move.ts:66-70`).
- A resumed id in a home without its transcript: `--resume` exits, so Orca checks the transcript exists under the target home first (`claude-structured-launch-resolution.ts:218-233`).
- Codex `/resume` only sees rollouts under the current CODEX_HOME → hardlink bridge. The org-bound encrypted reasoning problem (handoff.md) is not addressed in Orca [U].

---

## 9. REA run on the shipped build

- Full asar (3762 JS files) was too slow. Started `npx -y rea-agents@latest analyze-javascript-application C:\rx\orca-asar --json`, then stopped it at about 340/3762 files.
- Re-ran on a subset: C:\rx\orca-asar-subset, the 5 shipped bundles that contain the account/usage strings, including `out/main/index.js` (5.8 MB) and `structured-agent-runtime-registrations-*.js`. Output: `C:\rx\notes\raw\rea-orca-subset.json` (66 MB).
- Results:
  - 819 main-process IPC handlers, 778 literal channels, 6 BrowserWindows;
  - limitation: "worker exhausted its heap" during the semantic phase on index.js, so the semantic graph is partial; the IPC inventory is complete.
- Account/agent channels confirmed shipped:
  - `claudeAccounts:{add,list,select,remove,reauthenticate,cancelPendingLogin,waitForSignInLink}`
  - `codexAccounts:{add,list,select,remove,reauthenticate,pendingLoginUrl,listStalePanes,forgetStalePanes,listRecordedPaneLanes}`
  - `rateLimits:{get,refresh,setPollingInterval,fetchInactiveClaudeAccounts,fetchInactiveCodexAccounts,refreshClaudeForTarget,refreshCodexForTarget,refreshGrok,refreshMiniMax,consumeCodexResetCredit}`
  - `grokAccounts:getStatus`, `cursorAccounts:getStatus`
  - `preflight:{detectAgents,refreshAgents,detectRemoteAgents}`
  - `aiVault:{listSessions,searchSessions,prepareSessionResume,…}`
  - `nativeChat:readSession`, `orcaProfiles:switch`
- No IPC channel for auto-switching or failover.
- String grep in the asar `out/` (count of files):
  - api/oauth/usage 1
  - ORCA_CLAUDE_PROFILE_POINTER 8
  - claude-profiles 3
  - selected-host 1
  - /statusline/claude 3
  - claudeAccountSwitchRunningSessions 2
  - "Continue where you left off." 2
  - wham/usage 1
  - retrieveUserQuota 1
  - usage_limit_reached 1
  - rate_limit_event 1
  - session-env 2
  - --fork-session 6
  - autoSwitch 0
- So the shipped 1.4.237 matches the source analysis.

Not verified:
- runtime behaviour of any of the above (no runs against accounts);
- Windows credential location inside the profile;
- whether Claude Code re-reads credentials per request (the cux claim).
