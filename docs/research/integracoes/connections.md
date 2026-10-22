# Turno: MCP/"connections" for coding agents (research, Oct 21 2026)

Scope: which external connections (observability, cloud, deploy, DB, VCS, browser, design, chat) are worth surfacing in Turno, how they authenticate, what agents actually do with them, risks, and whether "connect MCPs in Turno and inject a preamble into every agent" makes sense.
Legend: [V] verified against official docs/vendor page in this session; [S] secondary source (blog/directory); [U] unverified / from memory, check before building.

---

## 0. What Orca does (source at C:\rx\orca)

- No integrations marketplace. MCP support is **an inspector of per-repo MCP config files**: `src/renderer/src/components/settings/McpConfigSection.tsx` + `src/shared/mcp-config` look for `.mcp.json`, `.claude/mcp.json`, `.cursor/mcp.json` in the repo/worktree, list the servers in each, open the file in the editor, and can create a starter empty config ("Add MCP config"). i18n strings: "Inspect MCP server definitions that agents can use while working in this repo."
- For its managed Codex accounts it **mirrors `mcp_servers` from the system `~/.codex/config.toml` into each per-account Codex home** (`src/main/codex/codex-config-mirror*.ts`, `config-toml-mcp-servers`), with owner-only file modes because env tokens are copied. Account removal warns it deletes "MCP logins stored inside".
- Linear/Jira are integrated directly via APIs (CLI `orca linear save-issue` mirrors "Linear MCP save_issue semantics"), not via MCP.
- Takeaway: Orca treats MCP as *the agent's* config and only makes it visible + keeps it consistent across account homes. It does not run MCP servers itself or inject preambles.

## 1. How the agent CLIs consume MCP (constraints for Turno)

