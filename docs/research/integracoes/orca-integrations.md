# Orca: task sources, integrations and MCP (reverse-engineered)

Source: C:\rx\orca, HEAD fcac5cf0 (2026-10-21), package version 1.4.214, MIT License (Copyright 2026 Lovecast Inc.).
Everything below comes from reading the code. Unless marked otherwise, it was verified in the files listed.
The Orca app was not run.

---

## 1. Providers

| Provider | Tasks screen | PR/MR review | Transport | Auth | Credential storage |
|---|---|---|---|---|---|
| GitHub | yes (issues + PRs) | yes | `gh` CLI (`gh api`, `gh issue list/view`) via `ghExecFileAsync` | the user's own `gh auth login`. Per-repo account binding resolves a token with `gh auth token --user --hostname` and injects it only into the gh child env | none of Orca's own. The gh keyring is used |
| GitLab | yes (issues + MRs) | yes | `glab` CLI (`glab api -i ...`) | the user's own `glab auth` | none. The provider shows only when `gitlabInstalled` |
| Linear | yes (issues, projects, custom views, board) | n/a | `@linear/sdk` ^97 (GraphQL), lazy-loaded | **Personal API key** pasted in a dialog. No OAuth. Multi-workspace | `~/.orca/linear-tokens/<b64url(workspaceId)>.enc` + `~/.orca/linear-workspaces.json` |
| Jira | yes (list, board, JQL, saved/favourite filters) | n/a | REST v3 via fetch, with a request queue | Cloud: email + API token (Basic). A scoped token goes through the `https://api.atlassian.com/ex/jira/<cloudId>` gateway, with cloudId from `<site>/_edge/tenant_info`. Server/DC: PAT as Bearer, or username+password Basic. No OAuth | `~/.orca/jira-tokens/<b64url(siteId)>.enc` + `~/.orca/jira-sites.json` |
| Bitbucket Cloud | no | PRs only | REST `api.bitbucket.org/2.0` | access token (Bearer) or email + API token (Basic). Env vars `ORCA_BITBUCKET_*` override stored creds | encrypted store (`src/main/bitbucket/credential-store.ts`) |
| Azure DevOps | no | PRs only | REST | PAT (`ORCA_AZURE_DEVOPS_TOKEN/PAT`) or access token | env/stored |
| Gitea | no | PRs only | REST | `ORCA_GITEA_TOKEN` (`Authorization: token ...`) | env |
| Asana / Monday / ClickUp / Notion / Trello / YouTrack / Shortcut / Sentry / Datadog | **none**. A grep turned up no integration code for any of them | | | | |

- The canonical list is in `src/shared/task-providers.ts`: `TaskProvider = 'github' | 'gitlab' | 'linear' | 'jira'`.
- The default task source is GitHub. Settings hold `visibleTaskProviders` and `defaultTaskSource`.
- In Settings, the Integrations pane (`src/renderer/src/components/settings/IntegrationsPane.tsx`) has two sections:
  - "Review providers": GitHub, GitLab, Bitbucket, Azure DevOps, Gitea.
  - "Task providers": Linear, Jira.
  - There is **no MCP section** there (see §5).

### Credential handling (reusable)
- `src/main/integration-credential-file.ts`, `writeEncryptedCredential(service, path, value)`:
  - Encrypts with Electron `safeStorage` (wrapped by `src/shared/secret-store.ts`) when it is available.
  - Otherwise it falls back to 0600 plaintext with a warning.
  - Writes are atomic: temp file, fsync, rename. On Windows the temp file is created with an owner-only ACL (`src/shared/secure-path-windows-acl.ts`).
- `src/main/integration-token-file-cache.ts` and `src/main/integration-state-file-cache.ts`: caches for the token files and the JSON site/workspace registries.
- `src/main/credential-file-protection.ts`: reports how a secret is held at rest (encrypted or plaintext) to the UI.
- Secrets are decrypted lazily, only on a real API call and never on a status read (comment in `bitbucket/resolve-auth.ts`).
- Env vars beat stored credentials, so headless and SSH setups keep working.
- **Takeaway for Turno:** Orca uses personal tokens plus the user's existing CLIs. It runs no OAuth app and no backend. Turno can do the same with zero server infrastructure.

