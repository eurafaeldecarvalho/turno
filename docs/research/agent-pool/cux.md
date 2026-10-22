# cux reverse-engineering notes (inulute/cux v0.4.1, 2026-09-23, GPL-3.0)

Source: C:\rx\cux (shallow clone, 1 commit `4408a4d chore: release v0.4.1`). Go, ~15k LOC non-test.
License: GPL-3.0-only. We describe IDEAS only. Do NOT copy code or strings into Turno.
Legend: [V] verified in code or primary doc; [D] Anthropic doc; [S] secondary/third-party; [U] unverified or inferred, not run.
Nothing was executed against real accounts. cux was not run. Only the source was read.

---

## 1. Architecture in one paragraph
`cux` is a parent wrapper around the real `claude` binary. It is found via `CUX_CLAUDE_BIN` or `exec.LookPath("claude")` (cmd/cux/main.go:1472).
- The wrapper sets `CUX_WRAPPED=1` and `CUX_WRAPPER_PID=<pid>` in the child's env (internal/wrapper/wrapper.go:502-506).
- `cux setup` installs six Claude Code hooks into `~/.claude/settings.json`, keyed by signature: the command contains `cux `.
- The hooks call `cux hook <name>`. That writes JSON "signal files" to `<cuxroot>/runtime/signals/{wrapperPID}-{name}`.
- The wrapper polls those files every 100 ms (wrapper.go:57; signals/signals.go:1-15).
- Hooks are no-ops unless `CUX_WRAPPED` is set (hooks.go:1-12). So a plain `claude` run is unaffected.

Hooks installed (internal/hookinstall/hookinstall.go:37-42; matcher ".*"):
| Event | cux subcmd | timeout s | purpose |
|---|---|---|---|
| UserPromptSubmit | prompt-submit | 20 | handle /switch, /cux:*, pre-turn threshold swap in place, "human present" clock |
| UserPromptExpansion | prompt-expansion | 5 | intercept Claude Code's internal `/rate-limit-options` |
| Stop | stop | 10 | "turn finished, transcript flushed", then refresh usage and evaluate threshold |
| StopFailure | rate-limit | 5 | classify hard limit vs API failure |
| SessionStart | session-start | 5 | capture session_id, cwd, source; on `source=resume`, inject "all exhausted" context |
| PostToolUseFailure | rate-limit | 5 | strong-phrase-only limit detection |

## 2. Credentials: where each account lives
- **Live** credentials are wherever Claude Code reads them (internal/creds/creds.go:1-25):
  - macOS: Keychain generic password. The services tried are `"Claude Code-credentials"` and also `"Orca Claude Code Managed Credentials"` (creds.go:61-64). Note: this is Orca's item name. The live item is chosen by content, i.e. the one carrying `claudeAiOauth.accessToken` (issue #42).
  - Linux and Windows: the file `~/.claude/.credentials.json`, mode 0600 (creds.go:720-739). Writes are atomic: tmp + fsync + rename (internal/atomicfile).
  - Anthropic's docs confirm it for Windows: credentials are in `%USERPROFILE%\.claude\.credentials.json`, a file, NOT Credential Manager. Also: "If you've set the CLAUDE_CONFIG_DIR environment variable, Claude Code keeps the .credentials.json file under that directory instead". The macOS keychain entry is keyed per dir. [D] https://code.claude.com/docs/en/authentication#credential-management
- **Identity**: the `oauthAccount` block inside `~/.claude/.claude.json`, with fallback `~/.claude.json` (internal/claudecfg/claudecfg.go, paths.go:52-62). cux rewrites only that key and keeps the rest as raw JSON.
- **Per-account backups** (creds.go:155-170, 741-899):
  - Linux: `~/.local/share/cux/accounts/NN-email/credentials.json` (0600).
  - macOS: Keychain service `cux-backup`, account `account-<slot>-<email>`. It shells out to `security` because go-keyring has a ~3 KB limit there.
  - **Windows: Windows Credential Manager via zalando/go-keyring v0.2.8**, service `cux-backup`.
    - go-keyring on Windows rejects secrets > 2560 bytes (`ErrSetDataTooBig`) [V] https://raw.githubusercontent.com/zalando/go-keyring/master/keyring_windows.go
    - cux works around the size limit on macOS but not on Windows.
    - The `.credentials.json` blob also holds `mcpOAuth` for every authenticated MCP server [S: ccdaddy docs via search; cux creds.go:778-783 says the same]. So on Windows, `cux add` can probably fail for users with several MCP OAuth logins. [U, inferred]
  - The oauthAccount block is backed up as `accounts/NN-email/oauth.json`.
  - `CUX_CREDS_BACKEND=file` forces file storage (meant for tests).
