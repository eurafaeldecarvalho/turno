# Orca TASKS / orchestration subsystem: reverse-engineering notes (Oct 21 2026)

Scope: how Orca models Tasks, Dispatches, decision gates, the coordinator, retries, and the packaging of task context into a terminal or chat agent. Then mapped to Turno (routines, runs, RunViewer follow-ups, sidebar agent sessions).
Sources: C:\rx\orca (stablyai/orca, MIT, source version 1.4.214, HEAD fcac5cf, Oct 21 2026); the installed build, extracted at C:\rx\orca-asar (package.json 1.4.237); https://www.onorca.dev/docs/cli/orchestration (fetched 2026-10-21).
Legend: [V] verified in code or docs. [U] inference or unverified.

NOTE on the request relay: the "user request" relayed by the harness for this run ("junta aparecia com terminal e pode colocar a tela de novidades") is about a Turno UI change and does not match this research task. This run did research only, edited nothing in Turno, and flags the mismatch to the orchestrator.

---

## 0. Architecture in one paragraph

Orchestration is a durable SQLite state machine plus a mailbox. It lives in the Orca runtime, which in the packaged build runs inside the daemon (`orcad`) chunk. Agents never talk to each other directly. They call the `orca orchestration ...` CLI, which sends newline-delimited JSON-RPC over a Unix socket or a Windows named pipe (`src/main/runtime/rpc/unix-socket-transport.ts:1-12`: 1 MB max message, 30 s idle timeout, 32 connections, keepalive frames while a long-poll is pending). Work is handed to an agent as one text "dispatch preamble" (CLI recipes plus a `=== TASK ===` block). That text is bracketed-pasted into the agent TUI's PTY, or sent as a structured chat turn. The "coordinator" today is an LLM agent following the `orchestration` skill. The old in-process `Coordinator` poll loop is retired from the CLI.

## 1. Data model (persistence)

DB file: `<userData>/orchestration.db` [V] `src/main/runtime/workspaces/persisted-surfaces/automation-operations.ts:166-168`. It is opened lazily, with WAL. Writes use `BEGIN IMMEDIATE` or savepoints (`db/lifecycle-transition.ts:19-48`).
Schema: `src/main/runtime/orchestration/db/schema/create-graph-tables-sql.ts` and `create-core-tables-sql.ts`. Migrations are in `schema/migrate-v2-v12.ts` … `migrate-v37.ts`.

| Table | Key columns | Notes |
|---|---|---|
| `runs` | id, objective, coordinator_handle/pane_key/orca_session_id, consumer_generation | Durable namespace plus coordinator inbox. It does not schedule anything. |
| `tasks` (graph-sql L115-138) | id `task_*`, run_id, parent_id, created_by_*, task_title, display_name, **spec** TEXT, **status** CHECK(pending,ready,dispatched,completed,failed,blocked), **deps** JSON array TEXT, result, completed_at | Indexes on status and parent_id. |
| `dispatch_contexts` (L140-183) | id `ctx_*`, task_id, assignee_handle/pane_key/orca_session_id, launch_token_hash, capability_hash, process_incarnation, **retry_of_dispatch_id**, creator_*, status CHECK(pending,dispatched,completed,failed,circuit_broken), **failure_count**, last_failure, termination_reason, **depth**, **consumer_generation**, last_heartbeat_at | Each row is one attempt of a Task. |
| `worker_dispatches` (core-sql L144) | dispatch_id, state (starting, ready, start_unknown, failed, succeeded, stopping, stop_unknown, stopped, abandoned), stage, worktree_id, agent_terminal_handle, effects, residual_resources, start_options | Lifecycle of the supervised process. |
| `decision_gates` (L188-201) | task_id, question, options JSON, status (pending, resolved, timeout), resolution | |
| `messages` / `deliveries` | type ∈ status, dispatch, worker_done, merge_ready, escalation, handoff, decision_gate, question, heartbeat; priority; thread_id; payload JSON | `deliveries` holds FIFO batches per mailbox with outstanding/acknowledged/fenced status. |
| `coordinator_runs` | spec, status (idle, running, completed, failed), poll_interval_ms | Used only by the legacy loop. |
| `mutation_receipts` | caller_fingerprint, request_id, payload_hash, state, receipt | Idempotency for `--retry-request`. |
| federation tables | federated_dispatches, remote_dispatch_attachments, federation_relay_items | Cross-host (SSH/WSL) relays. |