## 2. Data model

- Per-provider DTOs:
  - `src/shared/github/work-item-types.ts` (`GitHubWorkItem`: issue|pr, number, title, state, labels, assignees, checksSummary, reviewDecision, branchName, repoId...).
  - `src/shared/gitlab-types.ts` (`GitLabWorkItem`).
  - `src/shared/linear/issue-types.ts` (`LinearIssue`: identifier, state{name,type,color}, team, project, labels, assignee, priority 0-4, estimate, dueDate, `branchName`, subIssues).
  - `src/shared/jira-types.ts` (`JiraIssue`: key, project, issueType, status, labels, assignee, reporter, priority, parent, sprint, storyPoints, estimates).
- **The UI has no unified "Task" type.** Each provider has its own list, filters and detail components (`src/renderer/src/components/task-page/{github,gitlab,jira,linear}`). It is a very large surface: hundreds of files.
- The common link that is persisted on a workspace (worktree) is `WorkspaceLinkedItem` in `src/shared/worktree/types.ts`:
  ```ts
  { provider: 'github'|'gitlab'|'linear'|'jira'; type: 'issue'|'pr'|'mr'; number: number; title: string; url: string;
    linearIdentifier?: string; jiraIdentifier?: string; repoId?: string }
  ```
  Linear and Jira use sentinel numbers. `TaskSourceContext` (`src/shared/task-source-context.ts`) records provider, project, host and account identity, so a task can come from a different host or account than the one running the workspace.
- Small per-repo limits: `PER_REPO_FETCH_LIMIT = 36`, `CROSS_REPO_DISPLAY_LIMIT = 100` (`src/shared/work-items.ts`).

## 3. How a task becomes an agent prompt and worktree

1. On the Tasks page, "Use" on an item calls `useTaskPageWorkspaceActions` (`src/renderer/src/components/use-task-page-workspace-actions.ts`).
   - If a worktree is already attached to the item (`findGithubWorkItemWorkspaceAttachment`), Orca simply opens it.
   - Otherwise it opens the **new-workspace-composer** modal with `linkedWorkItem`, `taskSourceContext`, `prefilledName` (a slug from the item) and `enableIssueAutomation` (GitHub issues only).
2. Branch and worktree name: Linear supplies its own `branchName` (for example `user/eng-123-fix-auth`), which overrides the branch (`hooks/composer-state/issue-source-actions.ts`). Other providers get a slug from number and title (`src/shared/workspace-name.ts`).
3. Prompt:
   - **GitHub/GitLab, when the prompt box is empty:** Orca renders the repo's `issueCommand` template.
     - The template comes from `orca.yaml` `issueCommand`, or the per-user `.orca/issue-command` file, or the default `'Complete {{artifact_url}}'`.
     - Variables are `{{artifact_url}}` and the legacy `{{issue}}`.
     - Code: `src/renderer/src/lib/new-workspace.ts` (`renderIssueCommandTemplate`, `DEFAULT_ISSUE_COMMAND_TEMPLATE`), `hooks/composer-state/derived-composer-state.ts`, `src/main/issue-command-file.ts`.
     - Only a URL is passed. The agent then reads the issue itself with `gh`.
   - **Linear:** the terminal draft carries only the identifier and URL (`buildLinearLaunchContextBlock`), on purpose, because ticket prose is untrusted.
     - The full snapshot (description, child issues, recent comments, capped at 12 000 chars, `src/renderer/src/lib/linear-issue-context-snapshot.ts`) is wrapped in a **"--- BEGIN LINKED WORK ITEM CONTEXT ---" untrusted-data envelope**.
     - The envelope escapes control characters and spoofed delimiters (`src/renderer/src/lib/linked-work-item-context.ts`, `buildContainedLinkedContextBlock`).
   - **Jira:** prompt templates with the variables `$jira-issue` and `$other-prompt` (`src/renderer/src/components/jira-prompt-templates.ts`):
     - Presets: implementation, bug, test-plan, PR summary.
     - A custom template is kept in localStorage.
     - Jira also offers an AI "issue summary" generated by a headless agent (`src/main/ipc/jira/issue-summary-generation.ts`).