Claude Code [V] https://code.claude.com/docs/en/mcp
- Scopes: local (`~/.claude.json`, per project), project (`.mcp.json`, committed), user (`~/.claude.json`). Precedence local > project > user > plugin > claude.ai connectors; no field merging.
- `--mcp-config <file|json>` + `--strict-mcp-config` = use only the given servers. **This lets Turno inject a per-routine/per-session MCP set without touching ~/.claude.** stream-json `system/init` reports skipped entries in `mcp_server_errors` (v2.1.219+). Useful for Turno's run viewer.
- `${VAR}` / `${VAR:-default}` expansion in command/args/env/url/headers -> Turno can keep secrets in its own store (OS keychain) and pass them via env, never written into config files.
- In `claude -p` (Turno's routines) project `.mcp.json` servers load **without approval prompt** -> a cloned repo's `.mcp.json` gets executed by unattended routines. Turno should default routines to `--strict-mcp-config` or show this.
- **OAuth cannot be completed headless**: "Complete sign-in in an interactive session first" (`/mcp` or `claude mcp login <name>`). With tool search on, Claude is told the server is unavailable.
- Tool search (deferred tool loading) is on by default -> tool-definition context tax largely solved in Claude Code; `MAX_MCP_OUTPUT_TOKENS` default 25k, big results spill to files.
- Org controls exist: `allowedMcpServers` / `deniedMcpServers`, per-tool `ask`/`blocked`, `managed-mcp.json`.

Codex CLI [S] https://developers.openai.com/codex/mcp
- `[mcp_servers.<name>]` in `~/.codex/config.toml` or trusted-project `.codex/config.toml`; `codex mcp add/list/login`; OAuth supported; `env_http_headers` for API keys from env. [U] `-c mcp_servers.x.url=...` CLI overrides likely work for per-run injection (Codex supports `-c key=value`); verify.

Gemini CLI: `mcpServers` in `settings.json` [U, not fetched].

Cross-tool config sync is a known pain with many small tools: mcpx (kwonye), ejfn/mcp-sync, ztripez/mcp-sync, sodeyama/sync-mcp-config, MCP Store desktop app [S] https://lobehub.com/mcp/kwonye-mcpx https://github.com/ejfn/mcp-sync . None covers Claude+Codex+Cursor+Gemini fully. -> Turno being "one place, injected per agent at launch" is a real, uncrowded niche.

## 2. Pains with MCP in agent workflows (evidence)

1. **Context tax** - GitHub MCP ~55k tokens of tool defs; reports of 66k+ tokens before first message; Scalekit benchmark: GitHub MCP 17x more expensive than `gh` for same task [S] https://www.firecrawl.dev/blog/mcp-vs-cli https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code https://getunblocked.com/blog/mcp-tool-overload/ . Mitigated in Claude Code by tool search [S] https://dev.to/siddhesh_surve/the-context-tax-is-dead-claude-code-just-solved-the-biggest-problem-with-agents-13p0 , but not necessarily in Codex/Gemini/Ollama-backed models (Turno supports Ollama -> local models suffer most from huge tool lists) [U].
2. **"Just use the CLI"** - Feb 2026 "MCP is dead. Long live the CLI" hit #1 on HN; Karpathy praised CLIs; Perplexity reportedly moved off MCP [S] https://manveerc.substack.com/p/mcp-vs-cli-ai-agents https://speakeasy.com/blog/mcp-vs-cli https://martinalderson.com/posts/why-im-building-my-own-clis-for-agents/ . Consensus: CLI for gh/aws/gcloud/kubectl on a single dev machine; MCP for SaaS with no CLI, OAuth, multi-user governance.
3. **OAuth in headless/scheduled runs** - tokens expire, refresh races when multiple sessions/cron jobs share one server's rotating credentials, no hook to re-auth [S] https://github.com/anthropics/claude-code/issues/29718 https://github.com/anthropics/claude-code/issues/50743 https://aident.ai/blog/fix-claude-code-mcp-oauth-refresh-race . **Directly hits Turno** (routines are headless, parallel terminals share creds).
4. **Prompt injection via tool data** - Invariant Labs: malicious public GitHub issue made agent leak private repo data through the official GitHub MCP [V-ish] https://invariantlabs.ai/blog/mcp-github-vulnerability ; Supabase docs name prompt injection as primary risk (support ticket example) [V] https://supabase.com/docs/guides/ai-tools/mcp ; Slack reference server CVE-2025-34072 zero-click exfil via link unfurl [S] https://www.stackone.com/blog/slack-mcp-deep-dive/ . "Lethal trifecta" (private data + untrusted content + exfil channel; Simon Willison, 2025) [U, not re-fetched].
5. **Wrong account/environment** - AWS added per-request profile selection specifically to avoid commands hitting the wrong account [V] https://aws.amazon.com/about-aws/whats-new/2026/06/aws-mcp-server/ .
6. **Config sprawl across agents** (section 1).
7. **Destructive ops on prod** - Neon: "not recommended for production" [S]; Supabase recommends read_only + project_ref + manual approval, and for unattended runs pre-approve only read-only scoped tools [V].

## 3. Per-connection evaluation

| Connection | Official MCP / CLI | Auth | What agents do with it | Demand evidence | Risk |
|---|---|---|---|---|---|
| **Sentry** | Official remote `https://mcp.sentry.dev/mcp` (Streamable HTTP), "production-ready"; also `sentry-cli` [V] https://docs.sentry.io/ai/mcp/ | OAuth (or user token) | search_issues/search_events -> stack trace -> fix; `analyze_issue_with_seer` triggers Seer RCA; `update_issue` to resolve [S] https://sentry.io/cookbook/fix-issues-sentry-mcp-cursor | Sentry cookbooks for Cursor/Warp; one of the most-cited dev MCPs [S] | Low (mostly read; update_issue). Data: PII in events. Seer runs may cost Sentry quota [U] |
| **Datadog** | Official remote MCP, GA Mar 2026 [S] https://www.datadoghq.com/blog/datadog-remote-mcp-server ; `pup`/API | OAuth/API+App key, RBAC | logs/metrics/traces/incidents into agent; Codex CLI embed | Big-vendor push; enterprise | Low (read). Cost of queries |
| **Grafana** | Official `grafana/mcp-grafana` (uvx/docker) + hosted Grafana Cloud MCP (OAuth) [V] https://grafana.com/docs/grafana/v13.1/developer-resources/mcp/ | Service-account token / OAuth | PromQL, LogQL, dashboards, alerts, OnCall, Sift, Pyroscope | Popular in OSS/self-host (fits user's K8s/SRE profile) | Low-medium (can edit dashboards/alerts unless SA is Viewer) |
| New Relic | Official MCP still **public preview** (Nov 2025) [V] https://docs.newrelic.com/docs/agentic-ai/mcp/overview/ | API key | NRQL queries | Low | Low |
| PostHog | Official remote `https://mcp.posthog.com/mcp`; `npx @posthog/wizard mcp add` [S] | Personal API key / OAuth | feature flags, experiments, insights, error tracking | Moderate (product teams) | Medium (can flip flags in prod) |
| LogRocket | **No official MCP found** [U] | - | - | - | - |
| **AWS** | Managed AWS MCP Server GA May 6 2026, cross-account/role Jun 2026 (per-request profile) [V] https://aws.amazon.com/about-aws/whats-new/2026/06/aws-mcp-server/ ; open-source `awslabs/mcp` incl. AWS API MCP Server (`AWS_API_MCP_PROFILE_NAME`, boto3 chain, `READ_OPERATIONS_ONLY`) [S] https://pypi.org/project/awslabs-aws-api-mcp-server ; `aws` CLI | Local profiles / SSO (IAM Identity Center, tokens expire ~8-12h [S]) | CloudWatch logs triage, describe resources, Lambda/S3 config, IaC (CDK/Terraform) help | High interest; multi-account blog posts (JP) | **High**: write ops on real infra; wrong account. IAM is the real control |
| GCP | 50+ managed remote MCP servers, enabled by default per product, IAM deny to restrict [V] https://docs.cloud.google.com/mcp/overview ; `gcloud` | ADC/IAM | Logging, BigQuery, GKE, Cloud Run | Growing | High (prod) |
| Azure | Azure MCP Server 1.0 GA Oct 2025, 2.0 GA 2026; separate Azure DevOps MCP GA [S] https://devblogs.microsoft.com/azure-sdk/announcing-azure-mcp-server-stable-release/ | Entra/az login | 47+ services | Enterprise | High |
| Cloudflare | Official `cloudflare/mcp-server-cloudflare`: many remote servers (observability, bindings, docs, builds...) at `*.mcp.cloudflare.com` [S] | OAuth | Workers logs, bindings, deploy | Moderate | Medium |
| Vercel | Official remote `https://mcp.vercel.com` (beta) [S] | OAuth | projects, deployments, build/runtime logs, docs | Moderate (Next.js crowd) | Medium |
| Netlify | `netlify/netlify-mcp` local (~9 tools) [S] | PAT/CLI | deploy/manage | Low | Medium |
| Supabase | Official, `read_only=true`, `project_ref` scoping, docs on prompt injection [V] | OAuth/PAT | SQL, migrations, edge functions, logs, advisors | High (vibe-coding) | **High** without read_only |
| Neon | Official remote `mcp.neon.tech/mcp` OAuth or local API key; "not for production" [S] https://neon.com/blog/new-mcp-server-features | OAuth | branch-per-task, migrations on branches | Moderate | Medium (branching mitigates) |
| PlanetScale | Not confirmed in this research [U] | - | - | - | - |
| **GitHub** | Official `github/github-mcp-server` ~30k stars, remote `https://api.githubcopilot.com/mcp/`, `--read-only`, toolsets [S] https://pkg.go.dev/github.com/github/github-mcp-server ; **`gh` CLI** | OAuth/PAT | issues, PRs, reviews, Actions logs | Very high | Medium; Invariant prompt-injection case. `gh` cheaper in tokens |
| **Bitbucket** | **Yes: Atlassian Rovo MCP Server now covers Bitbucket Cloud** (repos, PRs create/merge/approve/comment/diff, pipelines, deployments) [V] https://www.atlassian.com/blog/bitbucket/the-atlassian-rovo-mcp-server-now-supports-bitbucket-cloud https://github.com/atlassian/atlassian-mcp-server | OAuth 2.1 or API token | same as GitHub for BB shops; one connection = Jira + Confluence + Bitbucket | Strong in Atlassian shops (Brazil enterprise common) | Medium (merge). Cloud only, no Data Center [S]; community post says org-linked workspace + API token required [S] |
| GitLab | Official remote `https://gitlab.com/api/v4/mcp` (OAuth DCR), **beta, Premium/Ultimate + Duo** [V] https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server ; `glab` CLI; community servers for Free tier | OAuth | MRs, issues, pipelines | Moderate | Medium |
| Docker | Docker MCP Toolkit/Gateway (Docker Desktop 4.43+) runs servers in containers behind one gateway [S] | - | runs other MCPs sandboxed | Moderate | Low; it is itself a competing "MCP manager" |
| Kubernetes | `containers/kubernetes-mcp-server` (Red Hat-led) with read-only / disable-destructive flags [U]; many community read-only servers; `kubectl` | kubeconfig context | get/describe/logs/events for debugging | Moderate (SRE) | **High** with write; use read-only SA RBAC [S] |
| Postgres/DB | Reference server archived + read-only bypass; use Postgres MCP Pro (restricted mode) or Bytebase DBHub (READONLY + row limit + timeout) [S] https://www.bytebase.com/blog/top-postgres-mcp-servers/ ; `psql` | DSN | schema exploration, query debugging, EXPLAIN | High | High unless read-only user/replica |
| **Playwright / browser** | Official `@playwright/mcp` and `@playwright/cli`; token gap ~closed in Jul 2026 re-benchmark [S] https://dev.to/aswani25/playwright-cli-vs-playwright-mcp-which-should-you-use-with-claude-code-1olh ; **Chrome DevTools MCP** (Google): perf traces, console w/ source maps, network [S] https://addyosmani.com/blog/devtools-mcp/ | none (local) | agent verifies its own UI change, reproduces bugs, reads console | Very high | Low-medium (local browser; avoid logged-in profiles) |
| Figma | Official remote `https://mcp.figma.com/mcp` all plans, OAuth; recommended as Claude plugin `figma@claude-plugins-official`; desktop server `127.0.0.1:3845` [V] https://developers.figma.com/docs/figma-mcp-server/remote-server-installation | OAuth | design-to-code, tokens, Code Connect | High for frontend | Low |
| Slack | Official Slack-hosted MCP (Feb 2026), ~16 tools, read-first, partner allowlist [S] https://www.stackone.com/blog/slack-mcp-deep-dive/ | OAuth | search threads for context, post summaries | Moderate | Medium-high (PII, exfil channel) |

## 4. Tiered recommendation for Turno

Principle: Turno should NOT build per-service integrations. It should be the **one place that holds MCP server definitions + secrets, injects a chosen subset into each agent at launch, and tells you before a routine runs if a connection is broken**. Ship a small curated preset catalog; anything else = "custom server (paste URL / command)".

**Must-have presets (cover most devs, low setup, clear value)**
1. GitHub (prefer telling the agent `gh` is authenticated; MCP optional, read-only toolset by default).
2. Atlassian Rovo (Jira + Confluence + **Bitbucket Cloud** in one OAuth) - answers the Bitbucket ask and pairs with Turno Tasks pulling Jira.
3. Sentry (remote, OAuth, Seer) - the canonical "debug app" connection; perfect for a routine "triage new Sentry issues every morning -> open PR".
4. Playwright MCP / Chrome DevTools MCP (local, no auth) - lets agents verify UI; zero account friction.
5. Generic "Custom MCP" (http URL + headers or stdio command + env), plus **import from existing** `~/.claude.json`, `.mcp.json`, `~/.codex/config.toml` (read-only import, like Orca's inspector).

**Nice-to-have (presets only, off by default, read-only defaults)**
- AWS (profile picker reading `~/.aws/config`; mark profiles as dev/staging/prod; default read-only via AWS API MCP `READ_OPERATIONS_ONLY` or just tell agent which profile it may use). High value for the user's SRE/K8s profile, high risk.
- Grafana (fits SRE/K8s), Datadog (enterprise).
- Kubernetes read-only (kubeconfig context selector; warn on prod contexts).
- Postgres read-only (DBHub / Postgres MCP Pro restricted) with a "use a read-only user" hint.
- Vercel, Cloudflare, Supabase (`read_only=true&project_ref=` prefilled), Neon - deploy/BaaS logs.
- Figma (frontend), GitLab (beta/paid tier caveat), PostHog.

**Skip (for now)**
- New Relic (preview), LogRocket (no official MCP found), PlanetScale (unconfirmed), Netlify (low demand) -> available via "Custom".
- Azure/GCP presets until a user asks (remote endpoints exist; custom URL works).
- Slack as an agent tool (exfil/PII risk, allowlisted; Turno already has ntfy for notifications).
- Docker MCP Toolkit integration (overlaps Turno's role; users can add the gateway as a custom server).
- Any Turno-hosted MCP proxy/gateway (big scope, auth/refresh bugs - see pain #3).

## 5. Is the "initial instruction for every agent listing MCPs/connections" idea good?

Partly.
- Listing MCP tools in a preamble is **redundant**: the agent already receives tool definitions from the MCP config (and Claude Code tool search lists server names). Repeating them costs tokens and can go stale.
- What IS valuable and nobody does: a **short environment brief** for things the agent cannot discover: "AWS profile `acme-dev` = dev, read-only allowed; `acme-prod` = never write"; "kubectl context `kind-lab` is safe"; "Sentry org X project Y = this repo"; "Jira project KEY maps to this folder"; "gh is logged in as rafael". ~5-15 lines, generated from Turno's connection metadata, appended via `--append-system-prompt` (Claude) / AGENTS-style prompt prefix for others. Per folder/routine, not global.
- Better mechanism than global injection: **per-session / per-routine connection selection** (`--mcp-config` + `--strict-mcp-config`), so a routine only gets the 1-3 servers it needs (smaller context, smaller blast radius, works for Ollama models with small context).

## 6. Pains Turno can solve (connection-specific)

1. Pre-flight health check before scheduled runs: is each selected MCP reachable and authorized? If OAuth expired -> ntfy "Sentry needs re-login" instead of a silent failed run. Parse `mcp_server_errors` from stream-json init and show it in the run viewer.
2. One place for MCP definitions + secrets in OS keychain, injected via env (`${VAR}` expansion), never written to repos.
3. Unattended-safety defaults: routines start with `--strict-mcp-config` (ignore repo `.mcp.json` that would load without prompt in `-p` mode); "read-only" toggle per preset; prod flag per environment that shows a red badge in terminals using it.
4. Single-owner OAuth refresh: avoid N parallel sessions refreshing the same token (stagger, or warn) [design idea, U].
5. Per-run audit: list MCP tool calls (name, server, args summary) in the run viewer; highlight write/destructive calls.
6. Context budget: show estimated tool-definition tokens per selected server set (useful for Ollama/local models).

## 7. Open questions / to verify before building
- Codex per-run MCP override syntax (`-c mcp_servers...`) and Gemini CLI equivalent.
- Whether Claude Code OAuth tokens from `claude mcp login` are reused when servers come via `--mcp-config` (same name/url?) [U - important for headless routines].
- containers/kubernetes-mcp-server flags; PlanetScale MCP status; LogRocket MCP.
- Atlassian Bitbucket support limits (Cloud only, API-token only claims).