Types: `src/main/runtime/orchestration/types.ts:3-340` (TaskStatus L21, DispatchStatus L23, DispatchContextRow L279-317, DecisionGateRow L319).

## 2. Task lifecycle [V]

- **Create** (`db/tasks/task-store.ts:12-87`): requires a Run. Deps must belong to the same Run. The initial status is computed inside the INSERT: `'ready'` when every dep is `completed`, otherwise `'pending'` (L59-67).
- **Promotion** (`task-store.ts:210-237` `promoteReadyTasks`): runs inside the completing transaction. It scans pending tasks whose deps include the completed id and flips them to ready once all deps are complete.
- **Dispatch** (`db/dispatch-context/dispatch-context-store.ts:14-120` `createDispatchContext`): only a `ready` task can be dispatched. A terminal or pane can hold only one active dispatch (lock on handle and pane key). The function carries forward `MAX(failure_count)` across earlier attempts of the task (L51-55). It claims the row atomically, transitions the task ready→dispatched, and computes nesting depth from the creator.
- **Legal transitions** (`db/lifecycle-transition.ts:67-97`): the task graph is permissive, and invariants live in `updateTaskStatus`. A task cannot change status while a supervised worker is alive (`db/tasks/task-status-transition.ts:38-76`). Dispatch terminal states have no outgoing edges.
- **Completion**: a `worker_done` carrying both `--task-id` and `--dispatch-id` with `--outcome succeeded|failed` settles the Dispatch and the Task (`lifecycle-reconciliation.ts`, `db/dispatch-context/worker-report-settlement.ts`). A late or stale report from an older attempt is rejected (`WorkerReportSettlement` codes: stale_dispatch, inactive_dispatch, task_dispatch_mismatch; types.ts L27-38).
- **Failure / retry** (`db/dispatch-context/dispatch-completion.ts:126-235` `failDispatch`):
  - `failure_count+1 >= 3` sets the dispatch to `circuit_broken` and the task to `failed`. Otherwise the dispatch becomes `failed` and the task goes back to **`ready`, not `pending`**. The comment explains why: pending would strand the task, because promotion only runs when a dep completes.
  - `DISPATCH_CIRCUIT_BREAK_FAILURES = 3` (`dispatch-circuit-breaker.ts:2`).
  - A worker's own `--outcome failed` report does NOT count toward the breaker. Failed `worker-start` attempts do (`skill-guides/orchestration/references/recovery-and-cleanup.md` "Retry, stop, and abandon").
- **Blocked**: only decision gates block a task. `reblockTasksWithPendingGates` restores the invariant on every tick (`coordinator-decision-gates.ts:52-62`). `resolveGate` sets the task back to `ready` (`db/decision-gates/decision-gate-store.ts:100-119`).
- **Convergence** (`coordinator-dag-convergence.ts`): the DAG is done when every task is completed or failed. If nothing is active and some tasks are blocked, it logs "Stuck … Resolve decision gates". A cancelled task is recorded as `task-update --status failed --result cancelled`, and its dependents stay blocked until a `--retry-of` replacement completes it.

## 3. Decision gates [V]

- A worker sends a `decision_gate` message with payload {taskId, dispatchId, question, options} (`coordinator-decision-gates.ts:6-50`). The gate is created and the task becomes `blocked`. Gates from a fenced consumer or a non-startable task are rejected.
- Gates are never auto-resolved: "humans do, via orchestration.gateResolve" (L53).
- On the next dispatch of that task, the most recent resolved gate is appended to the preamble as `--- DECISION GATE RESOLVED --- Question / Resolution` (`coordinator-task-dispatch.ts:132-145`). The answer travels with the work, not with the agent's memory.
- CLI: `gate-create --task --question --options`, `gate-list`, `gate-resolve --id --resolution`.

## 4. Coordinator