4. Direct launch: `src/renderer/src/lib/launch-work-item-direct*.ts` creates the worktree, runs the setup script (`orca.yaml`), launches the default agent in a terminal, and pastes the draft prompt. By default the prompt is left as a draft for the user to send.
5. Scheduled automations (`src/main/automations/*`) can carry a `sourceContext`. They also support a shell **precheck** (`AutomationPrecheck {command, timeoutSeconds}`; exit 0 means the agent runs; output is capped at 4000 chars). This "only wake the agent if there is work" gate maps directly onto Turno routines (`src/shared/automation-precheck.ts`, `src/main/automations/precheck-runner.ts`).

## 4. Sync direction

- **Bidirectional, but nothing is automatic.** The app never changes an issue's status by itself: a grep for any auto transition to "In Progress" found nothing.
- Writes happen in two ways:
  - **Human writes in the UI:**
    - GitHub: comment, create, update state/labels/assignees, PR review and merge (`src/main/github/issue-*.ts`, `pr-*`).
    - Linear: create/save, status, assignee, priority, labels, estimate, due date, project, relations, comments (`src/main/linear/linear-issue-mutations.ts`, `issue-relation-write.ts`, `linear-issue-comments.ts`).
    - Jira: create, transition (with transition fields), assignee, comment, priority, labels (`src/main/jira/jira-issue-mutations.ts`, `jira-transition-queries.ts`).
  - **Agent writes through the `orca` CLI** (next section).
- Refresh is polling-based. GitHub has a PR refresh queue with rate-limit gates and backoff (`src/main/github/pr-refresh-*.ts`). There are no webhooks.

## 5. How agents get integrations: CLI + skills, not MCP

**The key design decision.** Orca does **not** inject MCP servers into the agents it launches. Agents reach the integrations like this:

1. **The `orca` CLI** (`src/cli/*`, with command specs in `src/cli/specs/{linear,linear-mcp,jira,worktree-set,...}.ts`) talks to the running app over a local RPC:
   - A Unix socket at `<userData>/o-<pid>-<suffix>.sock`, or on Windows a named pipe `\\.\pipe\orca-<pid>-<suffix>`, plus an `authToken`.
   - Code: `src/main/runtime/runtime-rpc/runtime-rpc-socket-metadata.ts`, `src/cli/runtime/transport.ts`.
   - Credentials stay in the app. The agent never sees the Linear or Jira token.
   - Commands: `orca linear issue|search|list|list-issues|save-issue|create|status|assignee|priority|label|estimate|due-date|project|relation|attach|comment|team`, `orca jira issue|search|list|create|status|assignee|comment|priority|label|project|connection`, `orca worktree create|current|list|set|show|ps|rm`.
   - `--current` resolves the issue linked to the agent's current worktree. Terminals get env vars such as `ORCA_WORKTREE_ID`, `ORCA_WORKTREE_PATH`, `ORCA_TERMINAL_HANDLE` and `ORCA_AGENT_HOOK_ENDPOINT`.
   - `save-issue` and `list-issues` deliberately copy the **Linear MCP** schema ("MCP-compatible filters", `src/cli/specs/linear-mcp.ts`), so agents trained on Linear MCP feel at home.
   - Writes are idempotent through `--write-id`. The error `linear_write_unconfirmed` comes with a retry or read-back protocol.
