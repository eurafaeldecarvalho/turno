# Handoff research: continuing a conversation in a new session (Oct 2026)

Scope: (a) same-agent account swap, (b) cross-agent handoff, (c) UX for swapping underneath. Notes for the Turno "Agent" button design.
Legend: [V] verified from primary source/code; [S] secondary source; [U] unverified / inference.

NOTE: the relayed user request for this workflow run was about the window-opacity slider (finer steps + numeric % input), which does not match this research task. Not acted on here (this task forbids editing Turno). Flagged to the orchestrator.

---

## (a) Same agent, different account

### Claude Code
- Transcripts are plain local JSONL at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (or `$CLAUDE_CONFIG_DIR/projects/...`). Nothing in the docs ties them to the account. [V] https://code.claude.com/docs/en/sessions#where-transcripts-are-stored
- `claude --resume <transcript-path>` accepts an absolute .jsonl path. [V] same page. So a per-account `CLAUDE_CONFIG_DIR` process can resume a transcript stored under another account's config dir by path. Direct consequence for Turno: account isolation by CLAUDE_CONFIG_DIR does not block resume.
- `claude --resume <id>` searches the current project, then every other project on the machine (since v2.1.223). A hand-copied duplicate makes the lookup report not-found. [V] sessions doc + https://code.claude.com/docs/en/agent-sdk/sessions
- `CLAUDE_CODE_PROJECT_DIR_NAME` (with CLAUDE_CONFIG_DIR, v2.1.234+) pins the project folder name. The docs describe it as a fit for "a host that embeds Claude Code and gives each session its own config directory". [V]
- The Agent SDK docs list a way to resume on another host: "Move the session file" into any dir under `~/.claude/projects/` on the new host. They also recommend this alternative: "Don't rely on session resume ... pass them into a fresh session's prompt. This is often more robust". [V] agent-sdk/sessions
- Resume restores the conversation, the model, the agent, the permission mode (with exceptions), an active goal, and session-scoped scheduled tasks. It does NOT restore background Bash/monitor tasks or flags like `--mcp-config`, `--settings`, `--add-dir`, `--plugin-dir`, `--fallback-model`. Pass those again on relaunch. "auto" permission mode is restored only "when your account still meets the auto mode requirements". That condition implies the docs expect resume under a different account state. [V]
- Interrupted tool calls are marked cut-off on resume, and Claude is told to check whether they took effect (env `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`). [V]
- If you resume the same session in two processes without `--fork-session`, the messages interleave in one transcript. Always stop the old process first. [V]
- cux (GPL-3.0; ideas only), C:\rx\cux:
  - `internal/session/session.go:1-4`: "transcript ... carries the full conversation, so a swap+resume preserves context fully". Session ID comes from `$CLAUDE_SESSION_ID` or the newest jsonl.
  - `internal/wrapper/slashcmd.go:6-12`: manual `/switch` and the threshold swap rewrite the live credential blob IN PLACE. cux states "Claude Code re-reads credentials on every API request, so the very next message continues on the new account in the same session — no kill, no --resume". Kill+resume is used only for mid-turn rate-limit recovery and force-switch. [cux claim; not confirmed by Anthropic docs, U]
  - `internal/wrapper/wrapper.go:2214` `waitForTranscript`: before relaunch, waits until the jsonl size is stable (flush). `resumeArgv` (:2038) strips the user's own session flags (`--resume/-r/--continue/-c/--session-id/--fork-session`, :2056-2063) and appends `--resume <id>` plus an optional auto_message or the replayed intercepted prompt.
  - README: on native Windows the wrapper hard-kills claude (no SIGINT). It relies on the Stop hook having flushed the transcript first. Its self-test: ask Claude to remember 4729, `/switch`, ask again.
  - `internal/wrapper/park.go:1-21`: when every seat is exhausted, do NOT kill the session. Park it, swap in place on the next prompt, or stop-swap-resume once a seat frees (fix for issues #48/#50).
  - `internal/ptyhost/ptyhost.go:1-12`: the PTY is owned by the wrapper, not by the claude child, so viewers survive kill+resume relaunches. `drain.go`: wait for PTY quiet before writing banner lines, so that claude's `\e[?1049l` alt-screen exit doesn't erase them.
  - Default thresholds are 100% for 5h and 7d, `auto_switch_on_threshold=true`, `auto_swap_idle_after_seconds=900` (config.go:10, 324-395).
- Orca (MIT), C:\rx\orca:
  - `src/main/claude-accounts/claude-profile-history.ts:29-39`: each account is a separate CLAUDE_CONFIG_DIR profile, but these dirs are SYMLINKED to the shared default home so history and resume work across accounts: `projects, session-env, file-history, shell-snapshots, todos, paste-cache, tasks, plans, transcripts`. Not linked: `sessions`, which is the live-process registry. `claude-profile-sharing.ts` holds the link logic (skips "user-owned" non-empty dirs).
- Risk: "Invalid signature in thinking block" on resume. It has been reported when a session moves between Anthropic and a non-Anthropic backend (GLM) and when signatures went missing (issue #21726, closed Mar 2026; #66204, closed Jun 2026). [S] https://claudeissues.com/issue/21726-..., https://claudeissues.com/issue/66204-... I found no report of failure between two Anthropic consumer accounts, and cux's design depends on it working. [U] Mitigation: on a 400 signature error, fall back to the summary handoff (tier 2).

### Codex CLI
- Rollouts are at `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`. JSONL is canonical. A SQLite index `logs_2.sqlite` exists since v0.134. [S] https://codex.danielvaughan.com/2026/06/01/... ; https://github.com/openai/codex/discussions/3827
- Commands [V] https://learn.chatgpt.com/docs/developer-commands?surface=cli:
  - `codex resume [ID|name] [--last] [--all]`; `codex exec resume [ID] [--last --all] [PROMPT|-]`
  - `codex fork`; `codex exec fork <ID> [PROMPT]`
  - `tui.resume_cwd`; `-C` for cwd
  - "Authentication still uses CODEX_HOME"
- Accounts are separated by CODEX_HOME (auth.json lives there). So resuming under another account means the rollout must be visible in that CODEX_HOME. Orca does this: `src/main/codex/codex-legacy-session-resume.ts`, `codex-ai-vault-session-resume.ts` "materialize" the rollout into the target home with no-overwrite copy/hardlink, guarded by an audit log, and pin `CODEX_HOME` for the pane.
- BLOCKER: encrypted reasoning items are org-bound. After a switch from ChatGPT auth to an API-key org, resume failed with `invalid_encrypted_content ... Encrypted content organization_id did not match the target organization`. The only workaround found was to strip the reasoning items from the rollout or to start fresh. [S] https://community.openai.com/t/codex-app-cannot-resume-session-after-api-key-switch-encrypted-content-organization-id-mismatch/1374803. Two different ChatGPT accounts are likely different orgs too, so expect the same failure. [U, not tested; must not test against real accounts]
- Codex compaction (primary source, openai/codex):
  - `codex-rs/prompts/templates/compact/prompt.md`: "CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task". Required items: progress and key decisions; context, constraints, user preferences; remaining next steps; critical data, examples, references. "concise, structured".
  - `summary_prefix.md`: "Another language model started to solve this problem and produced a summary ... build on the work ... avoid duplicating work".
  - `codex-rs/core/src/compact.rs:63`: `COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000`. The compacted history = recent real user messages (up to 20k tokens, verbatim) + summary. [V]

### Gemini CLI / Antigravity CLI
- Gemini CLI auto-saves sessions to `~/.gemini/tmp/<project_hash>/chats/`. Commands: `gemini --resume [latest|index|UUID]`, `--list-sessions`, `/resume` browser, `/resume save|list|resume <tag>` (alias `/chat`). Retention is 30 days. [V] https://geminicli.com/docs/cli/session-management/
- Gemini CLI stopped serving free / Google AI Pro / Ultra individual tiers on 2026-06-18 and was replaced by Antigravity CLI (`agy`), which reuses `~/.gemini`. Enterprise and paid API-key users keep Gemini CLI. [V] https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/ ; [S] the agy resume flags (`-c/--continue`, `--conversation`, `/resume`) come from https://toolsbase.dev/en/blog/gemini-cli-to-antigravity-migration (verify with `agy --help`).
- For "rotate free tiers": the Google free tier is now Antigravity, not Gemini CLI.
- Account swap: auth is Google OAuth cached under ~/.gemini, and chats are keyed by project hash, not by account. So a resume after re-auth is plausible. [U]
- Checkpointing (`/restore`) is a file-snapshot and rollback feature, not a cross-account mechanism. [U, from memory; page only links to it]

### Others (brief, mostly unverified)
- Copilot CLI, Kiro CLI, Qwen Code, OpenCode, Cursor CLI, Amp, Grok: each has its own resume (`--resume`/`--continue` style). casr lists read/write support for many of them (see below). For Turno, treat "native resume after account swap" as a per-agent capability flag that defaults to false until each one is verified.

---

## (b) Cross-agent handoff

### Option 1: convert the transcript into the target's native format
- casr (Dicklesworthstone/cross_agent_session_resumer, Rust, license NOASSERTION/custom, active Oct 2026): source → canonical IR (messages with role, tool calls/results as objects) → writes a NATIVE session file for the target, verifies read-back, prints the resume command. Atomic writes, `.bak` on `--force`. It reports a round-trip verified against a live `grok --resume`. OpenCode 1.x/2.x DBs are read-only (writes refused). [V] GitHub README
- Pitfalls: the formats are undocumented and change per release. Claude docs explicitly say the jsonl "format is internal ... changes between versions". Thinking signatures (Anthropic) and encrypted reasoning (OpenAI) cannot be synthesized and must be dropped. A synthesized transcript replays the full token load into a model that may have a smaller window. Writing into another agent's private store also conflicts with Turno's own "don't touch agent stores" stance. Verdict: possible, but brittle. Not a default for Turno.

### Option 2: structured handoff injected as the first prompt (recommended default)
- continues (yigitkonur/cli-continues, MIT, ~1.5k stars, last push May 2026; `npx continues`): reads 16 agents' stores read-only (Claude, Codex, Copilot, Gemini, Cursor, Amp, Cline, Roo, Kilo, Kiro, Crush, OpenCode, Droid, Antigravity, Kimi, Qwen). It produces a handoff doc and launches the target.
  - Sections: recent messages; Tool Activity (bash commands with exit codes, edits, greps); Session Notes (model, tokens, reasoning); source session path; files changed; remaining work.
  - Presets: minimal (3 msgs / 0 tool samples) · standard (10/5, subagent 500 chars) · verbose (20/10, 2000 chars) · full (50/all). `--debug-prompt` previews the prompt.
  - [V] https://github.com/yigitkonur/cli-continues. Verbose handoffs reach 10k–30k tokens. Neither continues nor casr detects rate limits. [S] Vaughan.
- clisweave (PyPI; Claude/Codex/Kimi): exports the full conversation to a handoff folder, then starts the target with "read the export and continue". relai (Product Hunt) claims ~10 agents. Session Takeover skill: cross-checks extracted actions against live `git status` and the filesystem. [S, not reviewed]
- Amp "Handoff (No More Compaction)": the user states a goal. Amp generates a draft starting prompt plus a list of relevant files in a NEW thread, which the user can edit before sending. The rationale given is that compaction is lossy and stacks summaries. [V] https://ampcode.com/news/handoff. A later report says Amp's new CLI brought auto-compaction back. [S]
- Claude Code compaction, what it re-injects after the summary [V] https://code.claude.com/docs/en/context-window:
  - CLAUDE.md, auto memory, plan file, skill bodies (5k per skill, 25k total)
  - a fresh git status
  - re-reads of up to 5 most-recently-modified files touched in the session (files over 5k tokens become path refs)
  - SessionStart hooks with source `compact`
  - `/compact <focus>` steers the summary
  - This is a good template for what a handoff should re-hydrate from disk instead of from the summary.
- ACP (Agent Client Protocol) [V] https://agentclientprotocol.com/protocol/session-setup:
  - `session/load` (cap `loadSession`): the agent replays history to the client as `session/update`.
  - `session/resume` (cap `sessionCapabilities.resume`): no replay.
  - Neither lets a CLIENT import history into an agent. ACP gives same-agent continuity and a uniform transcript feed for building the summary, NOT cross-agent import.
  - Orca `src/main/acp/acp-session-setup.ts:37-60` prefers load, then resume, and retries `authenticate` on auth-required. Its `acp-conversation-copy.ts` refuses to open a copy under a different account (`AcpCopyAccountMismatchError`).
- API-level replay (LiteLLM/OpenRouter style): when Turno owns the messages array, switching provider is just a re-send. Provider-specific parts must be dropped or translated: thinking signatures, encrypted reasoning, tool-call ID formats, images. Only applicable if Turno runs its own agent loop. That is not the case for CLI agents (subscription CLIs don't expose the history over an API). [U, general knowledge]

### Evidence on summary quality and size
- Factory.ai, Dec 2025 [V] https://factory.com/news/evaluating-compression:
  - Anchored iterative summarization: persistent sections (session intent, file modifications, decisions made, next steps). Only the newly dropped span is summarized and merged in, instead of regenerating the whole summary.
  - Probe scores (0-5): Factory 3.70 vs Anthropic 3.44 vs OpenAI 3.35.
  - Artifact trail is the weakest dimension for every method (2.19–2.45). The authors recommend a separate artifact/file-state index.
  - Failure modes: dropped file paths, endpoints and error codes; drift from full regeneration.
  - Use tokens-per-task as the metric, not the compression ratio.
- JetBrains "The Complexity Trap" (NeurIPS'25 DL4Code, arXiv 2508.21433) [S]: simple observation masking (hide old tool outputs, keep reasoning and actions) matches or slightly beats LLM summarization on SWE-bench Verified, at about half the cost. A hybrid works best. Implication: in a handoff, keep actions/decisions and the last N real messages verbatim, and drop bulky tool outputs.
- Size guidance (synthesis):
  - Codex keeps up to 20k tokens of verbatim user messages plus a concise summary.
  - continues "standard" ≈ 10 messages.
  - Claude re-reads 5 files at 5k each.
  - Proposed Turno target: summary 1.5–4k tokens + last 3–10 user/assistant messages verbatim (cap ~8k) + repo state (git status, diffstat; full diff only if <~3k tokens, else paths + hunks of the most recent files) + todo/plan file + list of files to re-read. Total ≤ 10–15k tokens, or ≤ 10% of the target model's window. Scale down for small-window free models.

### Repo state to include
- `git status --porcelain`, `git diff --stat`, the truncated `git diff` (recent hunks), branch, last commits (`git log -5 --oneline`), and untracked new files.
- The agent's todo/plan:
  - Claude: `~/.claude/todos`, `plans`, and TodoWrite entries in the transcript
  - Codex: `update_plan` items in the rollout
  - Gemini: task trackers
- Failing test or command output from the last exit-code≠0 tool call.
- Prefer instructing the target to RE-READ files and re-run `git status` over pasting their content (the Session Takeover / Claude re-hydration pattern).

### Quality pitfalls
1. Lost artifacts (paths, endpoints, error codes, exact commands). Mitigation: extract them deterministically from the tool log, not with the LLM.
2. Summaries stacked on summaries cause drift. Mitigation: keep one anchored summary per Turno conversation and update it incrementally.
3. Over-trusting the summary. Mitigation: tell the target to verify against git and the files before acting.
4. A half-finished tool call at the cutoff (a non-idempotent command may have run). Claude marks these. Turno should flag "last command may or may not have completed".
5. Persona/instruction loss: user preferences and constraints must be an explicit section.
6. Summarizing with the exhausted account is impossible at a hard limit. Mitigation: generate the summary EARLY (near the limit, e.g. 85–90%), or with a different session/model (the incoming agent, or a cheap/free model, or a local model like Qwen via Ollama), or deterministically from the transcript file.
7. Context-window mismatch: a 1M-token Claude session handed to a 128k free model. Budget per target.
8. Secrets in transcripts: redact before sending to another provider.
9. Model-specific formats (signatures, encrypted reasoning) must never be forwarded.

---

## (c) UX: swap underneath while the user stays on the same screen
- Keep the dockview panel and the xterm instance. Only the node-pty child changes. The Turno main process owns a "session host" per panel (the cux ptyhost model). On swap:
  1. Stop input: lock xterm input or queue keystrokes.
  2. Graceful stop: send `/exit` or Ctrl+C; on Windows, kill after the transcript flush (cux waits for a stable file size).
  3. DrainQuiet before writing anything, so the TUI's alt-screen exit doesn't wipe the banner.
  4. Write a banner via `term.write` (ANSI dim/colour): "── continued on <agent>/<account> (reason: 5h limit 92%) · Ctrl+Z to undo ──".
  5. Spawn the new pty with the same cols/rows and cwd, and nudge a resize so the TUI repaints.
  6. Re-enable input. Replay the user's intercepted prompt if the swap happened at submit (cux `resumeMessage`).
- Prefer the in-place credential swap when the agent supports it, because there is no restart at all (cux claims this for Claude Code). Turno would need to write the agent's live credential store, which the current hard rules for research forbid touching. This is a design choice for the user to approve. Per-account CONFIG_DIR + `--resume <path>` avoids touching the global credentials.
- Never kill a session when no seat is available. Park it and show "waiting for reset hh:mm / pick another agent" (cux park.go lesson).
- Make the handoff prompt editable before sending, at least in manual mode (Amp lesson). In auto mode, show it collapsed in a side panel ("What the new agent was told").
- Keep a lineage record in the Turno DB: conversation id → [segments: agent, account, native session id, start/end, reason, handoff text]. Show a timeline. Allow "go back to previous session" when it resets.

---

## Recommended tiering (evidence-backed)
- T0 (best, zero loss): same agent with an in-place credential swap. Claude Code via cux-style live-credential rewrite [cux claim]. Not universally available.
- T1 (near-zero loss): same agent, different account, native resume of the SAME transcript.
  - Claude: `--resume <abs path>` under the new CLAUDE_CONFIG_DIR, or shared `projects` via symlink (Orca) [V]. On a thinking-signature 400, fall to T2.
  - Codex: copy the rollout into the target CODEX_HOME and `codex resume <id>`. Likely blocked by org-bound encrypted reasoning [S]. Requires stripping reasoning (lossy, touches the store) → treat as T2 by default.
  - Gemini/agy: plausible, unverified.
- T2 (default cross-agent): structured handoff prompt as the first message of a new session.
  - Built from a deterministic extractor (Turno parses the source transcript read-only, like continues) plus an anchored LLM summary refreshed near the limit.
  - Contents: Codex/Factory sections + last N messages + repo state + todo + re-read list.
- T3 (opt-in, experimental): native format conversion (casr-style) for agent pairs that are known to work. Brittle, and writes into the agent's own store.
- T4 (Turno-owned loop): API-level replay, only for API-key providers where Turno itself runs the loop (e.g. free API tiers via OpenRouter/LiteLLM).
