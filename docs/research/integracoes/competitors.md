# Turno competitors: feature comparison (Oct 21, 2026)

Scope: Orca, Conductor, Crystal/Nimbalyst, Claude Squad, Vibe Kanban, Warp (Oz), Cursor (background/cloud agents + Automations), Codex app, Claude Code Desktop, Zed, Superset, Sculptor.
Focus: task/issue integrations, MCP/connections, scheduled runs, usage limits, notifications/remote/mobile, worktrees, review UI. Then: what is table stakes, what Turno can own, and what to skip.

Legend: [src] = read in primary source (docs/code/changelog). [3p] = third-party write-up only. [UNVERIFIED] = inferred or from memory, not confirmed this session.

---

## 1. Headline finding

**Scheduled agent runs are no longer a niche.** In 2026, these all shipped cron-like routines:

- Claude Code Desktop: local scheduled tasks plus cloud scheduled tasks (formerly "routines") [src]
- Codex app: Automations [src]
- Cursor: Automations, cloud only [src]
- Warp: Oz scheduled agents, cloud only [src]
- Orca: `orca automations`, local or remote host [src]
- Superset: Automations on a target device [src]
- Conductor: Routines, cloud only, Pro/Team [src]

Turno cannot win on "has a scheduler". It can win on **a scheduler that runs reliably on a local Windows box**. Claude Desktop's local scheduler has many open bug reports about silent skips (section 5). The other way to win is **unattended runs that survive usage limits**, through the account pool and fallback in agent-pool.md. No competitor except Orca does multi-account, and Orca's switching is manual.

---

## 2. Per-app notes

### Orca (stablyai/orca, MIT, Electron). Local source at C:\rx\orca, last commit 2026-10-21

