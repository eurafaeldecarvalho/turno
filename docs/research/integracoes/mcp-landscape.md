# MCP landscape (Oct 2026) for Turno: should it have an "MCP hub"?

Research date: 2026-10-21. Tags: [V] = checked in official docs or source; [S] = secondary source (blog or vendor); [U] = unverified or conflicting.

---

## 0. TL;DR

- Every agent CLI Turno launches already has native MCP: its own config file, its own `mcp add/list/login`, OAuth with discovery, tool filtering, and (in Claude Code) lazy tool loading. **Building another MCP client or "connection manager" UI per agent would be redundant.**
- What none of them do: **share one config across agents**, **share one OAuth login and secret store across agents**, **enable or disable a set of servers for one session or routine without editing files**, and **share server processes across N parallel sessions**. Those are exactly the gaps Turno sits in, because Turno starts each agent process and controls its argv, env and cwd.
- The proposed "initial instruction that lists every MCP and connection" is **mostly redundant, and partly harmful**. Agents already receive tool names and descriptions from the protocol, and Claude Code also gets `instructions` from each server. A hand-written list duplicates that, costs tokens on every session, and goes stale. A short, per-profile note is useful only for **non-MCP connections** (gh/aws/az CLIs, which account or profile to use, "prod is read-only").
- Recommended scope, smallest first: (1) per-routine and per-session **MCP profile selection** injected at launch (`--mcp-config` + `--strict-mcp-config` for Claude, `-c mcp_servers...` for Codex, ACP `mcpServers`); (2) **secrets vault** (OS keychain via Electron safeStorage) injected as env vars, never written into config files; (3) a curated **"recommended servers" list** of about 6 to 8 entries, not a marketplace; (4) optionally later, **one shared local gateway** for stdio servers and OAuth, if process count or re-login becomes real pain.

---

## 1. How each agent loads MCP servers

### Claude Code [V] (https://code.claude.com/docs/en/mcp)
- Scopes: `local` (default; stored in `~/.claude.json` under `projects[<path>].mcpServers`), `project` (`.mcp.json` at repo root, committed, needs approval in interactive mode), `user` (`~/.claude.json` top-level `mcpServers`). Precedence: local > project > user > plugin servers > claude.ai connectors. On a name clash the whole winning entry is used; fields are not merged. Org `managedMcpServers` ranks above all (v2.1.259+). `managed-mcp.json` deploys a fixed set, and `allowedMcpServers` / `deniedMcpServers` restrict what users can add (see /docs/en/managed-mcp).
- CLI: `claude mcp add --transport http|stdio|sse <name> ...`, `add-json`, `list`, `login`/`logout` (`--no-browser`), `reset-project-choices`, plus `/mcp` in the TUI.
- Per-launch: `--mcp-config <file or json>`, and `--strict-mcp-config` = use only those servers. **Best hook for Turno**: inject a generated file per session without touching user config. Orca already uses `--strict-mcp-config` for background runs (`C:\rx\orca\src\shared\claude-background-run-isolation.ts`). Its gotcha: the flag fails with "You cannot use --strict-mcp-config when an enterprise MCP config is present".
- Transports: http (recommended), sse (deprecated; v2.1.265+ tries http first), stdio, ws (only via JSON).
- OAuth: on 401/403 the server is marked needs-auth. Discovery uses RFC 9728 and then RFC 8414. DCR is the default, CIMD is auto-detected, and `--client-id/--client-secret` and `--callback-port` are supported. Tokens go in the keychain on macOS, otherwise a credentials file. Tokens are **per Claude config dir**, so each `CLAUDE_CONFIG_DIR` (that is, each account in the agent-pool design) has its own MCP logins.
- `.mcp.json` env expansion: `${VAR}` and `${VAR:-default}` in command/args/env/url/headers. Credential-looking Anthropic vars are blanked for remote servers. `headersHelper` is a shell command that prints JSON headers (10 s cap, re-run on 401). **This means Turno can keep secrets out of files: config references `${SENTRY_TOKEN}` and Turno sets the env var at spawn.**
- Context: **tool search is on by default**. Only tool names and server instructions load upfront, and schemas load on demand. Options: `ENABLE_TOOL_SEARCH=auto|auto:N|false`, plus per-server `alwaysLoad`. Server `instructions` are capped at 4,096 chars and deferred-tool descriptions at 16,384. Output is capped by `MAX_MCP_OUTPUT_TOKENS` (default 25k; larger results spill to a file). Also `MCP_TIMEOUT` (startup), per-server `timeout`, idle timeouts, and `MCP_CONNECTION_NONBLOCKING` (servers connect in the background by default).
- claude.ai connectors load only with subscription login. Disable them with `disableClaudeAiConnectors` / `ENABLE_CLAUDEAI_MCP_SERVERS=false`.
- Plugins can ship MCP servers (`mcp__plugin_<p>_<s>__<tool>`).
- Turno today: `src/main/claudeprep.ts` already edits `~/.claude.json` (trust + Chrome), `runner.ts` parses `mcp_servers` from the stream-json init event, and `killTree` kills MCP grandchildren.