- **CLAUDE_CONFIG_DIR is NOT used.** cux always targets `$HOME/.claude` (paths.go:49-50). The env var appears only in error hints (switcher.go:92, main.go:691). Consequence: one live login per machine. Swapping changes the account for EVERY `claude` process using `~/.claude`, wrapped or not. cux treats this as a feature: "credentials are global and claude re-reads them per request" (park.go:12-16).
- Contrast: Orca, cx (Mike-7777777) and `cswap run` isolate per terminal with a per-account CLAUDE_CONFIG_DIR plus shared or symlinked `projects/` (see handoff.md and §9).

### Swap transaction (internal/switcher/switcher.go `SwitchTo`)
1. Take the file lock `<root>/.lock` (flock or LockFileEx, 10 s timeout).
2. Read and validate the target backup before touching anything live. It must contain `claudeAiOauth.accessToken`. Then read the target oauth.json.
3. Back up the current live blob into its slot, because Claude Code may have rotated or refreshed it. Skip this if the token fingerprint (sha256) already sits under another slot (anti-corruption, issues #46 and #42).
4. `WriteLive(target)`, then `WriteOAuthBlock(target)`. Roll back both on failure.
5. Save state.json (`ActiveSlot`). If that save fails after the live write, it reports "swap complete but state save failed".
- **Token refresh by cux itself** (creds.go:72-81, 407-499; monitor.go:290-385):
  - It POSTs `https://platform.claude.com/v1/oauth/token` with `grant_type=refresh_token` and Claude Code's public client_id `9d1c250a-e61b-44d9-88ed-5944d1962f5e`, "extracted from the Claude Code binary".
  - It refreshes when expiry is less than 5 min away.
  - It writes the new blob to the backup, and to the live file if that account is active (`syncLiveIfActive`).
  - Risk: refresh tokens may be single-use. cux refreshing a token that Claude Code is also refreshing could race. Also a ToS gray zone (cux impersonates Claude Code's OAuth client). [U]
- `claude logout` revokes the token, so the backup dies (it shows `EXPRD`). The README says to use `claude login` only, never `logout`.

## 3. Hard-limit detection (reactive)
Primary source: StopFailure hook.
- Anthropic doc: StopFailure fires "when the turn ends due to an API error".
- Input: `error` ∈ {`rate_limit`, `overloaded`, `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `billing_error`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `cloud_credential_error`, `unknown`}, plus optional `error_details` (e.g. `"429 Too Many Requests"`) and `last_assistant_message`, which for StopFailure is the rendered error string (e.g. `"API Error: Rate limit reached"`).
- Output and exit code are ignored. It is side-effect only. [D] https://code.claude.com/docs/en/hooks (StopFailure section)

cux classifier (internal/hooks/hooks.go:1031-1243):
- Only `error`, `error_details` and `last_assistant_message` are searched. `tool_input` and the full payload are not. Both string and `{type,message}` shapes are accepted (`extractErrorText`).
- Guard 1, foreign content: reject if the text contains `url: http`, `<!doctype`, `<html`, `<head`, `<body` (WebFetch output).
- Guard 2, denylist: `do not retry`, `concurrent subagent(s)`, `context window/length`, `maximum context`, `token limit`, `output limit`, `output token`, `max tokens`, `character limit`, `file size`, `recursion limit`. Issue #39: a broad "limit reached" match killed 20 subagents.
- Strong phrases, accepted on any event including PostToolUseFailure: `usage limit`, `session limit`, `hit your limit`, `reached your limit`, `weekly limit`, `limit will reset`, `upgrade to increase your usage`.
- Technical tokens, accepted ONLY on StopFailure: `rate_limit_error`, `rate_limit`, `overloaded_error`. Note that `overloaded_error` (529) is treated as a rate limit. Generic `429` / `too many requests` / `quota exceeded` / `rate limit` count only with a context word (`api`, `anthropic`, `claude`, `http`, `status`, `response`, `overloaded`, `retry-after`).
- Non-limit API failure (StopFailure only, structured fields only): `api_error`, 5xx text, ECONNRESET and similar, `timeout`, `\b(500|502|503|504|529)\b`. These lead to a `TurnFailed` signal and a same-account relaunch with Fibonacci backoff of 10, 10, 20, 30, 50, 80 s, capped at 2 min, with no attempt limit (wrapper.go:2124-2146).
- Model-specific caps: the text is matched against "<model> limit", e.g. "You've reached your Opus limit", using the known models list (modelswitch.go). If `model_fallback` is set, cux relaunches with `--model X` on the same seat instead of rotating (#57). Its comment lists six Claude Code limit kinds: five_hour "session limit", seven_day "weekly limit", seven_day_opus, seven_day_sonnet, seven_day_overage_included ("Fable limit"), overage ("usage credit limit").
- Second path: when the session limit fires mid-turn, Claude Code internally issues the slash command `/rate-limit-options` (the limit menu). cux catches it in `UserPromptExpansion` and `UserPromptSubmit`. It blocks the menu and writes `switch-requested`, which leads to kill + resume (hooks.go:147-170, 268-290).
- Third path: `IsOverThreshold` always returns true at 100% utilization, whatever the threshold (usage.go:587-619). So a prompt submitted on a blocked seat gets swapped in place before Claude rejects it. The comment says a "session-limit case (Claude Code blocks at the UI layer before any tool use, so PostToolUseFailure never fires)".
- No exit codes, stdout scraping or PTY text matching. Detection is purely hook-based.
- Env pitfalls warned at launch (claudeenv.go): `CLAUDE_CODE_RETRY_WATCHDOG` (any non-empty value) makes claude wait out limits, so no StopFailure fires and the swap never triggers. `CLAUDE_CODE_MAX_RETRIES>=10` delays it.

## 4. Proactive threshold swaps: usage source
- Usage source: **only the OAuth usage endpoint**: `GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <accessToken>` and `anthropic-beta: oauth-2025-04-20` (usage.go:1-41, 446-505). Overridable via `CUX_USAGE_ENDPOINT` and `CUX_USAGE_BETA`.
  - Response: `five_hour` and `seven_day` objects with `{utilization 0-100, resets_at}`, plus a `limits[]` array of `{kind, percent, resets_at, scope.model.display_name}` for model-scoped weekly caps. Unknown windows are kept in `Models` (#52).
  - 401 → `TokenExpired`. 429 → honor `Retry-After`, plus a shared backoff of 1 min doubling to a 15 min cap (#53).
  - This endpoint is undocumented / private. [U]
- cux does NOT use `anthropic-ratelimit-unified-*` response headers or statusline `rate_limits` (grep: none).
  - Statusline JSON does officially carry `rate_limits.five_hour|seven_day.{used_percentage 0-100, resets_at epoch s}`. It is present "only for claude.ai Pro and Max subscribers ... and only after the first API response in the session". Windows are dropped once their `resets_at` passes. [D] https://code.claude.com/docs/en/statusline
  - That gives a per-session, zero-cost signal and is better for Turno than polling.
  - Unified headers exist (`anthropic-ratelimit-unified-5h-utilization` and similar) but are not persisted or exposed by Claude Code (feature request anthropics/claude-code#55333; #12829). Reading them needs a proxy. Scale is disputed (0-1 vs 0-100). [S]
- Refresh cadence (monitor.go):
  - No daemon. At startup: `RefreshAllCoalesced(20s)` in the background.
  - After each Stop: refresh the active seat synchronously, coalesced over 20 s across processes via the file lock, then evaluate the threshold.
  - Idle evaluation every `poll_interval_seconds` (60) with a coalesced RefreshAll (2 min).
  - The usage cache is shared in `runtime/usage-cache.json` with `polled_at`. `StaleAfter = 30 min` (usage.go:348). A stale reading never triggers a proactive swap, but stale counts as "has room" when choosing a target.
  - Readings whose `resets_at` has passed are cleared (`Settled`).
- Defaults (config.go:110-135, README): `thresholds.five_hour=100`, `seven_day=100` (100 = reactive only), `auto_switch_on_threshold=true`, `auto_switch_on_rate_limit=true`, `auto_resume=true`, `auto_message="Go continue."`, `wait_for_reset=true`, `retry_on_api_error=true`, `auto_swap_idle_after_seconds=900`, `poll_interval_seconds=60`, `attach=false`. The code default `update_check.enabled=true` contradicts the README, which says false.
- Pick capacity defaults: if a threshold is 0 or 100, targets use a 5h cap of 90 and a 7d cap of 95 (strategy.go pickDrain; usage.go HasSwitchCapacity).

## 5. How the SAME conversation continues
There are two mechanisms.

**A. In-place swap (no restart).** Used by `/switch`, `/cux:switch`, and the UserPromptSubmit threshold check before a turn starts.
- `cux __slash-switch` rewrites the live creds and the oauthAccount block, then returns. Claude Code's next request uses the new account (slashcmd.go:1-12; hooks.go:292-305).
- For the pre-turn case, the hook writes nothing to stdout, so the prompt is approved and processed on the new account. A notice goes to stderr.
- This depends on the claim "Claude Code re-reads credentials on every API request". It is NOT in Anthropic docs [U]. claude-swap says the same for Linux and Windows ("re-reads them whenever that file changes"), and says macOS Keychain is cached about 30 s [S] https://pypi.org/project/claude-swap/.
- The `oauthAccount` identity in `.claude.json` may stay cached in the running process. In that case `/status` could show the old email. [U]

**B. Kill + `claude --resume <session_id>`.** Used for a mid-turn rate limit, `/rate-limit-options`, `cux force-switch`, the Stop-gated threshold swap, idle migration, a park that resumes, and a model fallback.
- session_id comes from the SessionStart and Stop hook payloads. Fallback: the newest `*.jsonl` in the project transcript dir (wrapper.go:2249; session/session.go also reads `$CLAUDE_SESSION_ID`).
- Stop the child with `gracefulExit` (wrapper.go:1781): SIGINT, wait 5 s, then Kill, reap descendants (Unix `ps`), and reset terminal modes (mouse reporting, #48 and #58).
- Run `completeSwap` (wrapper.go:1260): resolve the target, call SwitchTo, exclude refused seats and loop. If nowhere to go: retry in place with backoff when the live seat still has room, else `waitForReset` (sleep until the earliest `resets_at` + 90 s + 60 s, re-checking each minute), else `holdInPlace`.
- Run `waitForTranscript`: the jsonl must exist and stay size-stable for 200 ms, timeout 2 s.
- Relaunch with `relaunchFlags(argv)`, which keeps user flags like `--model` and `--dangerously-skip-permissions` but drops `--resume/-r/--continue/-c/--session-id/--fork-session` and positional prompts. Then add `--resume <id>` plus a positional message:
  - nothing for an idle migration;
  - nothing for a manual swap ("user is sitting right there");
  - otherwise `auto_message` ("Go continue.").
- A replay-flag file stops the next prompt-submit check from causing a swap loop.
- The same jsonl in the same `~/.claude/projects` is resumed under the other account. Transcripts are not account-bound [D handoff.md].
- Resume is only attempted if a turn completed (`hadTurns`) or the run itself was a resume. Otherwise claude starts fresh, because `--resume` on an empty session fails.
- "Wait for the current turn to finish": only the **threshold** path waits.
  - The swap decision is made inside the Stop handler, which fires after the turn's transcript is written, then gracefulExit.
  - Rate-limit and manual paths stop claude at once, since at a hard cap there may never be another Stop.
  - The prompt-submit path avoids the issue entirely by swapping before the turn starts.
- "Park" (park.go): if the reactive path has nowhere to go and the live seat is out, cux does NOT kill claude.
  - It marks the session parked, because killing loses the prompt line and running subagents (#48, #50).
  - If the user types, the prompt hook swaps in place once a seat frees.
  - If nobody returns, it checks every minute and, once a seat frees, does kill + resume with auto_message.
- Concurrency: many wrappers hit the same limit at once. After a refresh, a non-manual swap is skipped when the live seat already has capacity ("another session may have swapped") (wrapper.go:349-371).
- Swap history is written to `runtime/swap-history.json`, capped at 1000 entries.
- A registry (`cux sessions`) keeps ended sessions for 30 days so they can be resumed.

## 6. Strategies (internal/strategy/strategy.go)
- **drain** (default):
  - The order is `strategy.order` (emails). If empty, auto-order puts the highest-7d account first, to drain the most-used one.
  - Pass 1: 5h < cap5 and 7d < cap7. Pass 2: 5h < cap5 and 7d < 100.
  - Each pass runs twice: first over candidates with no model-specific cap, then over all.
- **balanced**: lowest 7d, tiebreak lowest 5h, excluding the current seat.
- **manual**: never auto-picks. `/switch` with no target falls back to capacity-aware rotation (`rotateFallback`).
- `ShouldRebalance` (drain: hop back to the priority account when its 5h resets) is defined but has **no non-test caller**. It is dead code in v0.4.1 [V grep].
- A manual `/switch` sets a guard (`ManualSwitchEmail`) that suppresses threshold auto-swaps away from the chosen seat. Hitting the hard limit overrides the guard.
- Projects: `cux project` binds a directory (longest prefix match) to a subset of seats for automatic decisions. An explicit `/switch <seat>` ignores it.

## 7. /switch and other commands
- `/switch [slot|email|alias]` is intercepted in **UserPromptSubmit**, not as a slash-command expansion. The reason given: slash commands "do not reliably expand — least of all on the hard-limited seat" (hooks.go:443-459).
  - The hook runs `cux __slash-switch` and returns `{"decision":"block","reason":<output>}`, so the text never reaches the model.
  - `__slash-switch` refuses unless `CUX_WRAPPED=1` and needs 2 or more accounts.
- `cux force-switch [target]` from another terminal reads `runtime/claude.pid` and writes `switch-requested`, leading to kill + resume.
- `cux switch` from a shell swaps creds but does not resume (global effect).
- `cux attach`: optional (attach=false). The wrapper owns a PTY (Unix) or ConPTY (Windows) and serves mirrors on a local socket, so viewers survive relaunches (ptyhost/).

## 8. Windows specifics
- Live creds: `%USERPROFILE%\.claude\.credentials.json` (correct per docs). Backups: Credential Manager (2560-byte cap risk, §2).
- Stopping claude:
  - With attach off (the default), it uses `exec.Cmd.Process.Signal(os.Interrupt)`. On Windows Go returns an error for this. The 5 s deadline then expires and `Process.Kill()` (TerminateProcess) runs.
  - So every kill + resume swap on Windows costs about 5 s and is a hard kill. README: "On native Windows the wrapper hard-terminates claude ... The Stop hook still flushes the transcript".
  - With attach on (ConPTY), it writes byte 0x03 into the console input (ptyhost_windows.go:491-496). In Claude Code one Ctrl+C usually interrupts the turn rather than exiting, so in practice it also falls through to TerminateProcess [U].
  - `descendantPIDs` uses `ps`, which is absent on Windows, so grandchildren are not reaped. If `claude` resolves to an npm `claude.cmd` shim, killing cmd.exe may orphan node.exe [U].
- **Transcript-path bug on Windows** [V by reading code, not run]:
  - `paths.ProjectTranscriptDir` and `session.transcriptDir` only replace `os.PathSeparator` with `-` and prefix `-`. `C:\Users\Rafael\Desktop` becomes `-C:-Users-Rafael-Desktop`.
  - Claude Code actually uses `C--Users-Rafael-Desktop`: every non-alphanumeric character becomes `-`. This machine's own `~/.claude/projects/C--Users-Rafael-Desktop` shows it.
  - Effects on Windows:
    - `waitForTranscript` always times out at 2 s, which is harmless but means there is no real flush check.
    - The `bestEffortSessionID` fallback returns "".
    - `cux project stats` and the "first prompt" in `cux sessions` are empty.
  - Resume still works when the SessionStart or Stop hook supplied session_id. `claude --resume <id>` locates the file itself.
- Console mode is saved and restored around kills (relaunchstate_windows.go). The lock uses LockFileEx.

## 9. Failure modes / known issues (from code comments and issue refs)
- #39: an over-broad classifier swapped healthy seats and killed 20 subagents. Fixed by the guards in §3.
- #42: an MCP-only keychain item captured as an account. Writing it signs the user out. Now refused.
- #46: the identity file (`.claude.json`) and the token store disagree, filing a token under the wrong slot. Fixed by fingerprint checks.
- #37: a stale or unknown reading treated as exhausted stranded sessions, so "unknown = room".
- #53: the usage endpoint 429s when N sessions poll the same seat. Fixed by coalescing plus a shared Retry-After.
- #48/#50: killing with no seat available lost the prompt and subagents. Fixed by park.
- #52/#57: model caps. Rotating hit the same cap, so model_fallback was added.
- #56: retry env vars suppress StopFailure.
- #58: terminal state after a kill.
- #21: in-place retry loops.
- Structural:
  - (a) A global credential swap moves every Claude session on the machine, including VS Code and unwrapped terminals.
  - (b) `mcpOAuth` lives in the same blob, so MCP logins are swapped along with the account. claude-swap explicitly preserves live MCP logins; cux does not mention it [U].
  - (c) It depends on undocumented behaviour: per-request credential re-read, the `/oauth/usage` endpoint, `/rate-limit-options`, and the refresh client_id.
  - (d) The first message on a new account rebuilds the prompt cache, so it costs extra usage [S claude-swap docs].
  - (e) A resume under a different account can hit "invalid thinking signature" [S, see handoff.md]. No report was found for Anthropic-to-Anthropic.
  - (f) The Windows issues in §8.

## 10. Comparison
| | cux (Go, GPL-3) | claude-swap / `cswap` (PyPI, MIT, v0.27.2 Oct 15 2026) | cx (Mike-7777777/cx, Go, MIT) |
|---|---|---|---|
| Isolation | global swap of `~/.claude/.credentials.json` + `oauthAccount` | global swap by default; `cswap run N` = this-terminal-only session profile (under backup dir `sessions/`); `--share-history` makes `--resume` see other accounts' sessions | per-account `CLAUDE_CONFIG_DIR`; shares plugins/skills/projects/config via junctions (Win) / symlinks |
| Backups | Keychain / Credential Manager / files | Keychain (mac), files (Win/Linux) under `~/.claude-swap-backup` / XDG | each config dir holds its own login |
| Usage source | `/api/oauth/usage` (polled at Stop / idle) | "usage API", adaptive polling, per-account cache, back-off after 429 | data written by `cx statusline` (statusline `rate_limits`) |
| Reactive limit detection | StopFailure / PostToolUseFailure / `/rate-limit-options` hooks | none described (poll only) | not described |
| Proactive | threshold (default off = 100) + idle migration | `cswap auto`: threshold default 90%, strategies `best`/`consume-first`, 5-min cooldown + hysteresis, `--once` for cron | `cx run` picks lowest-5h (reset proximity), `--prefer` w/ 80% fallback, `--balance`, `daemon` |
| Continue conversation | in-place (next request) or kill+`--resume <id>` + "Go continue." | same session after switch (Linux/Win immediate, mac ~30 s keychain cache); or reopen + `--resume` | `cx resume --on <acct>` via shared `projects/` |
| Windows | yes (hard kill, issues §8) | yes (file creds) | yes (junctions, PowerShell wrapper) |
Sources:
- https://pypi.org/project/claude-swap/
- https://github.com/realiti4/claude-swap
- https://github.com/Mike-7777777/cx
- https://code.claude.com/docs/en/authentication
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/statusline
- https://github.com/anthropics/claude-code/issues/55333
- https://github.com/anthropics/claude-code/issues/12829

## 11. Takeaways for Turno "Agent" button (ideas, no code reuse)
1. Prefer per-pane **CLAUDE_CONFIG_DIR per account** (Orca/cx style) over a global credential swap. Turno owns the pty env, so each pane picks its account. A swap means: stop the pty child, relaunch with another CLAUDE_CONFIG_DIR, and `--resume <abs transcript path>`. That path is allowed by the docs. Alternatively, symlink or junction `projects/` to share transcripts. Do not touch `~/.claude/.credentials.json`.
2. Detection stack:
   - (a) Statusline `rate_limits` (official, per-session, free): a Turno statusline script writes JSON to Turno, giving the proactive threshold.
   - (b) StopFailure hook with `error=="rate_limit"` (official enum) and `last_assistant_message`: reactive.
   - (c) Optional poll of the usage endpoint for idle accounts' ranking (undocumented).
   - Copy cux's conservative guards as an idea: structured fields only, deny "context window" etc.
3. Swap timing: swap on Stop (turn finished) when over the threshold. Swap immediately on StopFailure rate_limit. Never kill when no target exists: park and show a countdown to the earliest `resets_at`.
4. Hooks must be no-ops outside Turno, gated by an env var Turno sets, as cux does with CUX_WRAPPED. Use per-session signal files or a localhost IPC keyed by pane id.
5. After resume, inject a continuation message only for unattended or automatic swaps, not for manual ones. Re-pass flags (`--model`, permission mode, `--mcp-config`, ...), which resume does not restore [D handoff.md].
6. Windows: encode the project dir as Claude does (non-alphanumerics become `-`), or better, use `transcript_path` from the hook payload. Kill the whole process tree (node-pty kill, or a job object / `taskkill /T`). Wait for the Stop hook before killing.
