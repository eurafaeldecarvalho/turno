# OmniRoute: what it is, and what Turno should take from it (Oct 22 2026)

The user wrote "openroute", but the app is **OmniRoute**. It is the "app that connects to every free agent version and moves to the next one when the limit runs out".

- **Repo:** https://github.com/diegosouzapw/OmniRoute
- **npm package:** `omniroute`
- **Version analysed:** v3.8.53, commit `2319a84`, Oct 22 2026
- **License:** MIT, Copyright (c) 2026 diegosouzapw. Code can be ported with attribution.
- **The "347" figure** is an older release count. Earlier releases advertised 352 and 358 providers (README table, line 68). The current catalog has **375 providers**.

**Files**
- `docs/research/omniroute/providers.json`: 389 entries. These are the 375 dashboard providers plus 14 entries that exist only in the media/search registries.
- `docs/research/omniroute/rea/`: REA output (see section 8).
- Clone, subset and scripts: in the session scratchpad (`omniroute/`, `omni-rea-subset/`, `omni-tools/`).

**Method**
- Static analysis only. Nothing in OmniRoute was installed or run: no `npm install`, no server start, no logins, no keys.
- `providers.json` was extracted with the TypeScript compiler AST (`omni-tools/extract.cjs`). The target code was never executed.

**OpenRouter is a different thing.** OpenRouter (openrouter.ai) is a hosted, paid aggregator: one API key gives access to many models, a few of them `:free`. OmniRoute lists it as just one of its providers (`openrouter`, api-key, free tier about 1.2M tokens/month by its own estimate). OpenRouter is useful to Turno only as one more endpoint. It is not the app the user meant.

---

## 1. What OmniRoute is

OmniRoute is a self-hosted **AI gateway**: a local HTTP server, Next.js plus the `open-sse` core, on port **20128** (`src/lib/runtime/ports.ts:1`).

**One endpoint, every API format.** It exposes these APIs at `/v1`:
- OpenAI: `chat/completions`, `responses`, `models`, `embeddings`, images and audio;
- Anthropic: `messages` and `messages/count_tokens`;
- Gemini (`/v1beta`).

A translator converts any of them to any provider format, with OpenAI as the hub (`open-sse/translator/index.ts`). So Claude Code can run on a Groq or Gemini key, and Codex can run on a Claude account.

**Model names**
- `alias/model` or `provider/model`, for example `cc/claude-sonnet-...` or `groq/openai/gpt-oss-120b`.
- Or the name of a **combo**. A request whose `model` equals a combo name is routed through that combo (`src/sse/handlers/chat.ts:662`).

**Connections**
- Many accounts or keys per provider, stored in SQLite `~/.omniroute/storage.sqlite`, table `provider_connections`.
- Tokens are AES-256-GCM encrypted only when `STORAGE_ENCRYPTION_KEY` is set. Otherwise they are stored in plaintext (`src/lib/db/encryption.ts:7`).

**Combos** are ordered lists of `provider/model` targets with one of **20 routing strategies**, for example `priority`, `round-robin`, `headroom`, `reset-aware`, `quota-weighted`, `cost-optimized` and `auto`.

**`auto`** builds a virtual combo from every connected provider. It scores them on health, quota, cost, latency, task fit and more (`open-sse/services/autoCombo/scoring.ts:62-88`).

**The "4-tier fallback"** is a marketing name. The code (`subscriptionLadder.ts:49`) has 5 rungs: `subscription → keyless → free → cheap → premium`.

**Other surfaces**
- Dashboard UI and an Electron shell around it.
- An MCP server with about 110 tools.
- A2A and ACP.
- Token compression (RTK/"Caveman").
- Semantic cache, guardrails, usage and cost analytics, memory, evals.
- A MITM "AgentBridge" for IDEs that cannot change their base URL (Antigravity, Kiro).

## 2. How it connects "375 providers"

These counts come from `src/shared/constants/providers/*` (the dashboard catalog) merged with `open-sse/config/providers/registry/*` (base URLs and formats). Counts are taken from `providers.json`.