- **Tasks:** GitHub issues and PRs, Linear, Jira Cloud and Server/DC, GitLab issues and MRs [src: docs/site/content/docs/review/*.mdx].
  - Mobile "New workspace" sources are Smart, GitHub, Linear, GitLab, Branch, Name.
  - Linear: personal API token, board/list views, edit status/priority/labels, opt-in "move to In Progress" on worktree create. Issue images go into the agent prompt.
  - Jira: Cloud uses email + API token or a scoped token. Self-hosted uses PAT or basic auth.
  - Remembers the last task source per repo.
  - **No Monday, Asana, ClickUp or Notion** [src: grep].
- **Code hosts:** GitHub (OAuth, deepest support: Actions, checks, stacked PRs), GitLab (MRs, pipelines with child jobs), Bitbucket Cloud (connect with token, create PRs), Azure DevOps and Gitea (PR status and checks) [src review/github.mdx].
- **MCP:** Settings > Integrations > MCP only **inspects per-repo MCP config files**:
  - It looks at `.mcp.json`, `.cursor/mcp.json`, `.claude.json` and `.claude/mcp.json`, shows missing or invalid ones, and offers a starter config [src: src/shared/mcp-config.ts, McpConfigSection.tsx].
  - It is not a central MCP hub and does not inject servers into agents.
  - Orca exposes itself to agents through **skills plus its CLI** (`orca-cli`, `orchestration`, `orca-linear`, `computer-use`, emulator skills), installed with `npx skills add`. Agents read and write Linear through `orca linear` rather than through an MCP.
  - **Lesson:** Orca chose "skills + CLI" over "MCP server" for its own surface.
- **Scheduled automations** [src cli/automations.mdx]:
  - Presets: hourly, daily, weekdays, weekly, cron or RRULE, with timezone.
  - Targets: `--repo`, or `--workspace` for an existing worktree, or a project on a host (`local`, `ssh:`, `runtime:`).
  - `--precheck "<shell>"` skips the run when the probe exits non-zero. Example: `gh pr list` returns nothing, so no tokens are spent.
  - Also: missed-run grace minutes, `--reuse-session` vs fresh session, extra agent args (model and effort only), Run now, Rerun on failure.
  - Desktop table: filters by host, enabled, last outcome and agent.
- **Usage limits** [src agents/usage-tracking.mdx, codex-hot-swap.mdx]:
  - Status bar shows the 5h, daily and weekly windows for Claude, Codex, Gemini, OpenCode, Kimi and MiniMax. It reads local files, makes no API calls, and warns at 80%.
  - One-click **manual** hot-swap between Claude and Codex accounts. Managed accounts run in isolated homes. Running sessions keep their account.
  - **No automatic failover** found.
- **Notifications:** agent-finished events (working to idle) as a system notification, a sound and a chip. Also a bell inbox, mark unread, custom sounds, and PR check failure alerts [src notifications.mdx].
- **Mobile:** iOS and Android companion, beta [src mobile.mdx].
  - Pairing, live status, scrollback, reply/yes/continue, dictation, a commit from the phone, an account switcher, push on finish, multiple hosts.
  - Remote Orca servers over SSH.
- **Worktrees:** core model, plus `orca.yaml` setup, checkpoints and hibernation.
- **Review:** diff viewer, annotate AI diffs, attribution, commit/push, PR tab with checks and comments.
- **Breadth risk:** also ships an embedded browser with design mode, computer use, iOS/Android emulator control, artifacts publishing, voice and ACP native chat. 3p reviews mention memory use, more than 2k open issues and hotkey churn [3p vibecodinghub, aitoolsatlas]. This is the "kitchen sink" end of the market.

### Conductor (conductor.build, macOS, closed source)

- **Tasks:**
  - Linear since 0.8.0 (Aug 2025), "open from Linear" in 0.36.5.
  - GitHub issues in 0.32.0 (Jan 2026). Create a workspace from an issue (⌘I) in 0.66.0.
  - **No Jira** in the changelog index [src changelog.md].
- **MCP:** MCP support in 0.1.0. Realtime MCP status in chat in 0.50.0. In 0.82.0 (Aug 2026): its own "Conductor MCP" plus cloud MCP servers in Settings > MCP servers. In 0.84.0 it notifies you when a cloud MCP server needs reconnecting [src changelog page 2].
- **Scheduling:**
  - Background tasks and API in 0.77.0, early access.
  - **Routines** in 0.85.0 (Sep 2026): "run your agents on a schedule or via GitHub action". Cloud only, Pro/Team [src].
- **Usage:** Claude plan usage and reset times in the context popover (0.83 to 0.86) [src].
- **Mobile:** Conductor for iOS in 0.90.0 (Oct 2, 2026) [src title only].
- **Review:** strongest focus. Diff panel, code review, Claude comments on code, Checks tab, forward failing checks to Claude, PR page, edit in diff.
- **Complaints:** macOS only is the top reason people leave. UI lags after heavy use [3p superset.sh comparison, biased].

### Crystal → Nimbalyst (stravu)

- Crystal is deprecated. Its last release was v0.3.5 (Feb 26, 2026), with a pointer to Nimbalyst [3p rywalker, github description].
- Nimbalyst keeps parallel worktree sessions and adds a session kanban, WYSIWYG editors, task tracking, an extension system and a native iOS app. MIT since Apr 2026 [3p].
- No known scheduler or issue-tracker sync [UNVERIFIED].

### Claude Squad (smtg-ai)

- Go TUI on tmux, one worktree per session. Supports Claude, Codex, Aider, OpenCode and Amp. `-y` AutoYes daemon. Review/commit then push. About 8.4k stars, updated Aug 2026 [3p].
- No tasks, no MCP management, no scheduler, no usage tracking.
- It is the minimal baseline, and it shows that many users only want "sessions + worktrees + review".

### Vibe Kanban (BloopAI)

- **The company shut down on Apr 10, 2026.** It cited free users and no working business model [src vibekanban.com/blog/shutdown].
  - Hosted cloud features were removed: kanban issues, comments, orgs. It is now community-maintained and local only.
  - It exposed a local MCP server so external clients could manage projects, issues and workspaces.
- **Lesson:** a kanban plus a cloud sync layer was not something people would pay for. Turno should keep tasks thin and local-first.

### Warp (Oz)

- **Oz cloud agents:**
  - Triggers: Slack (@Oz), Linear (@Oz on an issue), Jira, GitHub and GitHub Actions.
  - **Scheduled agents on cron.**
  - Requires a team on the Build, Max or Business plan [src docs.warp.dev].
- **MCP:** the best MCP *management UI* in the set [src docs.warp.dev MCP]:
  - Settings > Agents > MCP servers lists servers with running state.
  - One-click install.
  - Team sharing scrubs `env` secrets into variables, and teammates fill in their own values.
  - Project-scoped servers need approval before they start, so a cloned repo cannot silently launch commands.
  - Cloud runs reference shared servers by UUID.

### Cursor (background/cloud agents + Automations)

- **Starting work:** cloud agents start from the editor, web or mobile (cursor.com/agents), or @Cursor in Slack, GitHub or Linear. You can delegate Linear issues [src cursor.com onboarding].
- **Automations** (Mar 5, 2026) [src changelog 03-05-26]:
  - Run on a schedule, or on events from Slack, Linear, GitHub, PagerDuty and webhooks.
  - Each run gets a cloud sandbox with your configured MCPs.
  - Memory tool that learns across runs.
- **Pains:**
  - Credits burn fast and billing is opaque [3p].
  - Cloud agent incidents: "Repeated cloud agent failures, going on 24h" and "background agents completely unusable" (Mar 2026) [src forum.cursor.com titles].
  - GitHub-only repos. No privacy mode [3p].

### Codex app (OpenAI)

- **Automations** [src learn.chatgpt.com/docs/automations]:
  - Three kinds: standalone tasks (a new chat per run), in-chat tasks (reuse context, minute intervals) and event triggers (Gmail, Slack, GitHub PR; web/mobile only). Custom RRULE.
  - Local runs: in the project dir or in a separate worktree. **The app must be running and the machine on.**
  - "Scheduled" view acts as an inbox, with an unread flag and auto-archive when there is nothing to report.
  - Sandbox levels read-only, workspace-write and full. `approval_policy=never` where policy allows.
  - Skills (`$skill-name`) and plugins are available. Skills can create or update tasks.
- **Worktrees:** keeps about 15 managed worktrees, auto-cleans them with a snapshot, and uses setup scripts [3p danielvaughan].
- Missed-run behavior is not documented [src].

### Claude Code Desktop

- **Local scheduled tasks** [src code.claude.com/docs/en/desktop-scheduled-tasks]:
  - Hourly, daily, weekdays, weekly, manual or cron. The form enforces a 1h minimum; Claude itself can set 1 min or one-shot runs.
  - Optional worktree per run. Permission mode per task, plus a per-task "always allowed" list.
  - Catch-up runs for the last 7 days, but only one run.
  - History with skip reasons: asleep, previous run still running, concurrency.
  - Keep-awake setting. The task can reschedule itself through the `update_scheduled_task` MCP.
  - Prompt stored as `~/.claude/scheduled-tasks/<name>/SKILL.md`. **This is almost exactly Turno's ROUTINE.md model.**
- **Cloud scheduled tasks** (formerly routines): run with the machine off, trigger on API or GitHub events, connectors configured per task, 1h minimum.
- **MCP:** uses config files plus claude.ai connectors.

### Zed

- Parallel agents, with threads in linked git worktrees. Agents connect through ACP (Claude Agent, Codex, Gemini). Terminal Threads (May 2026) bring claude and codex CLIs into the sidebar. MCP "context servers" in settings.json [src zed.dev docs/blog].
- No scheduler, no issue trackers [UNVERIFIED for trackers].

### Superset (superset.sh, Electron + xterm + node-pty: the closest stack to Turno)

- **Basics:** 10+ parallel agents in worktrees with setup scripts, a diff viewer, an in-app browser and port management. Sidebar status, completion chimes and dock badges [3p mintlify mirror, HN].
- **Automations** [src docs.superset.sh/automations]:
  - RRULE schedules **or event triggers**: GitHub, Slack, Linear, **Sentry**, Notion, MS Teams, generic webhooks with a token. Up to 25 triggers per automation.
  - Runs on a chosen target device. **An offline device means a "missed" run with no retry.** Delivery is at least once.
  - Pro/Enterprise only.
- **Other surfaces:** its own MCP server (api.superset.sh/mcp, OAuth 2.1), an SDK, a Slack bot that files tasks and pulls Linear assignees, and mobile (diff review, live sessions) [src/3p].
- Windows support is "untested" [3p].
- **Sentry as an automation trigger** is directly relevant to the user's "connect Sentry" idea.

### Sculptor (Imbue)

- Each agent runs in a Docker container, so there are no permission prompts. "Pairing mode" syncs the container branch two ways into your local IDE. Free beta, BYO Claude/Codex, macOS/Linux. Last public repo push May 2026 (v0.30) [src docs.imbue.com + 3p].
- No scheduler or trackers [UNVERIFIED].

---

## 3. Matrix (compact)

| App | Trackers | MCP mgmt | Scheduled runs | Usage limits | Notif/mobile | Worktrees | Review UI |
|---|---|---|---|---|---|---|---|
| Orca | GH, Linear, Jira, GitLab (+BB/ADO/Gitea PRs) | inspects repo MCP files; own CLI+skills | yes, local/remote, cron/RRULE, precheck, grace | read-only meters, manual multi-account swap | bell, sounds, iOS/Android | yes | full |
| Conductor | GH, Linear | settings list, cloud MCP, own MCP | Routines (cloud, paid) | Claude plan meter | iOS (Oct 26) | yes | best-in-class |
| Nimbalyst | own kanban | ? | ? | ? | iOS | yes | yes |
| Claude Squad | none | none | none | none | none | yes (tmux) | basic |
| Vibe Kanban | own kanban (cloud removed) | exposes own MCP | none | none | none | yes | yes |
| Warp Oz | Linear, Jira, GH, Slack | best: list, 1-click, team share, approval | cron (cloud, team plans) | credits | Slack threads | n/a | basic |
| Cursor | Linear, GH, Slack, PagerDuty | per-run MCPs | Automations (cloud) | credits (pain) | web/mobile | cloud VMs | yes |
| Codex app | GH events (web) | plugins/skills | Automations (local, app open) | ? | inbox | yes, managed | yes |
| Claude Desktop | GH events (cloud) | config + connectors | local + cloud scheduled tasks | plan meter in app [UNVERIFIED] | desktop notif, Remote Control | optional per task | yes |
| Zed | none | context servers | none | n/a | none | linked worktrees | editor |
| Superset | Linear, GH, Sentry, Slack, Notion, Teams (as triggers) | own MCP; client config | RRULE + event triggers, device-targeted | ? | chimes, mobile | yes | yes |
| Sculptor | none | ? | none | n/a | none | containers | pairing |

**No one integrates Monday.com, Asana or ClickUp.** Trackers that appear: GitHub, Linear, Jira, GitLab, and Sentry/PagerDuty as *triggers*.

---

## 4. Table stakes vs ownable gaps vs clutter

### Table stakes (Turno must have some version)

1. **Agent status and done/needs-input notifications.** Every app has them. Turno has ntfy, which is good. Add an in-app unread inbox for runs with a "nothing to report" auto-archive (the Codex pattern).
2. **Visible usage-limit meters with reset times.** Orca, Conductor and Claude Desktop show them. Read the local files the way Orca does: no API, no auth.
3. **Run history with skip and failure reasons** (Claude Desktop): asleep, overlapping, limit hit, precheck false.
4. **GitHub issues/PRs as a task source.** Then Linear, then Jira. Every tracker-integrated competitor starts with GH + Linear.
5. **Worktree option per routine/session.** Claude Desktop, Codex and Orca all offer it. Optional, not forced.
6. **Permission mode per routine.** Also a per-routine allowlist, so unattended runs don't stall on a prompt.

### Gaps Turno can own

1. **A reliable local scheduler on Windows.**
   - Claude Desktop's local scheduler has open reports: false "computer asleep" skips on awake Windows, silent skips Sep 17–21 2026 with about 14 tasks, lost dispatch after Modern Standby, catch-up dropped at startup [src claudeissues.com mirrors of anthropics/claude-code issues 55565, 95966, 74432, 73927].
   - Superset marks offline runs "missed" with no retry. Codex documents nothing.
   - Turno already has keep-awake. Add an explicit catch-up policy (skip / run once / run all), grace windows and visible skip reasons. Optionally register Windows Task Scheduler wake timers [UNVERIFIED feasibility] so runs fire even when the app is closed.
2. **Limit-aware unattended runs.**
   - Report: "Session usage limit silently kills background agents and prevents scheduled tasks from firing", with no deferral to the reset time [src claudeissues 80037].
   - GitHub feature request: auto-resume after the limit [src github.com/anthropics/claude-code/issues/62788].
   - Turno's agent-pool can do three things here: (a) defer the run to the reset time, (b) fall back to the next ranked connection (Ollama/Qwen or another endpoint), (c) notify through ntfy.
   - Orca only does manual swaps. Caution on ToS: switching between *multiple personal subscription accounts* is a policy grey area. Prefer falling back to a different provider/endpoint [UNVERIFIED policy].
3. **Precheck / cheap gate before spending tokens.** Orca's `--precheck` shell probe is a great idea. Nobody else has it in UI form. Use it as a ROUTINE.md frontmatter field.
4. **Multi-provider routines including local models.** Ollama endpoints as a first-class fallback. Cloud-first competitors can't offer this.
5. **Windows-first.** Conductor is macOS only, and Superset and Sculptor treat Windows as untested or unsupported. This is the most common reason users leave Conductor [3p].
6. **"Connections" as one place that feeds every agent.** Nobody does a central MCP hub that injects into *all* agent CLIs launched from the app:
   - Orca inspects per-repo files.
   - Warp manages servers for its own agent.
   - Conductor has its own settings list.
   - There is a real gap, but see the clutter warning below: keep it to a "write the config the CLI already reads" layer, not a bespoke runtime.

### Shipped by others, probably ignored or risky (avoid)

- **Hosted kanban / issue tracker clones.** Vibe Kanban's company died, and the cloud kanban features were the first thing removed [src]. Nimbalyst is betting on it with thin user evidence [3p]. Pull from real trackers; don't build one.
- **Monday/Asana/ClickUp integrations.** Zero competitors bothered. Low dev-tool usage. Fine to leave to MCP.
- **Embedded browser/design mode, emulator control, computer use, artifacts publishing, voice** (Orca). Breadth correlates with bugs and churn complaints [3p]. Skip.
- **Cloud sandboxes / cloud routines.** These need infra plus billing, and cause cost complaints and incidents for Cursor [src forum], plus paid-tier gating for Conductor, Warp and Superset. Turno's identity is local.
- **Exposing Turno's own MCP server** (Conductor, Superset, Vibe Kanban). Orca's CLI + skills approach is simpler and cheaper on context. If agents need to call Turno, a small CLI plus one skill is enough.
- **Many event triggers** (Superset allows 25 per automation, plus Teams and Notion). Start with one webhook trigger, plus maybe GitHub PR. Sentry is the only "debug" trigger with a clear use case: a new issue triggers a triage routine.
- **Session kanban views.** Users mostly want status plus review [3p HN sentiment: review is the bottleneck].

---

## 5. Developer pains seen (to solve in Turno)

1. **Review is the bottleneck, not generation.** Agents produce more diff than humans can audit. HN suggests tight per-worktree contracts: scoped task, invariant tests, small diff [3p HN 50060068 / 50059523 via summaries].
   - Turno: routine outputs should end in a short summary plus "nothing to report" auto-archive. Don't add more parallelism.
2. **Silent scheduler failures** (section 4 gap 1). The users who report them cannot tell *why* a run didn't fire.
3. **Usage limits kill unattended work silently.** Users build external resume scripts and cron retries [3p dev.to, shyft.ai].
4. **Permission prompts stall unattended runs** (Claude docs explicitly warn about this). MCP tools marked `requiresUserInteraction` stall every time [src].
5. **Cost opacity and credit burn** in cloud agents (Cursor) [3p].
6. **Platform lock-in.** Several tools are macOS only.
7. **Worktree setup friction.** Gitignored deps and .env are missing, so tools need setup scripts. Disk sprawl means auto-cleanup is needed [3p danielvaughan].
8. **Trust/accuracy** [3p coverage of SO survey 2025]:
   - 66% of developers say AI output is "almost right, but not quite".
   - 46% distrust AI accuracy.
   - Only 14% use agents daily, and 87% worry about agent accuracy.
   - Unattended routines therefore need guardrails and a cheap review loop.
9. **App breadth leads to bugs and memory use** (Orca, Electron + many agents) [3p].

---

## 6. Sources

- Orca local source and docs: C:\rx\orca\docs\site\content\docs\{cli/automations.mdx, cli/skills.mdx, agents/usage-tracking.mdx, agents/codex-hot-swap.mdx, review/jira.mdx, review/linear.mdx, review/github.mdx, mobile.mdx, notifications.mdx, settings.mdx}; src/shared/mcp-config.ts; src/renderer/src/components/settings/McpConfigSection.tsx
- Conductor: https://www.conductor.build/changelog.md , https://www.conductor.build/changelog/page/2
- Claude Code Desktop scheduled tasks: https://code.claude.com/docs/en/desktop-scheduled-tasks
- Codex automations: https://learn.chatgpt.com/docs/automations?surface=app (redirect from developers.openai.com/codex/app/automations)
- Codex worktrees (3p): https://codex.danielvaughan.com/2026/04/11/codex-app-worktree-lifecycle-local-environments/
- Cursor: https://cursor.com/changelog/03-05-26 , https://cursor.com/cn/onboarding/integrations , https://forum.cursor.com/t/repeated-cloud-agent-failures-going-on-24h/161038 , https://forum.cursor.com/tag/long-running-agents/374
- Warp: https://docs.warp.dev/agent-platform/cloud-agents , https://docs.warp.dev/agent-platform/cloud-agents/integrations , https://docs.warp.dev/agent-platform/capabilities/mcp , https://docs.warp.dev/knowledge-and-collaboration/mcp
- Superset: https://docs.superset.sh/automations , https://docs.superset.sh/mcp-server , https://docs.superset.sh/use-with-slack , https://news.ycombinator.com/item?id=46368739 , https://superset.sh/changelog/2026-08-30-seventeen-languages-session-handoff
- Vibe Kanban shutdown: https://vibekanban.com/blog/shutdown , https://vibekanban.com/docs/integrations/vibe-kanban-mcp-server
- Crystal/Nimbalyst (3p): https://github.com/stravu/crystal , https://rywalker.com/research/nimbalyst
- Claude Squad: https://cdn.jsdelivr.net/gh/smtg-ai/claude-squad@main/README.md
- Zed: https://zed.dev/docs/ai/parallel-agents , https://zed.dev/blog/terminal-threads
- Sculptor: https://docs.imbue.com/features/pairing-mode , https://rywalker.com/research/sculptor
- Scheduler bugs: https://claudeissues.com/issue/55565-bug-scheduled-tasks-skipped-as-computer-asleep-on-awake-windows-system , https://claudeissues.com/issue/95966-scheduled-tasks-silently-skip-their-fire-window-with-host-machine-and-scheduler , https://claudeissues.com/issue/74432-scheduled-task-silently-skipped-after-wake-from-standby-dispatch-cleared-but-las , https://claudeissues.com/issue/73927-desktop-app-scheduled-tasks-missed-run-catch-up-dispatch-silently-dropped-during
- Limits: https://claudeissues.com/issue/80037-session-usage-limit-silently-kills-background-agents-and-prevents-scheduled-task , https://github.com/anthropics/claude-code/issues/62788
- Comparisons (biased, vendor): https://superset.sh/compare/orca-vs-conductor
- Review bottleneck: https://news.ycombinator.com/item?id=50060068 , https://news.ycombinator.com/item?id=50059523
- SO survey 2025 coverage: https://shiftmag.dev/stack-overflow-survey-2025-ai-5653/ , https://the-decoder.com/developers-rely-on-ai-tools-more-than-ever-but-trust-is-slipping/
- Orca reviews (3p): https://vibecodinghub.org/blog/orca-review , https://aitoolsatlas.ai/tools/orca-stably/pros-cons