### Codex CLI / app / IDE [V] (https://learn.chatgpt.com/docs/extend/mcp?surface=cli, redirected from developers.openai.com/codex/mcp)
- `~/.codex/config.toml` and `.codex/config.toml` (trusted projects only). CLI, app and IDE share it. Each server is a `[mcp_servers.<name>]` table.
- stdio keys: `command, args, env, env_vars` (forward named vars), `cwd`. HTTP keys: `url, auth = oauth|chatgpt, bearer_token_env_var, http_headers, env_http_headers, http_headers_helper`. Common keys: `startup_timeout_sec` (10), `tool_timeout_sec` (60), `enabled`, `required`, `enabled_tools/disabled_tools`, `default_tools_approval_mode`, per-tool `approval_mode` / `output_token_limit`. Top-level: `mcp_optional_startup_grace_ms`.
- `codex mcp add|list|login|logout`. Login uses CIMD or DCR (auto), with loopback callback options. A pre-registered client secret is stored in config.toml in plain text.
- Per-launch overrides: `codex -c key=value` works for config keys generally [S/U: the docs page did not show the MCP-specific `-c` syntax; `-c 'mcp_servers.x.enabled=false'` is plausible but not checked]. `CODEX_HOME` swaps the whole config dir.
- Note: `bearer_token_env_var` and `env_http_headers` mean secrets can come from env vars injected by Turno.