| kind (providers.json) | count | how it authenticates | examples |
|---|---|---|---|
| `api-key` | 252 (231 LLM) | Paste a key; usually Bearer on an OpenAI-compatible base URL | groq, cerebras, mistral, openrouter, nvidia, gemini, deepseek, together, cloudflare-ai |
| `oauth-cli` | 27 | OAuth on the provider's own subscription account: PKCE browser flow (claude, codex, gitlab-duo, xai), device code (github/copilot, kiro, kilocode, kimi-coding, codebuddy, grok-cli), or token import (cursor, trae, zed, devin-desktop) | claude, codex, github, cursor, kiro, agy/antigravity, cline, qoder |
| `web-cookie` | 37 | A browser session cookie pasted into OmniRoute, replaying the consumer web chat | chatgpt-web, claude-web, gemini-web, grok-web, perplexity-web, deepseek-web, huggingchat, lmarena |
| `free` (no auth) | 5 | Anonymous endpoints | duckduckgo-web, cloudflare-playground, uncloseai, aihorde, veoaifree-web |
| `local-cli` | 4 | Wraps a locally installed, logged-in CLI (auth stays in that CLI) | auggie, zcode, codex-app-server, devin-cli-agentic |
| `local` | 14 | `localDefault` URL, no key | ollama-local, lm-studio, vllm, llama-cpp, lemonade, comfyui |
| `search` / `audio` / `cloud-agent` / `router` / `system` | 18 / 12 / 3 / 2 / 1 | Search APIs, TTS/STT, Jules/Devin/Codex Cloud task APIs, CLIProxyAPI/9router, the `auto` pseudo-provider | |
| `registry-only` | 14 | Entries that exist only in the image/video/OCR/search registries | |

**Free tiers and terms**
- 147 LLM entries are flagged free (`hasFree` or keyless/local).
- 17 have a documented monthly free-token budget (`freeTierCatalog.ts`), for example mistral 1B, nara 210M, cloudflare-ai 122M, doubao 60M, groq 30M.
- 16 are marked `tos: "avoid"` because their terms forbid proxying: agy/antigravity, kiro, amazon-q, duckduckgo-web, t3-web, fireworks, ai21 and others.
- 50 entries carry `subscriptionRisk: true`: the dashboard warns that the account may be banned.