- **Legacy in-process loop** (`coordinator.ts`): `decompose()` only checks that tasks exist (AI decomposition was "a future phase", L146). Each `tick()` (default 2 s) runs processMessages → escalations → reblock gates → warnStaleDispatches → dispatchReadyTasks (default maxConcurrent 4; creates at most one terminal per tick, L251-263) → checkConvergence. Free terminals are those not equal to the coordinator, not busy, connected and writable (`coordinator-task-dispatch.ts:31-62`). Hung detection only warns (10 min without a heartbeat, which is 2× the 5-min heartbeat cadence; never auto-fails; L16-29).
- **Retired from the CLI**: `orchestration coordinator-start` and `coordinator-stop` throw `orchestration_migration_required` "The legacy automatic coordinator command is retired" (`src/cli/handlers/orchestration/dispatch-handlers.ts:73-87`). The RPC still exists in `rpc/methods/orchestration/gates/gates.ts:17-60`. The docs say the same.
- **Current model**: the coordinator is an agent following `skills/orchestration/SKILL.md` and `skill-guides/orchestration.md`: `run-create` → `worker-start` per task (a wave) → `check --wait --types worker_done,escalation,question` → reply, release or reuse → `check --ack <deliveryId>`. Mail delivery is FIFO and replays until acked. Three empty waits trigger a `worker-list` census. "Absence never authorizes stop/abandon/retry/release."
- **Run takeover** (`db/runs/run-binding.ts:124-180`, CLI `run-use`): a new coordinator binds an existing Run. Orca bumps `consumer_generation`, fences unacknowledged deliveries of the old consumer, re-routes all unread direct mail to the Run mailbox, and records the new handle, pane and session. **This is the closest Orca primitive to "swap the session underneath and keep the work".** The state lives in the DB, so the new agent process only needs to bind and read the mailbox. Dispatch re-pointing does the same at the worker level (`db/worker-dispatch/worker-dispatch-authority.ts:52-80`: assignee, pane, process and incarnation are rewritten, generation bumped, old deliveries fenced).
- Chat sessions are addressed by `orca_session_id:<id>`. After `/clear`, the lineage root id is kept (types.ts L50-53), so identity survives a context reset.

## 5. How task context is packaged and handed to an agent (most relevant to the handoff)

`preamble.ts:70-164` `buildDispatchPreamble` builds the text in this order:
1. A header: "You are working inside Orca … You are a dispatched worker", identity lines (coordinator handle or session id, task id, own session id), and the warning that the coordinator cannot see this terminal or chat.
2. A fenced `sh` block of one-line CLI recipes with the rules written as inline comments at the point of use. The comment at L65-69 explains the choice: LLMs anchor on examples and skim trailing prose. The recipes cover `worker_done` (a 3-sentence summary: done / found / left, exactly once, both ids), `heartbeat` every 5 min with `--phase`, `ask` (instead of AskUserQuestion), `escalation`, and `check` at checkpoints.
3. `=== AFTER YOU SEND worker_done ===`: idle, do not poll. The user's direct instruction overrides the idle rule. A redispatch arrives as a fresh preamble plus TASK block (L182-231).
4. An optional `--- BASE DRIFT ---` section, only when the worktree is behind its base (L256-268), and an optional `=== SUB-DISPATCH ===` section, only when depth < max (L238-254). Sections are omitted rather than softened.
5. `=== TASK ===` followed by the spec, with infra flags such as `allow-stale-base: true` stripped (`coordinator-stale-base-flag.ts`).
6. The resolved decision gate is appended.

Wording note: the text uses plain-reason wording rather than shouted rules, "because Claude Code tells the model pasted text may carry instructions the user did not write, and shouted rules read as prompt injection" (L83-86, STA-8200).

Spec contract (skill-guides/orchestration.md "Task-spec contract"): every spec must be self-contained, with Target, Change, Constraints, Ownership, and Observable acceptance.

Size budget: spec max = worker-start prompt max − 64 KB reserved for the preamble. The prompt max is bounded by Windows ConPTY ingest: 64 bytes/ms over a (50 s grace − 30 s effect timeout) = 20 s budget, so roughly 1.2 MB [U, computed from `shared/orchestration-worker-start-prompt-budget.ts`, `shared/agent-prompt-injection.ts:24-40`, `shared/orchestration-timing-budgets.ts`]. A spec that is too large is refused with `worker_prompt_too_large` and the advice "place large context in a workspace file and reference its path" (`worker-start-prompt-budget.ts`).