### Gemini CLI, now Antigravity CLI
- Gemini CLI [V] (https://geminicli.com/docs/tools/mcp-server/): `mcpServers` in `~/.gemini/settings.json` / `.gemini/settings.json`. Fields: `command|url(SSE)|httpUrl`, `args, cwd, env, headers, timeout, trust, includeTools, excludeTools, authProviderType, oauth`. OAuth uses `dynamic_discovery` + DCR, and tokens are stored in `~/.gemini/mcp-oauth-tokens.json`. `gemini mcp add/list/remove/enable/disable [--session]`, with state in `~/.gemini/mcp-server-enablement.json`. Env is **sanitized**: secret-looking host vars are hidden from MCP servers unless listed explicitly in `env`. `mcp.allowed` and `mcp.excluded` filter by name.
- That same page says **Gemini CLI was replaced by Antigravity CLI on 2026-06-18**.
- Antigravity CLI [S/U]: `mcpServers` in `~/.gemini/config/mcp_config.json` (global) and `.agents/mcp_config.json` (workspace). Remote servers use **`serverUrl`**, and the legacy `url/httpUrl` are rejected. OAuth applies when headers are omitted. Sources: https://medium.com/google-cloud/configuring-mcp-servers-and-skills-for-antigravity-cli-and-ide-a938c7eebb78 , https://cua.ai/docs/use-cua-with/antigravity-cli . The paths disagree across sources, so check them against official docs.

### GitHub Copilot CLI [V] (https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- User config is `~/.copilot/mcp-config.json`. Project configs are `.mcp.json` (walked up from cwd to the repo root; closer ones win) and `.github/mcp.json`. `.vscode/mcp.json` is NOT read. Project servers load only in trusted folders, and in `-p` mode only when `GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP=true`.
- `copilot mcp add|list|get|remove|enable|disable` (`--tools`, `--env`, `--header`). `/mcp`, `/mcp search` (GitHub MCP Registry, experimental). A **built-in GitHub MCP server** ships with it. Per-server `"tools"` allowlist.
- `--additional-mcp-config` is [U]: only one third-party guide mentions it.
- Good news for Turno: **Copilot reads the same `.mcp.json` as Claude Code**.

### Kiro [V] (https://kiro.dev/docs/mcp/configuration/)
- `~/.kiro/settings/mcp.json` + `.kiro/settings/mcp.json`, merged, with the workspace file winning. `autoApprove` (`"*"` allowed) and `disabledTools`. `${VAR}` expansion only for vars approved under "Mcp Approved Env Vars". Docs recommend chmod 600 on these files.

### Cursor (IDE + CLI `agent`) [V/S]
- `~/.cursor/mcp.json` and `.cursor/mcp.json`. The CLI shares the editor config: `agent mcp list` / `list-tools`, `--approve-mcps`. A known 2026 bug (staff-confirmed) has the CLI ignore project `.cursor/mcp.json`: https://forum.cursor.com/t/cursor-agent-not-picking-up-mcp-json-from-project/157026 .
- A tool cap of about 40 tools is widely reported (https://forum.cursor.com/t/request-increase-mcp-tools-limit-for-enhanced-development-workflow/108637). Current status [U]. Also reported: a payload-size limit that silently drops all tools.
- Cursor ACP agent ignores `mcpServers` in `session/new` (user report): https://forum.cursor.com/t/acp-agent-silently-ignores-mcpservers-in-session-new/153623 [S].

### OpenCode [V-ish] (https://opencode.ai/docs/mcp-servers)
- In `opencode.json`, servers go under the `"mcp"` key: `{type:"local", command:[...], environment, enabled}` or `{type:"remote", url, headers, oauth, enabled, timeout(5s)}`. OAuth is automatic with DCR. `opencode mcp auth <name>`, `opencode mcp auth list`, `opencode mcp debug`. `oauth:false` for API-key servers.

### Qwen Code [V-ish] (https://qwenlm.github.io/qwen-code-docs/en/developers/tools/mcp-server/)
- A Gemini-CLI fork: `mcpServers` in `~/.qwen/settings.json` / `.qwen/settings.json`. `qwen mcp add --transport http ... --scope user`. OAuth tokens are **plaintext by default**. Needs a restart after edits.

### ACP clients (Zed, Orca, JetBrains...) [V] (https://agentclientprotocol.com/protocol/session-setup)
- `session/new` and `session/load` take `mcpServers: [...]`. stdio form: `{name, command(absolute), args, env:[{name,value}]}`. HTTP form: `{type:"http", name, url, headers:[{name,value}]}`, only if the agent advertises `mcpCapabilities.http`. SSE is deprecated. All agents MUST support stdio.
- **This is the one standard, agent-neutral way to hand a session its MCP set.** Orca passes `mcpServers: []` everywhere (`C:\rx\orca\src\main\acp\acp-structured-handshake.ts:76,97`), so it does not inject anything.

### Summary table

| Agent | User file | Project file | Per-launch injection | Tool filter | OAuth |
|---|---|---|---|---|---|
| Claude Code | ~/.claude.json | .mcp.json | `--mcp-config` + `--strict-mcp-config` | permissions / alwaysLoad | yes (DCR/CIMD), per config dir |
| Codex | ~/.codex/config.toml | .codex/config.toml (trusted) | `-c` overrides, `CODEX_HOME` [U] | enabled_tools/disabled_tools | yes (CIMD/DCR) |
| Gemini (legacy) | ~/.gemini/settings.json | .gemini/settings.json | `--session` enable/disable | includeTools/excludeTools | yes, token json file |
| Antigravity CLI | ~/.gemini/config/mcp_config.json [U] | .agents/mcp_config.json [U] | ? | ? | yes [S] |
| Copilot CLI | ~/.copilot/mcp-config.json | .mcp.json, .github/mcp.json | `--additional-mcp-config` [U] | `tools` | not documented on page |
| Kiro | ~/.kiro/settings/mcp.json | .kiro/settings/mcp.json | - | disabledTools, autoApprove | ? |
| Cursor CLI | ~/.cursor/mcp.json | .cursor/mcp.json (buggy in CLI) | `--approve-mcps` | per-tool toggles | yes |
| OpenCode | opencode.json `mcp` | opencode.json | `OPENCODE_CONFIG`? [U] | `enabled` | yes (DCR) |
| Qwen Code | ~/.qwen/settings.json | .qwen/settings.json | - | include/exclude (Gemini fork) | yes, plaintext |
| ACP agents | n/a | n/a | `session/new.mcpServers` | n/a | n/a (client side) |

Key fact for Turno: **there are at least 7 different file formats and locations, 3 field names for a remote URL (`url`, `httpUrl`, `serverUrl`) and 2 encodings (JSON, TOML)**. That is the real "config hell" a hub could solve.

---

## 2. Protocol state (Oct 2026)

- **Spec 2026-07-28 makes MCP stateless** [S]: no initialize handshake and no session ID. Each request carries version and capabilities in `_meta`. New `Mcp-Method` / `Mcp-Name` HTTP headers let gateways route without parsing the body. MRTR handles mid-call elicitation, list responses get cache hints (`ttlMs`, `cacheScope`), and the MCP Apps and Tasks extensions arrive. Old and new peers may not interoperate. Sources: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/ , https://flaviocopes.com/mcp-2026-07-28-stateless/ . Implication: a gateway or proxy in front of remote servers becomes simpler and cheaper.
- **Auth**: since 2025-11-25, CIMD (Client ID Metadata Documents) is preferred and DCR is optional (https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization.md). The 2026-07-28 revision reportedly deprecates DCR [S/U] (https://ssojet.com/blog/mcp-authorization-spec-2026-07-28-what-changed). Claude Code and Codex already handle CIMD/DCR/pre-registered clients themselves.
- **Official MCP Registry** (registry.modelcontextprotocol.io): preview since 2025-09, REST API frozen at v0.1 (2025-10). Reverse-DNS namespaces (`io.github.user/server`), `server.json`, ownership verification. About 2,000 servers [S]. GA status not confirmed [U]. Copilot `/mcp search` and ToolHive's registry server consume the registry API. Source: https://atlan.com/know/ai-agent/what-is-an-mcp-registry/ .
- **Claude Desktop extensions**: `.dxt` was renamed `.mcpb` (MCP Bundle). It is a zip holding a local server plus `manifest.json`, and `user_config` generates a settings UI (sensitive fields go to secure storage [U]). Source: https://www.anthropic.com/engineering/desktop-extensions , https://claude.com/docs/connectors/building/mcpb . Relevant idea for Turno: the `user_config` manifest is a ready-made schema for a "fill in your token" form.

---

## 3. Gateways, aggregators, "MCP managers"

| Product | What it is | Notes |
|---|---|---|
| Docker MCP Toolkit / Gateway | catalog of 300+ containerized servers, **profiles** (named server sets per project), and a single gateway `docker mcp gateway run` that appears in clients as one server `MCP_DOCKER` | Claude Code and Codex connect to it. Needs Docker Desktop. Some gateway governance features are invite-only [S]. https://docs.docker.com/ai/mcp-catalog-and-toolkit/get-started.md |
| ToolHive (Stacklok + Red Hat, Apache-2.0) | desktop app, CLI and K8s operator. Runs servers in containers, has a curated registry that speaks the official registry API, and a "Virtual MCP Server" gateway with OIDC/OAuth SSO and OTel | https://github.com/stacklok/toolhive , https://www.helpnetsecurity.com/2026/09/07/toolhive-open-source-mcp-server-security/ |
| Smithery | hosted servers + registry + CLI (`smithery mcp add exa --client claude`). Hosted OAuth with encrypted, write-only credentials that refresh automatically | https://www.smithery.ai/docs/use/connect |
| MetaMCP, MCPJungle, 1MCP, TBXark/mcp-proxy, mcpd, McpMux | self-hosted aggregators: N servers behind one endpoint, namespaces, auth. McpMux keeps OAuth in the OS keychain | listings: https://mcpservers.org/ru/servers/TBXark/mcp-proxy , https://glama.ai/mcp/servers/@mcpmux/mcp-mux/... |
| Config syncers: mcp-sync (ejfn, ztripez), sync-mcp-config, mcpx, mcpctl, MCP Store app, mancp (per-project profiles for Claude Code) | one master config written out to every client's file | https://github.com/ejfn/mcp-sync , https://pypi.org/project/mancp/ |
| Orca (local source) | **read-only inspector**: lists `.mcp.json`, `.cursor/mcp.json`, `.claude.json`, `.claude/mcp.json` per repo, masks env, can create a starter `.mcp.json`. Uses `--strict-mcp-config` for background Claude runs. **Integrations (Linear, Jira, GitHub) are exposed to agents as an `orca` CLI + bundled skills, not as MCP**, with "treat ticket text as untrusted" built into the skill text | `src/shared/mcp-config.ts`, `src/renderer/src/components/settings/McpConfigSection.tsx`, `src/cli/bundled-skill-guides.ts` |

Takeaway: the "MCP manager" space is crowded: Docker, ToolHive, Smithery and about 10 OSS proxies and syncers. Turno should **not** try to be a catalog or container runtime. Its edge is that it **owns the process launch of every agent**, so it can inject configuration per session, which none of the syncers can do (they only write static files).

---

## 4. Known problems (and what they mean for Turno)

### 4.1 Context / token bloat
- The GitHub MCP server once used about 50k tokens of tool schemas (93 tools), later trimmed. The Scalekit benchmark reports MCP at 4 to 32x more tokens than CLI for the same task (one benchmark, vendor-adjacent) [S]. https://www.apideck.com/blog/mcp-server-eating-context-window-cli-alternative , https://www.heyuan110.com/posts/ai/2026-07-04-cli-skills-vs-mcp/
- Mitigations now native: Claude Code tool search (deferred schemas, on by default), Codex/Gemini/Copilot/Kiro per-tool allowlists. Other agents (Codex, OpenCode, Qwen) still load all schemas upfront [partly U].
- Community trend in 2026: "CLI + skill beats MCP" for things that have a good CLI (gh, aws, az, kubectl, sentry-cli). Perplexity's CTO and Garry Tan were reported to be moving away from MCP [S]. Orca follows the same pattern: CLI + skill for Linear and Jira.
- **For Turno**: an "inject every connected MCP into every agent" default is the anti-pattern. The default should be **off, opt-in per profile or routine**.

### 4.2 Tool-selection degradation
- RAG-MCP (arXiv 2505.03275) reports baseline accuracy collapsing as the tool count grows, and retrieval roughly triples it (13.6% to 43.1%) [S; exact figures disputed between write-ups]. LongFuncEval reports a 7 to 85% drop as catalog size grows. HumanMCP (arXiv 2602.23367) shows a 9 to 10 point drop from 10 to 100 tools. The "about 30 / 40 tools" rule of thumb is folklore [U], but Cursor reportedly caps at 40.
- **For Turno**: per-task profiles (for example "debug" = Sentry + logs; "infra" = AWS read-only) are the main lever, and they also reduce risk.

### 4.3 Security
- **Tool poisoning / rug pulls**: hidden instructions in tool descriptions; a clean server later ships a poisoned update. Real case: `postmark-mcp` 1.0.16 (Sep 2025) silently BCC'd every email to the attacker. https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/
- **Prompt injection through tool output**: issue, ticket or Sentry event text controlled by outsiders. Orca's skills explicitly say to treat ticket text as untrusted data.
- **Secrets in config files**: a GitGuardian 2026 figure, reported secondhand, counts 24,008 secrets in MCP config files on public GitHub, 2,117 of them valid [S]. A Hush Security report (Sep 2026) finds hardcoded MCP credentials in public repos. Trail of Bits: "insecure credential storage plagues MCP". Qwen Code and Gemini store OAuth tokens in plaintext JSON, and Codex stores pre-registered client secrets in config.toml. Sources: https://www.helpnetsecurity.com/2026/09/18/hush-security-mcp-credential-exposure-report/ , https://blog.trailofbits.com/2025/04/30/insecure-credential-storage-plagues-mcp/ , https://pub.towardsai.net/secure-your-mcp-credentials-2443b4eded34
- **Unattended runs**: in `claude -p` / SDK mode, project `.mcp.json` servers load **without approval** [V]. A cloned repo can therefore start arbitrary stdio servers inside a Turno routine. Copilot gates this with a trust check plus an env flag. **A Turno routine should run with `--strict-mcp-config` and an explicit server list by default.**
- Pinning: prefer remote, vendor-hosted servers (Sentry, Atlassian, AWS, GitHub) or version-pinned packages (`npx pkg@1.2.3`) over `@latest`.

### 4.4 Startup latency and process sprawl
- Each agent session spawns its **own copy of every stdio server**. With about 10 servers per session and 5 terminals, that is 50 node or python processes. There are many Claude Code issues about orphaned MCP processes, **including Windows-specific ones** (no SIGHUP, so children survive), duplicates from subagents, leaks on `/mcp` reconnect, and leaks from `claude mcp list` (claudeissues.com mirrors: 58918, 26658, 79740, 11778, 88514; some fixed, Jul/Aug 2026 ones open) [S].
- Startup: Claude connects servers non-blocking by default (except `alwaysLoad`). Codex waits `startup_timeout_sec`, and `required` servers block. Slow `npx` cold starts are common.
- Turno already kills the process tree (`runner.ts` killTree via `taskkill /T`), which covers the orphan problem for routines. A shared gateway would remove the N-copies problem.

### 4.5 Fragmentation / re-login
- Users re-enter the same server and token in Cursor, Claude Code and Codex, and log in with OAuth once per tool, which with Turno's agent pool means **once per account config dir** as well. https://blog.apify.com/introducing-mcpc-universal-mcp-cli-client/ , Reddit snapshot https://reddit.sentinel-team.org/posts/1sn5m3g/snapshots/2026-04-18T01%3A20%3A39.31167Z (MCPilot thread: "config hell", "scavenger hunt" for expired tokens) [S].

---

## 5. The specific servers the user mentioned

| Target | Official option | Auth | Turno note |
|---|---|---|---|
| Sentry | remote `https://mcp.sentry.dev/mcp` (vendor-hosted) | OAuth | Zero install. Each agent does its own OAuth, unless a gateway handles it. `sentry-cli` is the CLI alternative. https://docs.sentry.io/ai/mcp/ |
| AWS | managed AWS MCP Server `https://aws-mcp.us-east-1.api.aws/mcp` (+ OSS awslabs/mcp) | OAuth/IAM (`?oauth=initialize` for clients that don't start OAuth themselves) | Very high risk. Default read-only, per-profile. The `aws` CLI + skill is often enough. https://docs.aws.amazon.com/agent-toolkit/latest/userguide/oauth-authentication.md |
| Bitbucket | Atlassian Rovo MCP `https://mcp.atlassian.com/v1/mcp/authv2` (Jira, Confluence, Bitbucket, Compass) [S: Bitbucket coverage via LiteLLM docs]; community Forge server | OAuth 2.1 or API token | One server covers Jira and Bitbucket. Fits the Tasks research too. https://support.atlassian.com/atlassian-rovo-mcp-server/docs/configuring-oauth-2-1 |
| GitHub | remote GitHub MCP / built into Copilot CLI; the `gh` CLI | OAuth/PAT | `gh` CLI is usually better (token cost) |
| Linear / Jira / Monday | vendor remote MCPs exist [U for Monday] | OAuth | overlaps with a Turno Tasks screen |

---

## 6. Evaluating the user's idea

> "connect the MCPs in Turno and add an initial instruction for every agent that's opened, listing each MCP and each active connection, so the agent can use them"

**Parts that make sense**
1. **One place to define servers and credentials** that Turno then **injects at launch** into whichever agent CLI it is starting. This is real value: 7+ formats, repeated OAuth, plaintext secrets.
2. **Choosing which servers a session or routine gets**, through profiles. This addresses token bloat, tool confusion and blast radius.
3. **Routines with explicit MCP lists** (`--strict-mcp-config`). This makes headless runs reproducible and safe from repo-provided `.mcp.json`.

**Parts that are redundant or harmful**
1. **Listing MCP tools in an initial prompt**: agents already receive tool lists and server `instructions` through MCP. Repeating them in prose wastes tokens on every turn of every session, goes stale, and on Claude it defeats tool search's deferral. Only a 2 to 5 line note about **non-MCP context** is worth injecting, for example "AWS: use profile `dev`, read-only; Sentry org X; don't touch prod". That note fits `--append-system-prompt` (Claude), `AGENTS.md`-style files, or the routine prompt.
2. **Turno acting as an MCP client** (calling tools itself) is not needed.
3. **A marketplace or catalog**: Docker, ToolHive, Smithery, the official registry and Copilot's `/mcp search` already exist. A short curated list plus "paste a URL" is enough.
4. **Re-implementing OAuth per agent**: agents do it themselves. Turno only adds value if it does OAuth **once** in a gateway (see below). Otherwise, just show "needs login" status and a button that runs `claude mcp login <name>` in a terminal.

---

## 7. What a "Turno MCP hub" could do that agents don't

Ranked by value divided by effort:

| # | Feature | Agents already? | Effort | Verdict |
|---|---|---|---|---|
| 1 | **Per-session and per-routine MCP profile picker** (checkboxes at session start and in the RoutineEditor), compiled into per-agent launch args: Claude `--mcp-config <tmp.json> --strict-mcp-config`; Codex `-c` or a temp `CODEX_HOME` overlay [U]; ACP `mcpServers`; others by writing the project file | No (each agent is per-file or per-CLI-command) | M | **Do it.** Core value, and it helps the agent pool, since accounts have separate config dirs. |
| 2 | **Secrets vault** (Electron `safeStorage` / Windows DPAPI). Configs reference `${NAME}` and Turno injects env at spawn. Never write tokens into `.mcp.json` or `config.toml` | No (each stores plaintext or per-tool keychain) | S | **Do it.** Cheap and directly addresses a documented leak class. Works with Claude `${VAR}`, Codex `bearer_token_env_var`/`env_http_headers`, Gemini `env`. |
| 3 | **One canonical server list → sync/export to each agent's user file** (optional, with a diff preview and backup) | No | M | Optional. Useful for sessions the user starts outside Turno. Risky (writing other tools' configs; formats change). Prefer launch-time injection (#1). |
| 4 | **Status panel**: read each agent's existing configs (as Orca does) + stream-json `init.mcp_servers` status, flag "needs auth / failed / N tools / est. tokens" | Partially (`/mcp` per agent) | S | **Do it** (read-only). Turno already parses `mcp_servers` in runner.ts. |
| 5 | **Shared local gateway** (one process: stdio servers started once, OAuth tokens held once, exposed as one streamable-HTTP endpoint to all sessions; per-session tool filtering via path, e.g. `/p/<profile>`) | No | L | **Later / maybe.** Solves N process copies, repeated OAuth across tools and accounts, and gives an audit log of tool calls. Could embed an existing OSS proxy (TBXark/mcp-proxy, 1MCP) instead of writing one. Costs: a single point of failure, an extra hop, and owning the OAuth client logic (CIMD/DCR). Stateless 2026-07-28 spec makes it easier. |
| 6 | **Safety defaults**: routines get `--strict-mcp-config`; pin versions; warn on servers whose tool descriptions changed since approval (rug-pull detection via hash) | No (Claude approves once per project) | S–M | **Do it** (the hash check is cheap if #5 or #4 exists). |
| 7 | Short per-profile "context note" injected as an appended system prompt | n/a | S | OK, but small: non-MCP facts only. |
| 8 | Curated recommendations (Sentry, Atlassian, GitHub, AWS read-only, Playwright/Chrome, Postgres read-only, Context7/docs) | Registry and catalogs exist | S | A short static list, no marketplace. |
| - | Catalog/marketplace, container runtime, Turno as MCP client, auto-listing tools in prompts | Yes / not needed | - | **Skip.** |

### Suggested minimum viable version (v1)
- A "Connections → MCP" screen: a list of servers (name, stdio command or URL, env refs, notes) plus **Profiles** (named sets).
- Secrets in safeStorage, injected as env.
- The session launcher and RoutineEditor get a profile dropdown. Default = "none (agent's own config)", so nothing changes for existing users.
- Claude: generate a temp JSON → `--mcp-config` (+ `--strict-mcp-config` when the profile is exclusive). Routines default to strict.
- Codex and others: v1 = "agent's own config" only, with a status display. Add injection when verified.
- A status chip per session from the stream-json init event (connected / failed / needs-auth).

---

## 8. Open questions / to verify
- Exact Codex `-c` syntax for `mcp_servers` overrides, or whether a `CODEX_HOME` overlay is better.
- Antigravity CLI official config path and keys (`serverUrl`), and whether it accepts per-launch MCP injection.
- Copilot CLI `--additional-mcp-config` existence.
- Whether a gateway with its own OAuth can front Sentry, Atlassian and AWS remote servers (each needs a CIMD URL or DCR for the gateway's client; AWS needs IAM).
- `--strict-mcp-config` failure under enterprise managed config (Orca handles it with a fallback in `claude-background-run-isolation.ts`).