**API formats** (from the registry `format` field)
- 201 openai, 9 anthropic, 3 gemini, 4 openai-responses, plus custom formats (kiro, cursor, antigravity, image and audio).
- Only these accept Anthropic Messages directly: anthropic, claude, github (Copilot `/v1/messages` shim), ghe-copilot, zai, bailian-coding-plan, agentrouter, wafer, poe, tabitoken, zenmux-free, devin-cli-agentic.
- All other entries need translation before **Claude Code** (which Turno's `endpoint` connections drive through `ANTHROPIC_BASE_URL`) can use them.

## 3. Routing, rotation and limit detection

**Picking an account within one provider** (`src/sse/services/auth.ts:1826-2040`)
- Default strategy is fill-first. Session affinity wins over it.
- Round-robin stays on an account for 3 requests.
- Accounts with `rateLimitedUntil` set are skipped.
- Several keys inside one connection rotate round-robin. A key is marked invalid after 2 auth failures. A 429 cools only that key down, for Retry-After or 60 s (`apiKeyRotator.ts`).

**Across targets** (`combo/comboAttemptLoop.ts`)
- Targets are tried in strategy order. A same-model retry happens only on 408/429/5xx.
- A context-overflow 400 stops the combo only if every remaining target is the same model.
- Global budget: 30 attempts. Optional hedging after 500 ms.
- If every target failed for a temporary reason, it waits out the cooldown (≤90 s per wait, ≤300 s total) and retries the whole set.

**Limit classifier** (`accountFallback.ts:1682-2360`, `config/errorConfig.ts`, `config/providerErrorRules.ts`)
- It reads the **body text before the status code**:
  - Banned or deactivated: 1 year.
  - Retired model: 24 h.
  - Out of credits (`insufficient_quota`, `credit_balance_too_low`...): 2 min, re-checked.
  - Daily quota: until the next reset or midnight.
  - Rate limit: exponential backoff from 1 s up to 2 min, with OAuth and API-key profiles.
  - Per-provider rules for opencode, minimax, cloudflare, openrouter, agentrouter and others.
- Reset time comes from `retry-after`, `x-ratelimit-reset`, JSON body hints and prose ("resets in 1h2m"), capped at 30 days.

**Polling quota ahead of time**
- Claude `api.anthropic.com/api/oauth/usage` (cached 65 s).
- Codex `chatgpt.com/backend-api/wham/usage` (5 h and 7 d windows).
- Copilot `copilot_internal/user`, Cursor, Kiro, MiniMax, Kimi, OpenRouter, DeepSeek and about 20 more.
- A connection is blocked when ≤2% of its quota remains.

**Mid-stream: no failover after output starts.**
- Up to 1 MB of the stream start is buffered to check it is not empty. After real content has reached the client, the response is committed. The account is cooled down for the *next* request.
- Opt-in stream recovery retries on the **same** account.
- Context survives a switch only because every request carries the full `messages` array. OmniRoute is stateless per request.
- The `context-relay` strategy has a model write a summary at 85% quota and injects it after an account switch.

**Risky behaviour found**
- `claudeLimitReset.ts` calls `POST /api/organizations/{org}/reset_rate_limits` to claim a weekly reset on Claude subscription accounts.
- OAuth providers replay vendor CLI identities and fingerprints (`claudeCodeFingerprint.ts`, `cliFingerprints.ts`, `codexIdentity.ts`, TLS "stealth").
- This is the "proxy of subscription tokens" pattern that `agent-pool/compliance.md` rates PROHIBITED or RISKY for Anthropic, OpenAI, Google and GitHub.

## 4. How clients are pointed at it

`src/shared/constants/cliTools.ts` and `config/cli-tools-manifest.json` cover 37 CLI integrations:
- **Claude Code:** env block in `~/.claude/settings.json`: `ANTHROPIC_BASE_URL=http://localhost:20128`, `ANTHROPIC_AUTH_TOKEN=<omniroute key>`, `ANTHROPIC_MODEL` and `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`.
- **Codex:** `~/.codex/config.toml` gets `model_provider="omniroute"` and `[model_providers.omniroute] base_url, wire_api, env_key`.
- **Others:** config writers for cline, kilo, droid, openclaw, crush, pi, omp, forge, jcode, grok-build, deepseek-tui and others. The rest are copy-paste guides (opencode, qwen, aider, continue, goose, zed...).
- Antigravity and Kiro cannot change their base URL, so they need the MITM.

Client auth is `Authorization: Bearer sk-…`, or `x-api-key` for Claude clients (`src/sse/services/auth.ts:3502`). Keys are optional unless `REQUIRE_API_KEY=true`.

## 5. What Turno has today

- **Agent catalog** (`src/shared/agents.ts`): 44 CLIs. Turno launches each one, resumes it, and isolates it per account via `homeVar`.
- **Accounts** (`src/main/accounts.ts`): `accounts.json` holds per-agent ranked accounts. The login is done by the official CLI in a visible terminal. **Turno never reads or stores subscription tokens.**
- **Limit detection:** Claude hooks and statusline, plus `isWallText` for other agents.
- **Broker** (`agentBroker.ts`): swaps account or agent in the same tab, with a handoff file.
- **Connections** (`settings.ts`, `providers.ts`): `kind: 'claude' | 'endpoint'`. An endpoint is `{baseUrl, token, model, bootCommand?, healthUrl?, extraEnv?}` and is turned into `ANTHROPIC_*` env for the `claude` binary (`resolveProviderEnv`). It therefore needs an **Anthropic-Messages-compatible** URL.

**Where each design is stronger**

Turno:
- It owns the conversation, so it can swap at the *session* level with a handoff.
- It stays inside the ToS for subscription accounts.

OmniRoute:
- It has the huge provider catalog.
- It translates between API formats.
- It classifies errors by body text.
- It polls quota ahead of time and rotates keys.

## 6. Recommendation: (c) both, with a hard ToS line

**Do not adopt OmniRoute's OAuth, web-cookie or MITM connections.** Subscription accounts (Claude, Codex, Copilot, Gemini CLI, Kiro, Antigravity, Cursor) stay as they are: the official CLI, an isolated home, one account per CLI login, swapped by Turno's broker. This is the line already drawn in `agent-pool.md` §4–5.

### (a) Import the catalog as data (do first; low risk, MIT)

1. Ship a generated `src/shared/providerCatalog.json`, a trimmed version of `providers.json`, credited "derived from OmniRoute (MIT, © 2026 diegosouzapw)".
   - Include only `api-key`, `free`, `local` and `local-cli` LLM entries.
   - Drop `oauth-cli`, `web-cookie` and `tos: avoid`.
   - Keep `oauth-cli` entries only as *hints* that map to Turno agents (`turnoAgent`; 26 matches) so Settings can say "install the X CLI".
2. Settings › Connections › "Add from catalog":
   - pick a provider, paste a key (stored with Electron `safeStorage`, not in settings.json), pick a model;
   - this creates an `endpoint` connection.
3. Direct use works only for the roughly 12 Anthropic-compatible entries (z.ai, bailian-coding-plan, Copilot shim and the rest of the list in section 2).
4. For the other ~200 OpenAI-format entries, the endpoint has to go through a translator. That is (b).

### (b) OmniRoute as an optional local router that Turno manages (do second)

- Turno installs or locates `omniroute` (npm global, or a pinned version in `%APPDATA%\Turno\omniroute`).
- It starts it with:
  - `DATA_DIR=%APPDATA%\Turno\omniroute-data`;
  - `PORT` set to a free loopback port, bound to `127.0.0.1`;
  - `REQUIRE_API_KEY=true`;
  - a generated `STORAGE_ENCRYPTION_KEY` (kept in safeStorage);
  - `INITIAL_PASSWORD` set, because the dashboard password otherwise defaults to `CHANGEME`.
- The existing `bootCommand` and `healthUrl` fields already model this; `healthUrl` points at `/api/health`.
- A seeded connection:
  `{ id:'omniroute', kind:'endpoint', baseUrl:'http://127.0.0.1:<port>', token:<omniroute key>, model:'<combo name>' , bootCommand, healthUrl }`.
  Claude Code then talks Anthropic to OmniRoute, and OmniRoute fans out to Groq, Cerebras, Mistral, OpenRouter, Ollama and the rest.
- Turno pushes the user's catalog keys into OmniRoute through its management API, or leaves that to OmniRoute's dashboard opened in a Turno tab. It creates a "free-first" combo:
  - strategy `priority` or `headroom`;
  - local Ollama as the last target.
- Lock it down by turning these off in OmniRoute settings: OAuth/web-cookie providers, MITM, cloud sync, tunnels.
- Turno never adds a subscription OAuth account to OmniRoute.

**Pros**
- 200+ OpenAI-format providers become usable by Claude Code at once.
- Per-request failover and key rotation that Turno does not have.
- Zero porting effort.

**Cons**
- A large dependency: Next.js, native better-sqlite3, Playwright. It needs Node 22.22+ or 24+.
- Fast release cadence.
- A second token store.
- Its own failover happens *inside one Claude Code session*. Turno sees only one "account", so Turno's limit UI shows nothing unless it reads OmniRoute's `/api/quota` and `/v1/quotas/check`.
- The license is fine (MIT). The risk is operational, not legal.

**Alternative to (b) if the dependency is too heavy:** port a minimal Anthropic→OpenAI translator (about 1–2 kLOC from `open-sse/translator/request/claude-to-openai` and `response/openai-to-claude`, MIT with attribution) into Turno's main process, as a local `/v1/messages` shim.

### Proposed data schema

```ts
// src/shared/types.ts (extends Connection; kind stays 'claude' | 'endpoint' plus a new 'router')
interface CatalogProvider {            // read-only, generated from OmniRoute
  id: string; name: string
  kind: 'api-key' | 'free' | 'local' | 'local-cli'
  apiStyle: 'anthropic' | 'openai' | 'openai-responses' | 'gemini'
  baseUrl?: string                     // chat URL as in the registry (strip /chat/completions or /messages for env)
  anthropicMessagesUrl?: string        // present = usable directly by Claude Code
  modelsUrl?: string; models?: string[]
  freeTier: boolean; freeNote?: string; monthlyFreeTokens?: number
  tos?: 'ok' | 'caution' | 'ambiguous' | 'avoid' | 'unknown'
  docsUrl?: string; authNotes?: string
  turnoAgent?: string                  // id in AGENTS when the provider is really a CLI subscription
  source: 'omniroute@3.8.53'
}
interface Connection {
  id: string; name: string
  kind: 'claude' | 'endpoint' | 'router'
  catalogId?: string                   // CatalogProvider.id it was created from
  baseUrl?: string; model?: string
  tokenRef?: string                    // safeStorage key; never the raw key in settings.json
  via?: 'direct' | 'omniroute'         // endpoint that needs translation goes through the router
  bootCommand?: string; healthUrl?: string; extraEnv?: Record<string, string>
  freeTier?: boolean                   // drives the "free first" ranking preset
}
```

## 7. Other OmniRoute features worth bringing in

1. **Error classifier rules as data.** Port `ERROR_RULES` and the body signals from `errorConfig.ts`, `creditExhaustionSignals.ts`, `ACCOUNT_DEACTIVATED_SIGNALS` and `providerErrorRules.ts` into Turno's `isWallText`. Split the result into *wall* (limit), *credits* (paid out), *banned* and *transient*. Turno today has one regex list, and a banned account and a limit look the same to it.
2. **Reset-time parsing.** Port the `retry-after`, `x-ratelimit-reset` and "resets in 1h2m3s" prose regexes (`accountFallback.ts:80-86, 1773-1803`). This gives `until` for non-Claude agents, which Turno usually lacks.
3. **Proactive quota fetchers, for read-only display.** Two candidates:
   - Codex `wham/usage` (5 h and 7 d) using the CLI's own `auth.json`, read in the user's CODEX_HOME;
   - Copilot `copilot_internal/user`.

   Turno already does the Claude statusline. Gate this behind a setting and treat it carefully: reading the CLI's token file is a gray zone (compliance.md). Use the Claude 429 backoff idea (`claudeUsageCooldown.ts`, 3–30 min).
4. **Ranking strategies for accounts.** Add `headroom` (most 5h/7d left first) and `reset-aware` (spend the account that resets soonest first) next to the manual rank. Both are small formulas in `combo/quotaStrategies.ts`.
5. **The 5-rung ladder as a ranking preset.** subscription → keyless/free → cheap → premium, with hysteresis. This maps onto Turno's "free first" preset idea.
6. **Context-relay summary at 85%.** Same idea as Turno's checkpoint-before-wall. Borrow the trigger thresholds (0.85 warn, 0.95 exhausted) and the injected-system-message format.
7. **CLI config recipes** (`cli-tools-manifest.json`): which env vars or config files point Codex, OpenCode, Crush, Droid, Cline, Kilo, Qwen and others at a custom base URL. Turno can use this to run *any* agent in its catalog on an `endpoint` connection, not just Claude Code. This is the biggest catalog win after providers.
8. **Free-tier budget and ToS table** (`freeTierCatalog.ts`): show "≈30M tokens/month free" and a "terms: avoid" badge in the catalog picker.

**Not worth it, or must avoid:**
- OAuth subscription proxying, web-cookie providers, the MITM AgentBridge, CLI fingerprint and TLS "stealth", and `reset_rate_limits` claiming. These are against the ToS and carry a ban risk, and conflict with Turno's no-token rule.
- MCP server (110 tools), A2A/ACP, memory, evals, guardrails, semantic cache, compression engines, gamification, tunnels, cloud sync. All are out of scope for Turno, and compression changes prompts silently.
- The full 20-strategy combo engine inside Turno. Turno swaps per session, not per request. Use OmniRoute itself (b) when per-request routing is wanted.
- The media, audio, search and image providers (12 + 18 + 14 entries).

## 8. REA run

| Run | Command | Output | Result | Electron summary |
|---|---|---|---|---|
| Core | `npx -y rea-agents@latest analyze-javascript-application <scratchpad>/omni-rea-subset --json` (rea-agents 6.7.0) | `rea/rea-core.summary.json`, plus full Evidence in `rea/rea-core.evidence.json.gz` (190 MB unpacked) | 560 TS files parsed, 277,713 AST nodes, 6,412 findings, 538 modules, 3,667 import edges | n/a |
| Electron | the same command on `electron/` | `rea/rea-electron.summary.json`, `rea/rea-electron.evidence.json` | n/a | 2 BrowserWindows, 2 preloads, `contextBridge` APIs `electronAPI` and `remoteServerPrompt` (22 members), 17 IPC handlers |

**Core subset contents:** provider catalog, `open-sse/config`, combo, autoCombo, accountFallback, rotators, cliTools, `/v1` chat, messages, responses and models routes, with tests removed. The full repo is 986 MB.

**Core findings**
- Hub modules: `providers/shared.ts` (fan-in 127), `combo/comboPredicates.ts`, `accountFallback.ts`, `combo/strategyRegistry.ts`.
- 58 env config sources, for example `OMNIROUTE_API_KEY_COOLDOWN_MS`, `QUOTA_SOFT_DEPRIORITIZE_FACTOR`, `OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL`, `DATA_DIR`, `PORT`.
- Network header candidates: `retry-after`, `x-ratelimit-reset`, `x-omniroute-budget`, `x-omniroute-mode`, `x-omni-fallback-hint`.
- The semantic graph was truncated at REA's 100k-node ceiling: 88,916 relations, 21,534 unknowns.

**Electron IPC handlers:** `restart-server`, `get-data-dir`, `check-for-updates`, `download-update`, `install-update`, `{enable,disable}-autostart`, `open-external`, window controls, and `remote-server-prompt:*`. The shell only spawns or attaches to the server and loads the dashboard URL, which is the same pattern Turno would use for (b).

**REA limitations:** the parse is inert, with no runtime proof, and dynamic paths are unresolved. The catalog facts above come from the AST extractor, not REA.

**Not verified**
- Runtime behaviour: no server was started, and no provider was contacted.
- Free-tier terms and budgets are OmniRoute's own claims.
- The Anthropic-compatible list relies on the `format`/`messagesUrl` fields. Providers whose registry `format` is an expression were left as `unknown`.