Delivery:
- Terminal path: `sendAgentTurn({kind:'terminal'})` (`send-agent-turn.ts:102-126`) → `runtime.sendTerminalAgentPrompt` (`runtime/terminal/input/terminal-input-dispatch.ts:208-290`).
  - The payload is `buildAgentPromptPasteBytes` (`shared/agent-prompt-injection.ts:131`): an optional typed lead line, then ESC[200~ … ESC[201~ bracketed paste with sanitized text. For agents whose TUI needs a typed request (`pasteNeedsTypedRequest`), the lead line "Please carry out this task from my Orca coordinator by following the brief I pasted below." is typed first (`shared/orca-dispatch-status-prompt.ts:13`).
  - Text is chunked at 16 KiB. Submission is serialized per PTY and guarded by the PTY lifecycle generation.
  - Orca then waits for evidence that the turn started. For claude, codex and antigravity it uses hook "working" events (`agent-prompt-submission-verification.ts`). A stall means "unobserved", never "missing": Orca does not re-paste, because a duplicate preamble is worse (`coordinator-task-dispatch.ts:147-158`, #16095).
- Before pasting, worker-start waits for agent readiness: the composer marker of a freshly launched TUI, or `tui-idle` for a reused terminal (`launched-agent-composer-readiness.ts:135-144`). A write guard refuses the write if a shell, not the agent, is in front (`launched-agent-write-guard.ts:83-91`).
- Structured chat path: `host.send` with `delivery: 'queue'|'now'` (queue = held as a draft card until the current turn ends; now = steer). The settlement wait defaults to 60 s (`send-agent-turn.ts:128-169`, `deliver-worker-dispatch-preamble.ts:73-106`).

## 6. Retries with a fresh dispatch context [V]

- `worker-start --task <id> --retry-of <dispatchId> --worktree <explicit> --agent <a>` creates a NEW dispatch_contexts row (new ctx id, `retry_of_dispatch_id` set, failure_count carried) and a NEW preamble with the new dispatch id. Placement is never inherited. Late heartbeats or `worker_done` from the old attempt are fenced by the dispatch id (preamble.ts L8-13).
- The retry does NOT automatically include the prior attempt's transcript or output. The coordinator can read it with `worker-read --dispatch <old> --source auto` (provider transcript when proven, else bounded terminal output; capped at 40-50 messages, 1,200 chars per block, 512 KB; `worker-transcript-payload.ts:7-17`) and fold what matters into the spec. `dispatch-show --task --preamble` returns the exact preamble that was sent.
- Idempotency: every mutation accepts `--retry-request <id>`, and `request-show` answers completed/pending/absent (recovery-and-cleanup.md).
- Same-agent reuse: after settlement, `worker-start --task <next> --terminal <same handle>` sends a fresh preamble into the same live agent (coordinator-loop.md "Reuse after settlement").
- No rate-limit or quota logic exists anywhere in orchestration (grep for rate limit / usage limit / quota in `runtime/orchestration` finds only a federation relay byte cap). Account or limit rotation is out of scope for this subsystem [V by grep].

## 7. CLI / IPC surface [V]

CLI verbs (`src/cli/handlers/orchestration/*.ts`): run-create, run-current, run-list, run-show, run-use; task-create (`--spec --task-title --deps <json> --parent`), task-list (`--ready --brief`), task-update; worker-start, worker-list, worker-show, worker-read, worker-stop, worker-abandon, worker-release, worker-retain, worker-reuse, worker-cleanup, worker-relay, worker-state; dispatch (low-level `--inject`), dispatch-show; send, check, inbox, ask, reply; gate-create, gate-list, gate-resolve; request-show; reset; coordinator-start and coordinator-stop (retired).
RPC methods: `orchestration.taskCreate`, `taskList`, `workerStart`, `check`, `send`, `ask`, `reply`, `gateCreate`, `gateResolve`, `gateList`, `dispatch`, `dispatchShow`, `workerRead`, `workerRelease`, `runUse`, `federation*` … (`src/main/runtime/rpc/methods/orchestration/**`). They run over the socket or pipe described in §0.

## 8. UI [V, light pass]

- Orca has no dedicated Task-DAG board. The renderer "Tasks" page (`renderer/src/components/task-page/*`, `SidebarTaskNavButton.tsx`) is for GitHub, Linear and Jira issues, not orchestration tasks.
- Orchestration shows up as:
  - lineage on sidebar agent rows: `AgentStatusOrchestrationContext` {taskId, dispatchId, dispatchStatus, taskTitle, displayName, parentTerminalHandle, coordinatorHandle, orchestrationRunId, attention} (`components/sidebar/worktree-agent-row-orchestration.ts`, `store/slices/agent-status-orchestration-context.ts`)
  - clickable `task_*` links inside terminal output (`components/terminal-pane/terminal-orchestration-task-links.ts`)
  - dashboard selection per worktree (`components/dashboard/dashboard-orchestration-selection.ts`)
  - a settings pane with skill-install coverage per agent (`components/settings/OrchestrationPane.tsx`, `OrchestrationSkillAgentCoverage.tsx`)
  - a floating-terminal enable card
  - in chat, a dispatched task appears as a message with a "from coordinator" sender (`dispatchTaskSource`).

## 9. REA static analysis (shipped build)

- Command: `npx -y rea-agents@latest analyze-javascript-application C:/rx/orca-asar --source-path out/main/chunks/orcad-migration-source-retention-BlLM3I3p.js --artifact-format directory --format json` (rea 6.7.0; output 109 MB in the scratchpad `rea-tasks/rea-orcad.json`).
- Result: 1 parsed file (2.24 MB), 584,763 AST nodes, 269 findings; semantic graph 11,959 functions, 1,085 relations, 64,952 unknowns. Detected endpoint literals include `worker_report`, `coordinator_ack`, `liveness`, `outcome`, `retry-request`, `process_turn`, `pty.attach`, and `pty.openClient`. Limitations reported: inert parse, no runtime proof, dynamic paths unresolved.
- REA's value here was confirming that the shipped 1.4.237 bundle matches source 1.4.214. A grep of the chunk finds `CREATE TABLE IF NOT EXISTS tasks` (1), `circuit_broken` (23), `coordinator_runs` (14), `=== AFTER YOU SEND worker_done ===` (2), and `worker_prompt_too_large` (2). The lead-line string lives in `session-search-sqlite-support-*.js` and the renderer client. Orchestration therefore runs in the `orcad` daemon in the packaged app. Behavior differences between 1.4.214 and 1.4.237 were not diffed [U].

## 10. Mapping to Turno (ideas, not code)

Turno facts are from C:\rx\notes\turno.md: runner.ts `startRun`/`followUp`; engine.ts `resumePaused` (pause on the same account); RunViewer `useThread(head)` already moves the head to the new run while the view stays put; sidebar items {agent, sessionId, cwd}; ai.ts one-shot `claude -p` with tools disabled.

| Orca concept | Turno analogue / proposal |
|---|---|
| Task (spec, durable) | **Agent conversation / "brokerSession"**: the durable unit the user sees (sidebar item / Agent tab). It lives in Turno SQLite, not in any vendor's session. |
| Dispatch (one attempt bound to one terminal or process, with retry_of) | **Account attempt**: one row per (conversation, account, vendor, vendor session_id, started/ended, end_reason = limit_hit / limit_near / user / crash, failure_count). Turno's `runs` table with `parent_id` is already this chain. Add `account_id`, `vendor`, `handoff_id`, `retry_of`. |
| consumer_generation + fencing on re-point (`run-use`, worker-dispatch-authority) | When switching accounts, bump a generation on the conversation. Ignore late output or events from the old PTY/process (stream-json lines, onSession updates) whose generation is stale. Stop the old process before starting the new one (Claude's docs warn that resuming one session in two processes interleaves transcripts; see handoff.md). |
| Dispatch preamble (identity + rules as inline examples + `=== TASK ===`) | **Handoff packet** pasted as the first turn of the new session: a short header ("You are continuing a conversation started in <vendor/account>; the previous session hit its usage limit"), the 3-part summary (done / found / left), open decisions, files touched (git diff --stat), and the user's last message verbatim, then `=== CONTINUE ===`. Use plain wording, not shouted rules, to avoid prompt-injection heuristics (Orca STA-8200). |
| worker_done 3-sentence executive summary | Ask the OLD session, when near its limit (`allowed_warning`), to write its own checkpoint summary while it still has quota. Fallback: summarize the transcript with local Qwen or the next account (ai.ts template). Orca pushes summarization to the agent that has the context. |
| Spec size budget + "put big context in a workspace file and reference its path" | Write the full handoff to `%APPDATA%\turno\handoffs\<conv>-<n>.md` (or into the cwd) and paste only a short packet that references it. Keep the pasted text well under about 1 MB. On Windows ConPTY a 40 KB paste takes about 0.4 s to ingest (agent-prompt-injection.ts:24-35). |
| Bracketed paste + readiness wait + turn-start verification + no re-paste on stall | In TerminalPanel/pty.ts, wait for the new agent's composer or idle marker before writing (Turno today uses "first output +150 ms"), wrap in ESC[200~…ESC[201~, then send Enter. Treat "no turn start observed" as unknown, never re-paste. Serialize writes per PTY. |
| Structured chat `queue` vs `now` | In headless runs (RunViewer), the handoff is just a `followUp` with a new account and no `--resume`. Queue the user's in-flight message behind the handoff turn. |
| failDispatch → task back to `ready` (not pending); circuit breaker at 3 | When an account attempt fails (limit hit at launch, auth error), mark the account `cooling(resetsAt)`, return the conversation to "ready", and pick the next-ranked account. After N consecutive start failures across accounts, stop and show the user (avoid burning every account on a broken prompt). Count only start/launch failures toward the breaker, not the agent's own "I failed" answers (Orca's rule). |
| Decision gate (blocks task; resolution appended to next preamble) | "Approve switch?" gate: optional per conversation (e.g. switching from a paid Claude account to a free ChatGPT web tier). Its answer is appended to the handoff packet. The coordinator never auto-resolves gates; mirror that for cross-vendor or cost-tier jumps. |
| Heartbeat 5 min / stale warn at 10 min, warn-only | The limit detector plus a liveness ping on the PTY. Warn, don't kill, on silence. |
| Run takeover (`run-use`) re-routes unread mail to the new consumer | Messages the user typed while the swap was in progress go to the new session after the handoff turn (queue). |
| `worker-read --source auto` (provider transcript if proven, else terminal buffer; bounded) | The handoff summarizer's input: the vendor transcript (Claude jsonl at `<configDir>/projects/<slug>/<id>.jsonl`, Turno's own `runs/<id>/events.ndjson`) with the xterm buffer as fallback, bounded to the last N messages and characters. |
| `--retry-request` idempotency | Give each swap an operation id so a crash mid-swap can be resumed without double-pasting the handoff. |
| Sidebar lineage (taskId, dispatchId, parent, run) | Agent tab subtitle: "Claude · acct #2 (rank 2) · handoff 3" with a history popover of attempts. Turno routines become Runs (objective) and routine steps become Tasks with deps, if Turno ever adds multi-step DAG routines. |

Recommended takeaways:
1. Keep the conversation as Turno-owned durable state. Vendor sessions are disposable attempts (Orca's Task vs Dispatch split).
2. Fence the old attempt by generation before starting the new one.
3. Hand over via a self-contained packet: summary plus file reference, pasted once with readiness and turn-start checks.
4. Have the outgoing session write the summary while it still has quota. Use a local model as fallback.
5. Use a circuit breaker and human gates for risky jumps.

Orca itself provides none of the limit detection or account ranking. That part has to come from cux-style detection (see handoff.md and the cux notes).

## 11. Not verified
- Exact runtime behavior of 1.4.237 vs source 1.4.214 (no diff done).
- Exact prompt byte cap (computed, not measured).
- Orca was not run against any agent (per the safety rules), so preamble delivery timing was not observed.