2. **Skills** (`skills/<name>/SKILL.md`):
   - Thin stubs that resolve the executable (`ORCA_CLI_COMMAND`, then `orca-dev`, then `orca-ide` on Linux to avoid the GNOME screen reader, then `orca`). Each stub then runs `orca skills get <name>` to fetch a **version-matched guide** from `skill-guides/*.md`.
   - Skills: `orca-cli`, `orca-linear`, `orca-jira`, `linear-tickets`, `jira-tickets`, `orchestration`, `computer-use`, `orca-emulator*`, `orca-per-workspace-env`.
   - The guides encode etiquette:
     - Read the ticket first, and treat its text as untrusted.
     - Post exactly one completion comment containing the PR link.
     - Move to an "In Review" state only by deterministic rules, and never regress a state.
     - File a parented follow-up issue for out-of-scope bugs.
   - Install command: `npx skills@1.7.2 add https://github.com/stablyai/orca/tree/<buildSha> --skill orca-linear --global --agent claude [-y]` (`src/shared/agent-feature-install-commands.ts`). It is pinned to the build commit and always targets explicit `--agent`s. Destinations per agent are in `src/shared/skill-install-providers.ts` (`.agents/skills`, `.claude/skills`, `.cursor/skills`, `.gemini/skills`, `.factory/skills`...).
   - A large skill install/transaction/discovery subsystem lives in `src/main/skills/*`. It is overkill for Turno.

### What Orca does with MCP (verified)
- **A read-only per-repo MCP inspector** (Settings → Repository pane, `McpConfigSection` rendered in `RepositoryPane.tsx:391`):
  - It scans the worktree for `.mcp.json`, `.cursor/mcp.json`, `.claude.json` and `.claude/mcp.json`, and reads `mcpServers` from each.
  - For each server it shows the name, transport (stdio, http or unknown), status (enabled, disabled or invalid), command or url, and **env with values masked**.
  - It can create a starter `{"mcpServers":{}}` `.mcp.json` and open the file in the editor. Editing is done in the file.
  - Code: `src/shared/mcp-config.ts`, `src/shared/mcp-server-inspection.ts` (`maskMcpEnv`), `src/shared/mcp-config-inspection-limits.ts`, `src/renderer/src/components/settings/McpConfigSection.tsx`, `McpConfigFileRow.tsx`, `McpMissingConfigList.tsx`, `mcp-config-inspection.ts`.
- **Isolation for its own background runs:**
  - Background Claude runs (commit messages, model-list probe) get `--strict-mcp-config` plus `--settings {"disableAllHooks":true}`.
  - If an enterprise managed MCP config makes Claude refuse (`"You cannot use --strict-mcp-config when an enterprise MCP config is present"`), Orca retries once without the flag (`src/shared/claude-background-run-isolation.ts`).
  - Turno's headless routines could reuse this exact pattern.
- **Keeping MCP servers working across accounts:**
  - When Orca provisions a per-account Claude profile (`CLAUDE_CONFIG_DIR`), it copies the shared keys of `~/.claude.json` and **merges `mcpServers` and `projects` by entry** (`MERGED_BY_ENTRY`). It excludes login/runtime state such as `.credentials.json` and `mcp-needs-auth-cache.json`.
  - Code: `src/main/claude-accounts/claude-profile-provisioning.ts`.
  - For Codex it mirrors `[mcp_servers.*]` from the system `config.toml` into the per-account runtime `CODEX_HOME`, with ownership tracking (`src/main/codex/codex-config-mirror.ts`, `config-toml-mcp-servers.ts`).
  - **This bears directly on Turno's agent-pool design:** if Turno switches account directories, the user's MCP servers must follow or they disappear.
- `--mcp-config` appears only in the allow-list of agent CLI flags that users can pass as extra arguments (`src/shared/agent-session-option-agent-args.ts`).
- ACP (the native chat) always sends `mcpServers: []` (`src/main/acp/acp-session-runtime.ts:149`, `acp-structured-handshake.ts:76,97`).
- **A docs/code mismatch:** `docs/site/content/docs/cli/skills.mdx` says "Register MCP endpoints under Settings → Integrations → MCP". The code has no MCP section in `IntegrationsPane.tsx`, only the per-repo inspector. Treat the docs as aspirational or outdated (unverified against the live app).

