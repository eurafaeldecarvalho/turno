# Issue/task trackers for Turno: which ones devs use, how to connect them

Researched on 2026-10-21. Legend: **[V]** means checked against a primary source (official docs, the survey page, or Orca's source). **[S]** means a secondary source (vendor blog or press). **[U]** means unverified or the sources conflict.

---

## 1. Which trackers devs use (ranking)

### Stack Overflow Developer Survey 2025, "Code documentation and collaboration tools" [V]
Source: https://survey.stackoverflow.co/2025/technology. This table replaced the older "asynchronous tools" table. It mixes trackers with doc tools; the trackers are marked with *.

| Tool | All respondents | Professional devs |
|---|---|---|
| GitHub* (Issues/Projects bundled with the platform) | 81.1% | 80.5% |
| **Jira*** | 46.4% | **52.1%** |
| GitLab* | 35.6% | 36.7% |
| Markdown file | 34.8% | 35.2% |
| Confluence | 32.8% | 36.5% |
| **Azure DevOps*** | 16.6% | 18.6% |
| Notion* | 16.5% | 17.2% |
| Obsidian | 16.1% | 15.6% |
| Google Workspace | 15.2% | 14.8% |
| Miro | 14.3% | 15.6% |
| Trello* | 13.7% | 13.9% |
| Asana* | 4.4% | 4.5% |
| ClickUp* | 3.9% | 4.2% |
| Linear* | 3.7% | 4.1% |
| Microsoft Planner* | 2.9% | 2.3% |
| Monday.com* | 2.6% | 2.6% |
| Redmine* | 2.5% | 2.8% |
| YouTrack* | 2.4% | 2.6% |

Caveats:
- The "GitHub 81%" figure counts GitHub as a whole, mostly for code. Nobody publishes a number for GitHub Issues as the team's main tracker. The same goes for GitLab.
- 2024 had a different table ("asynchronous tools"), where Jira was 57.5% and Confluence 35.3% [S, getint.io / released.so]. The two years are not directly comparable.
- Shortcut, Plane, Height and Jira Product Discovery are not listed in the survey (each is under about 1%, or was not offered as an option).
- Atlassian's 2025 summary says "GitHub replaced Jira as the most desired collaboration tool" [S, appdevelopermagazine].

### JetBrains State of Developer Ecosystem 2025 [U]
The 2025 report has 24,534 respondents and focuses on AI, languages and productivity. I could not find an issue-tracker breakdown for 2025. The last detailed "team tools" table I found is from 2018: Jira first, then GitHub Issues, Trello, GitLab, Redmine, TFS/VSTS, YouTrack and Asana. https://www.jetbrains.com/lp/devecosystem-2018/team-tools

### Public company numbers [S]
- **Linear**: more than 40,000 paying customers and over $100M ARR in 2026, at a $2.5B valuation, up from about 15,000 customers in June 2025. It is the dominant tracker in AI and startup companies (OpenAI, Cursor, Cognition and others). https://pulse2.com/linear-completes-99-million-tender-at-2-5-billion-valuation-as-arr-tops-100-million-and-net-retention-hits-177/
- **Height**: shut down on 2025-09-24. Ignore it. https://alternativeto.net/news/2025/3/height-project-management-tool-to-shut-down-by-september-2025/
- **Bitbucket Cloud Issues and Wiki**: removed on 2026-08-20, from both the UI and the API, with Jira as the official replacement. **Bitbucket no longer has issues**, so Turno only needs Bitbucket for PRs and repos, not tasks. https://community.atlassian.com/forums/discussion/3193882/announcing-sunset-of-bitbucket-issues-and-wikis

### Ranking for Turno's audience (devs who run CLI agents)
1. **GitHub Issues/Projects**: near-universal; also where personal and open-source work lives.
2. **Jira (Cloud)**: the enterprise standard, used by 52% of professional devs. Jira Product Discovery is a separate PM product and not needed.
3. **GitLab Issues/Work items**: 36%.
4. **Azure DevOps Boards**: 17–19%, concentrated in Microsoft shops.
5. **Linear**: only about 4% overall, but heavily over-represented among the people most likely to use Turno (AI-native startups). Orca chose it as one of its four providers.
6. Long tail, each under 5% of devs: Trello (13.7%, but mostly non-dev and personal boards), Notion (16.5%, mostly docs), Asana, ClickUp, Monday, YouTrack, Redmine, Shortcut, Plane.

**Minimal set covering most devs: GitHub + Jira + GitLab + Linear.** This is exactly Orca's set (`src/shared/task-providers.ts`: `'github' | 'gitlab' | 'linear' | 'jira'`) [V]. Adding Azure DevOps would be the 5th.

---

## 2. How Orca does it (C:\rx\orca) [V]
- **GitHub**: runs the `gh` CLI (`execFileAsync('gh', …)`) and reuses the user's existing `gh auth`. "My issues" uses `assignee:@me`.
- **GitLab**: runs the `glab` CLI.
- **Jira**: its own REST client (`src/main/jira/*`) with an API token. Cloud uses Basic auth (`email:token`); Server/DC uses a PAT as Bearer (`JiraAuthType = 'cloud' | 'server'`). It calls `/rest/api/3/search/jql` with `assignee = currentUser()`, and supports transitions, comments, filters and media.
- **Linear**: its own GraphQL client using a personal API key (`apiKey`), with credentials kept in a protected file.
- Also present: azure-devops, bitbucket and gitea clients, used for PRs and repos, not tasks.
- Orca does **not** use MCP to fetch tasks. MCP only shows up in agent config mirroring (`codex/config-toml-mcp-servers.ts`).
- Lesson: Orca wrote and maintains about 40 files per provider, which is expensive. Turno can do much less.

---

## 3. Per-tracker integration options for a DESKTOP app

### GitHub Issues/Projects
- **CLI**: `gh` (official). It handles auth with the OAuth device flow and keyring storage. `gh issue list --assignee @me --state open --json number,title,url,labels,repository`, or `gh search issues --assignee @me --state open --json …` to search across repos. Posting back: `gh issue comment N -b …`, `gh issue close/edit`. Projects v2: `gh project item-list` (needs the `project` scope).
- **API**: 5,000 REST requests per hour per user and 5,000 GraphQL points per hour. Secondary limits: 100 concurrent requests, 900 points per minute for REST, and at most 80 content-creating requests per minute / 500 per hour [V] https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api . Conditional requests (ETag/If-None-Match) that come back 304 do not count against the limit, which makes polling cheap.
- **OAuth for a desktop app**: device flow, or OAuth App / GitHub App with PKCE. Simplest is to reuse `gh auth token`.
- **MCP**: the official github/github-mcp-server, hosted at `https://api.githubcopilot.com/mcp/`, with OAuth (in supporting hosts) or a PAT as Bearer; a local binary also exists [S]. It costs a lot of context: about 93 tools and ~55k tokens originally, about 42k later, and the default toolset was trimmed to about 52 tools [S] https://simonwillison.net/2025/Aug/22/too-many-mcps/ , https://getunblocked.com/blog/github-mcp-token-cost/ . For agents that have a terminal, `gh` is cheaper and models already know it.
- **Webhooks**: need a public URL, so they don't fit a desktop app. Poll every 2–5 minutes with ETags.

### Jira Cloud (and Data Center)
- **Official CLI**: `acli` (Atlassian CLI). Auth with `acli jira auth login --web` (OAuth in the browser) or by piping an API token (`--site --email --token`). Work-item commands are `acli jira workitem …` with JQL search and JSON output [S/U: exact flags not verified; check `acli jira workitem search --help`]. https://developer.atlassian.com/cloud/acli/guides/how-to-get-started/
- **REST**: `POST /rest/api/3/search/jql` with `jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"`. The old `/rest/api/3/search` has been **removed**; pagination is now only via `nextPageToken`, and there is no `total` [V-ish, Atlassian KB plus community bug reports]. Comments: `POST /issue/{key}/comment` (ADF body). Status: `GET /issue/{key}/transitions`, then `POST` the transition.
- **Auth**: Cloud OAuth 2.0 (3LO) **does not support PKCE**; it needs a client secret, and the feature request ECO-283 is still open [S/U]. A desktop app would have to ship a secret or ask each user to register their own app, so in practice **API token + email (Basic)** is the realistic route, as Orca does. Data Center supports PATs (Bearer) and OAuth with PKCE.
- **Rate limits**: since 2026-03-02, OAuth/Forge/Connect apps have a points-based hourly quota. **API-token traffic is exempt** and stays on the burst limits [S, Atlassian docs and blog] https://developer.atlassian.com/cloud/jira/platform/rate-limiting
- **MCP**: the Atlassian **Rovo MCP Server** (formerly "Remote MCP"), GA since 2026-02-04, Cloud only, at `https://mcp.atlassian.com/v1/mcp`. Auth is OAuth 2.1 (interactive), or an API token (Basic email:token, or a service-account key as Bearer) **only if an org admin enables API-token auth**. Some tools exist only under one auth mode, and the `manage/delete` permission groups are off by default [V] https://developer.atlassian.com/cloud/rovo-mcp/guides/authentication-and-authorization/ . There is a known pagination bug in `searchJiraIssuesUsingJql` (atlassian-mcp-server#118) [S]. The legacy `/v1/sse` endpoint reportedly stopped after 2026-06-30 [U]. For Data Center, use the community server `sooperset/mcp-atlassian`.
- **Webhooks**: an admin can register them, but they need a public URL. Poll instead.

### GitLab
- **CLI**: `glab` (official). `glab issue list --assignee=@me`, `glab issue note`, `glab issue close`. Auth is `glab auth login` (OAuth or PAT).
- **MCP**: an official endpoint built into GitLab at `https://<host>/api/v4/mcp`, **GA since GitLab 19.5**, on all tiers (Free/Premium/Ultimate), and on .com, Self-Managed and Dedicated. Auth is OAuth with the `mcp` scope (DCR or a pre-registered app) or a **fine-grained PAT** with MCP permission; legacy PATs are rejected. Toolsets can be chosen with the `X-Gitlab-Enabled-Mcp-Server-Toolsets` header (core, merge_requests, work_items, repository, ci…). An admin or group owner must allow it. Rate limits on .com: Free 60 requests/min per user, Premium/Ultimate 600/min [V] https://docs.gitlab.com/user/model_context_protocol/mcp_server/
- **REST**: `GET /issues?scope=assigned_to_me&state=opened`. The default rate limits are generous.

### Linear
- **No official CLI** (community ones exist, such as schpet/linear-cli) [U].
- **GraphQL**: `viewer { assignedIssues(filter:{state:{type:{nin:["completed","canceled"]}}}) { nodes {identifier title url state{name}} } }`. Comments use `commentCreate`; status changes use `issueUpdate(stateId)`.
- **Auth**: personal API key (simplest, which Orca uses), or **OAuth 2.0 with PKCE without a client secret** (`code_challenge` S256; refresh needs only the `client_id`; tokens last 24h with refresh tokens; `actor=app` is available; scopes include read, write, issues:create, comments:create) [V] https://linear.app/developers/oauth-2-0-authentication . Linear is the only big tracker with clean PKCE for desktop apps.
- **Rate limits**: 2,500 requests/hour per user with an API key, 5,000 with OAuth, plus a complexity-point budget [V-ish; older docs gave lower numbers] https://linear.app/developers/rate-limiting
- **MCP**: official, at `https://mcp.linear.app/mcp`, with a read-only variant at `/mcp/readonly` (`/sse` is deprecated). Auth is OAuth 2.1 with DCR, **or an API key / OAuth token as Bearer**. One auth context per workspace [V] https://linear.app/docs/mcp
- **Webhooks**: available, but they need a public URL, so poll instead.

### Azure DevOps Boards
- **CLI**: `az boards` (an extension of the Azure CLI). WIQL: `SELECT … WHERE [System.AssignedTo] = @Me AND [System.State] <> 'Closed'`.
- **Auth**: PAT (simple), or Entra ID OAuth. The legacy Azure DevOps OAuth apps reach end-of-life in 2026 and new registrations are closed [V-ish, MS Learn]. A claim that global PATs end on 2026-12-01 is [U] (Mend docs only).
- **MCP**: Microsoft runs a remote MCP server (Entra auth, Entra-backed orgs only). **DCR is not supported**, so Claude Code, Cursor, Codex and Claude Desktop must use the **local** `npx -y @azure-devops/mcp <org>` server. It covers work items, PRs, builds and test plans, and is free [V] https://learn.microsoft.com/en-us/azure/devops/mcp-server/mcp-server-overview

### Long tail (all have official hosted MCP; skip bespoke clients)
| Tool | Official MCP | Auth | Notes |
|---|---|---|---|
| Monday (incl. monday dev) | `https://mcp.monday.com/mcp` | API token, own OAuth app, or DCR | 60+ tools; calls count toward the daily GraphQL API limit; an admin must approve extra clients [V] https://developer.monday.com/api-reference/docs/mondaycom-mcp |
| ClickUp | `https://mcp.clickup.com/mcp` | **OAuth 2.1 + PKCE only; no API keys** | Daily caps without the AI add-on: Free 100, Unlimited 300, Business 1,000 calls per 24h; no delete tools [V] https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server |
| Asana | `https://mcp.asana.com/v2/mcp` | OAuth (some clients need their own client id/secret) | V1 `/sse` was shut down on 2026-05-11 [V] https://developers.asana.com/docs/using-asanas-mcp-server |
| Notion | hosted remote MCP | OAuth only | Enterprise plan needed to restrict which clients can connect [V] https://developers.notion.com/docs/mcp |
| YouTrack | built-in remote MCP since 2025.3 | YouTrack token/OAuth | Custom tools scriptable in JS [S] https://blog.jetbrains.com/youtrack/2025/10/youtrack-introduces-a-remote-mcp-server-and-new-apps/ |
| Shortcut | `mcp.shortcut.com` (OAuth) plus local `@shortcut/mcp` (API token) | | [S] https://help.shortcut.com/hc/en-us/articles/36443434285844-MCP-Server |
| Plane | `https://mcp.plane.so/http/mcp` (OAuth/PAT), self-host friendly | | [S] |
| Trello | no official MCP found [U] | REST key + token | Mostly non-dev use |

---

## 4. Webhooks vs polling
- Every tracker has webhooks, but a desktop app behind NAT can't receive them without a relay (smee/ngrok/cloud), which adds infrastructure and a security surface. **Poll instead**: when the Tasks screen is open, and every 5–10 minutes in the background. GitHub ETags make this nearly free. Jira API-token traffic is exempt from the new points quota. Linear's 2,500/hour is plenty.
- Use notifications (ntfy) only for "new issue assigned to me", based on the diff between polls.

---

## 5. Recommendation for Turno

**Two layers, kept separate:**

1. **Tasks screen (the human view: list my issues, start an agent on an issue)**. This needs deterministic data with no LLM involved, so call the trackers directly, but cheaply:
   - **GitHub**: shell out to `gh` (`gh search issues --assignee @me --state open --json …`). No token handling in Turno.
   - **GitLab**: shell out to `glab` (`glab issue list --assignee=@me -F json`).
   - **Jira Cloud**: a small REST client (one endpoint: `search/jql`, plus transitions and comment), using an API token + email stored with Electron `safeStorage`. Optionally detect `acli` and reuse its login.
   - **Linear**: a personal API key to start, with one GraphQL query plus `commentCreate`/`issueUpdate`. Linear is the only big tracker where OAuth with PKCE is easy if a "Sign in with Linear" button is wanted later.
   - The per-provider adapter is tiny: `listMine()`, `get(id)`, `comment(id, md)`, `setStatus(id, state)`, `url`. Normalize to one `Task` type. This covers roughly 85–90% of devs.
   - Azure DevOps: a 5th provider through `az boards` or REST with a PAT, only if users ask for it.
2. **Agent-side access (posting status back, reading full context)**. Don't build bespoke write paths here. Let the agent do it:
   - When starting an agent from a task, put the issue key/URL/body in the prompt, and say "use `gh`/`glab`/`acli` or the connected MCP to comment and transition".
   - For the long tail (Monday, ClickUp, Asana, Notion, YouTrack, Shortcut, Plane), **don't build Tasks-screen providers at all**. Expose them only as MCP connections handed to the agent (the official hosted URL plus OAuth handled by the agent CLI). Each has fewer than 5% of devs.
   - Warn about context cost: prefer the CLI over MCP for GitHub (the GitHub MCP is about 40–55k tokens). Use toolset filters: the GitLab header and GitHub `X-MCP-Toolsets`/read-only modes [U on the exact header name for GitHub], plus Linear's `/mcp/readonly`.

**Why not use MCP for the Tasks screen itself?** MCP servers are built for LLM tool calls: their output shapes vary, pagination has bugs (Rovo #118), and OAuth needs DCR, which only some servers support (Azure DevOps doesn't). Several need admin enablement (Rovo API tokens, GitLab MCP, Monday extra clients), and some have tight daily caps (ClickUp Free: 100 calls/day). Using MCP as Turno's data plane would be fragile. CLIs (`gh`/`glab`) give stable JSON, and the user has often already logged in.

**Cheapest path, in order:** gh (0 auth code) → glab (0 auth code) → Jira REST + token (about 1 file) → Linear GraphQL + key (about 1 file) → everything else via MCP passed to agents.

---

## 6. Open questions / to verify
- Exact `acli jira workitem search` flags and JSON output.
- Whether the GitHub remote MCP OAuth works with non-VS Code clients without a pre-registered app (no DCR?) [U].
- Whether Atlassian Cloud 3LO PKCE (ECO-283) has shipped yet [U].
- Microsoft's confirmation of the global PAT end date [U].
- JetBrains DevEco 2025 tracker figures (not found).