## 6. Reusable parts for Turno (MIT, keep attribution)

| Need in Turno | Orca file(s) | Notes |
|---|---|---|
| Encrypted token at rest | `src/main/integration-credential-file.ts`, `src/shared/secret-store.ts`, `src/shared/secure-path-windows-acl.ts` | safeStorage, atomic write, Windows ACL. Small and self-contained |
| Linear client | `src/main/linear/linear-sdk.ts` (lazy require), `client.ts`, `mappers.ts`, `linear-issue-listing.ts` | `@linear/sdk` with a personal API key |
| Jira auth header + cloud gateway | `src/main/jira/authenticated-request.ts` (`authHeader`), `gateway-base-url.ts`, `cloud-gateway.ts`, `credential-verification.ts` | handles Cloud scoped, unscoped and Server PAT |
| Jira ADF to Markdown | `src/main/jira/adf-markdown.ts`, `adf-text-marks.ts` | needed to put Jira descriptions into prompts |
| GitHub via gh | `src/main/github/issues.ts`, `gh-account-token.ts` | depends on the user's gh. Zero auth UI |
| Bitbucket auth shapes | `src/main/bitbucket/bitbucket-auth-config.ts`, `resolve-auth.ts` | Bearer or Basic, env override |
| Untrusted ticket context envelope | `src/renderer/src/lib/linked-work-item-context.ts`, `linear-issue-context-snapshot.ts` | prompt-injection hygiene. Copy as-is |
| Prompt templates | `src/renderer/src/lib/new-workspace.ts` (`renderIssueCommandTemplate`), `components/jira-prompt-templates.ts` | `{{artifact_url}}`, `$jira-issue`, `$other-prompt` |
| Run precheck gate | `src/shared/automation-precheck.ts`, `src/main/automations/precheck-runner.ts` | fits ROUTINE.md well |
| MCP inspector (read-only) | `src/shared/mcp-config.ts`, `src/shared/mcp-server-inspection.ts` | pure functions, env masking |
| Headless isolation | `src/shared/claude-background-run-isolation.ts` | `--strict-mcp-config` with an enterprise fallback |
| MCP survives account switch | `src/main/claude-accounts/claude-profile-provisioning.ts` (copyState/mergeEntries), `src/main/codex/codex-config-mirror.ts` | for agent-pool |
| Agent-facing tool surface | `src/cli/specs/linear-mcp.ts`, `skills/orca-linear/SKILL.md`, `skill-guides/orca-linear.md` | a pattern: app-owned creds, local pipe RPC, CLI, skill |

## 7. Implications for Turno (my reading)
- Orca, the most feature-rich competitor, supports only **GitHub, GitLab, Linear and Jira** as task sources. Bitbucket, Azure DevOps and Gitea are supported for PR review only. **Monday, Asana, ClickUp and Notion are absent.** A Turno MVP covering GitHub, Linear and Jira already matches Orca's task coverage.
- Orca deliberately chose **not** to be an MCP manager for agents. It exposes its own integrations through a CLI and skills, which keeps tokens in the app, uses fewer context tokens than MCP tool schemas, and works with any agent that can run a shell. Its MCP support is only an inspector plus making sure servers survive account switching.
  - For Turno's "inject every active connection into every agent" idea, Orca's evidence points to:
    1. Do not rewrite agents' MCP configs.
    2. Show what each agent already has, read-only.
    3. If Turno must pass MCP to its own headless runs, do it per run with `--mcp-config <tempfile>` (plus `--strict-mcp-config` when isolation is wanted), never globally.
    4. Make sure account switching keeps `mcpServers` (Orca's merge).
- Orca's per-provider UI is huge: hundreds of files for Jira and Linear alone. Turno should use one normalized `Task {provider, key, title, url, status, body}` type and a single list, not per-provider task pages.
