# Connectivity research: one desktop app -> every coding/chat agent (as of 2026-10-21)

Scope: ACP, per-CLI headless modes, auth + multi-account isolation, free tiers, aggregators, and the "free-tier rotator" apps.
Legend: [V] verified from primary source (official docs / registry JSON / source code); [S] secondary source only; [?] unverified/conflicting.

## 1. Agent Client Protocol (ACP)

- JSON-RPC 2.0 over stdio, editor (client) spawns agent (server). Spec + list: https://agentclientprotocol.com/overview/agents [V]
- Zed launched the ACP Registry 2026-01-28 (https://zed.dev/blog/acp-registry). JetBrains co-maintains; Zed 1.0 (2026-04-29) shipped ACP as headline [S: heise https://heise.de/-11160709].
- Registry repo: https://github.com/agentclientprotocol/registry. Machine-readable index (downloaded copy: C:\rx\notes\raw\acp-registry.json):
  `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` [V]. CI verifies every agent returns valid `authMethods` in the handshake.
  Distribution kinds: npx / uvx / per-platform binary archive. A Turno "Agent" button can read this JSON to offer every agent with zero hardcoding.
- Registry entries as of today (id | version | launch) [V, from registry.json]:
  - claude-acp 0.94.0 | `npx @agentclientprotocol/claude-agent-acp` (adapter over Claude Agent SDK; formerly zed-industries/claude-code-acp)
  - codex-acp 2.2.2 | `npx @agentclientprotocol/codex-acp` (adapter over Codex)
  - gemini 0.65.0 | `npx @google/gemini-cli --acp` (native)
  - github-copilot-cli 1.0.102 | `npx @github/copilot --acp` (native; public preview)
  - qwen-code 0.25.3 | `npx @qwen-code/qwen-code --acp --experimental-skills` (native)
  - cursor 2026.10.19 | `cursor-agent acp` (native)
  - opencode 1.19.3 / opencode-v2 2.1.2 | `opencode acp` (native)
  - amp-acp 0.10.0 | `amp-acp` binary (adapter)
  - goose 1.55.0 | `goose acp`; grok-build 1.0.67 | `npx @xai-official/grok agent stdio`; kimi 1.52.0 | `kimi acp`
  - antigravity-acp 1.4.1 | `agy_acp_server.par` (Google's separate ACP server; the `agy` CLI itself has no ACP mode per Orca comment)
  - devin `devin acp`; factory-droid `npx droid exec --output-format acp-daemon`; cline `npx cline --acp`; kilo `npx @kilocode/cli acp`;
    auggie `npx @augmentcode/auggie --acp`; junie `junie --acp=true`; mistral-vibe `vibe-acp`; qoder `qodercli --acp`; pi-acp `npx pi-acp`;
    poolside `pool acp`; minimax-code, glm-acp-agent, kimchi, codebuddy-code (Tencent), bob (IBM), cortex-code (Snowflake), stakpak, vtcode, etc. (44 total)
- Kiro: NOT in the registry JSON, but natively speaks ACP: `kiro-cli acp [--agent <name>]`; vendor extensions under `_kiro.dev/`; CLI V3 engine via `--agent-engine=v3 --auth-method=cli` (https://kiro.dev/docs/cli/acp/, https://kiro.dev/docs/cli/v3/acp-migration/) [V-ish: official doc via search snippet]. Community registries list `kiro-cli-chat acp` for some versions [S] -> probe `--help`.
- ACP features relevant to Turno:
  - `session/new`, `session/load` (replays history; capability `loadSession`), `session/resume` (no replay), `session/prompt`, `session/update` notifications incl. `usage_update` (context-window usage) [V: Orca src/main/acp/acp-session-setup.ts:46-59, acp-context-usage.ts:42, acp-session-update.ts:89].
  - Auth: agent advertises `authMethods` in `initialize`; client may call `authenticate` (Orca deliberately never triggers interactive auth: acp-launch-specs.ts `authMethod` picks env API key or cached token only).
  - No standard "quota remaining" / rate-limit message in ACP [V by absence in Orca's generated schema use; Orca reads quota via vendor-specific endpoints instead]. Limit detection must be per-vendor (error text / JSON-RPC error / vendor usage API).
  - ACP sessions are agent-private: you cannot load a Claude session into Codex. Cross-agent continuity = summarize + inject as first prompt (or `_meta`/resource content).

### How Orca does it (C:\rx\orca, MIT)
- Data-driven launch specs: src/main/acp/acp-launch-specs.ts (one `AcpLaunchSpec` row per agent: command, args, env, dialect, `authMethod`, `account` binding, `modelDiscovery`, `sessionHistory`, `resumePreference`). Agents on ACP there: grok, opencode/opencode2, omp, antigravity (+ more via `row.agent` table ~line 229).
- Claude and Codex are NOT run via ACP in Orca: Claude via native SDK/stream-json, Codex via `codex app-server` JSON-RPC (src/main/rate-limits/codex-rpc-rate-limit-probe.ts:223 sends `account/rateLimits/read`).
- Account isolation = per-agent "home" env var (src/main/acp/acp-account-binding.ts `directoryAccountBinding(VAR, default)`); allowlist of agent-home vars in src/main/ai-vault/session-scanner-service-env.ts:35-50:
  `CLAUDE_CONFIG_DIR, CODEX_HOME, CLINE_SESSION_DATA_DIR, COPILOT_HOME, DEVIN_HOME, GROK_HOME, KIMI_CODE_HOME, KIRO_HOME, OMP_CODING_AGENT_DIR/PI_CODING_AGENT_DIR, OPENCLAW_STATE_DIR, OPENCODE_DB` (+ XDG_DATA_HOME for opencode).
- Gotcha [V: src/main/claude/claude-config-dir-pin.ts:30-50]: setting CLAUDE_CONFIG_DIR changes the OS keychain item name the Claude CLI uses; passing it even with the default path breaks the default claude.ai OAuth login, and the exact string matters (no normalization) — only set it for non-default homes.
- Quota APIs Orca uses: Claude `GET https://api.anthropic.com/api/oauth/usage` (src/main/rate-limits/claude-oauth-usage-request.ts:18); Codex `GET https://chatgpt.com/backend-api/wham/usage` (codex-backend-usage-client.ts:69) or app-server `account/rateLimits/read`. Antigravity has a usage command (antigravity-usage-*.ts). Also cursor-accounts, grok-accounts, opencode-usage, muse-usage modules in src/main.
- Orca has conversation copy (acp-conversation-copy.ts) and recovery-history, but within the same agent; no cross-agent handoff found.

### cux (C:\rx\cux, GPL-3.0 — ideas only)
- Claude-only. Wrapper process runs `claude`; installs hooks (UserPromptSubmit, Stop, SessionStart, PostToolUseFailure) that write signal files; on rate-limit -> exit now; on threshold -> wait for Stop (turn end); swap credentials transactionally; relaunch `claude <orig flags> --resume <id> [auto_message]` (README "How it works").
- Strategies: drain (use until 7-day cap near, explicit order), balanced (lowest 7d util, tiebreak 5h), manual. Model-specific weekly windows used as tiebreak. "Projects" bind directories to subsets of seats.
- Key idea for Turno: same-agent swap keeps full context via `--resume` (session files live in the config dir -> must copy/share the session transcript into the new account's home, or use a shared projects dir); cross-agent swap needs summary injection.

## 2. Per-agent headless modes, auth, multi-account, resume

| Agent | ACP | Headless / stream mode | Auth | Multi-account isolation | Resume |
|---|---|---|---|---|---|
| Claude Code | adapter `@agentclientprotocol/claude-agent-acp` [V] | `claude -p --output-format stream-json [--input-format stream-json] --verbose`; Agent SDK [V known] | claude.ai OAuth (Pro/Max) or ANTHROPIC_API_KEY | `CLAUDE_CONFIG_DIR` per account [V Orca]; keychain item keyed by literal path | `--resume <id>`, `--continue`; ACP session/load |
| Codex CLI | adapter `@agentclientprotocol/codex-acp` [V] | `codex exec --json`; `codex app-server` (JSON-RPC, incl. `account/rateLimits/read`) [V Orca] | ChatGPT OAuth or OPENAI/Codex API key | `CODEX_HOME` [V Orca] | `codex resume <id>` / `codex exec resume` [? flags not re-verified today] |
| Gemini CLI | native `--acp` [V] | `gemini -p --output-format json|stream-json` [S] | Google login, GEMINI_API_KEY, Vertex | `GEMINI_CLI_HOME` (creates .gemini inside) [S official doc mirror] | `--resume` [?] |
| Antigravity (agy) | separate `antigravity-acp` server [V] | `agy` CLI [S] | Google OAuth (`oauth-personal`) [V Orca] | per-folder sign-in managed by Orca (antigravity-chat-account.ts) | ACP session/resume |
| GitHub Copilot CLI | native `--acp` [V] (preview) | `copilot -p "<prompt>" --allow-all-tools` [? ] | GitHub OAuth / GH token | `COPILOT_HOME` (default ~/.copilot) [V Orca] | `--resume`, `--continue` [?] |
| Kiro CLI | native `kiro-cli acp` [V doc] | `kiro-cli chat --no-interactive` [?] | AWS Builder ID / IAM Identity Center / Google / GitHub | `KIRO_HOME` replaces ~/.kiro (configs+sessions) [V Orca agent-home-login-shell.ts:78] | `--resume` [?]; sessions in $KIRO_HOME/sessions/cli |
| Qwen Code | native `--acp` [V] | `qwen -p --output-format stream-json` (Gemini-CLI fork) [S] | API key / Alibaba Coding Plan / OpenAI-compatible; Qwen OAuth free tier ended | home var not verified (Gemini fork -> likely ~/.qwen) [?] | `--resume` [?] |
| OpenCode | native `opencode acp` [V] | `opencode run --format json`; `opencode serve` HTTP [S] | many providers (auth.json), OpenCode Zen/Go, free models | XDG_DATA_HOME / OPENCODE_DB [V Orca] | `--session`/`--continue` [?] |
| Cursor CLI | native `cursor-agent acp` [V] | `cursor-agent -p --output-format stream-json` (stream-json default in print mode) [V docs.cursor.com] | Cursor login / CURSOR_API_KEY | Orca has cursor-accounts module; env var not verified [?] | `--resume <chatId>` [?] |
| Amp | adapter `amp-acp` [V] | `amp -x --stream-json` [S] | Amp account / AMP_API_KEY | separate API keys [?] | `amp threads continue` [?] |
| Goose | native `goose acp` [V] | `goose run -t ...` [S] | any provider key, local models | config dir via XDG [?] | `goose session --resume` [?] |
| Grok Build (xAI) | native `grok agent stdio` [V] | — | XAI_API_KEY or cached OAuth token [V Orca] | `GROK_HOME` [V Orca] | ACP session/load |
| Kimi CLI | native `kimi acp` [V] | — | Moonshot OAuth/API key | `KIMI_CODE_HOME` [V Orca allowlist] | ACP |
| Devin CLI | native `devin acp` [V] | — | Devin account | `DEVIN_HOME` [V Orca] | ACP |
| Factory Droid | `droid exec --output-format acp-daemon` [V] | `droid exec` | Factory account/key | ? | ? |
| Cline / Kilo / Auggie / Junie / Mistral Vibe / Qoder | native ACP [V] | various | own | Cline: CLINE_SESSION_DATA_DIR [V Orca] | ACP |

General rule: every CLI that keeps credentials in a home dir can host N accounts by giving each account its own home dir via its env var and launching the child with that env. OAuth login must be done once per home dir by the user (Turno only spawns `<agent> login` in a terminal with that env).

## 3. Free tiers today (Oct 2026) and limit signals

- Claude Code: no free tier (Claude Free plan does not include Claude Code) [S]. Limits: 5h session + weekly windows; usage via `api/oauth/usage` [V Orca].
- Codex: ChatGPT Free/Go "GPT-6 Luna at Standard speed in the desktop app, subject to rollout"; CLI/IDE not listed for Free/Go [V https://learn.chatgpt.com/docs/pricing.md]. Paid: 5h rolling + weekly windows; signal via `wham/usage` or app-server rateLimits [V Orca].
- Gemini CLI: page says "Gemini CLI was replaced by Antigravity CLI on June 18th, 2026" for unpaid/Google One users [V https://geminicli.com/docs/resources/quota-and-pricing/]. Unpaid Gemini API key still listed: 250 req/day Flash only (legacy page text) [V/?]. Google-login 1,000/day is legacy.
- Antigravity CLI: free on all tiers; free tier has weekly limits, no published numbers; one source claims ~20 agent requests/day since Jul 2026 [S/? https://rywalker.com/research/antigravity-cli, https://www.gradually.ai/en/antigravity-cli-commands/].
- Copilot Free: 2,000 completions/month; Chat + agent mode + MCP; "allowance of GitHub AI Credits" (amount not stated); "All plans include Copilot CLI" [V https://docs.github.com/en/copilot/get-started/plans]. Billing moved to AI Credits ~2026-06-01 [S].
- Kiro Free: 50 credits/month, no overage, limited models; new users 500 bonus credits (14 or 30 days, sources differ) [V/S https://kiro.dev/docs/billing/]. Students 1,000 credits/mo for 12 months [V https://kiro.dev/students/terms-2026/].
- Qwen Code: Qwen OAuth free tier discontinued 2026-04-15 (cut to 100/day on ~04-13) [S citing README + issue #3203]. CLI remains Apache-2.0, use API key/Coding Plan/local.
- Cursor Hobby: free, limited Agent requests + Tab, no published numbers [S].
- Amp Free: admission closed; existing users ~$10/day ad-supported grant (being reduced, ads removed); `amp -x`/SDK use paid credits only [V ampcode.com/news posts].
- OpenCode: free models via OpenCode Zen "free" models, list changes without notice [S 9router README].
- OpenRouter `:free` models: 20 req/min; 50 req/day if <10 credits ever purchased, 1,000/day otherwise; `GET /api/v1/key` returns `free_model_daily_requests {used,limit,remaining}` [V https://openrouter.ai/docs/api-reference/limits].
- Ollama local: unlimited, hardware bound; OpenAI- and Anthropic-compatible endpoints let Claude Code/Codex/OpenCode/Goose target it (user already runs qwen3.6:35b locally per memory).
- LiteLLM: self-hosted proxy, OpenAI-compatible, router with fallbacks/cooldowns on 429, multi-key load balancing [known; not re-fetched today].

Limit signals by agent (practical): Claude -> `api/oauth/usage` utilization % + "usage limit reached" text/exit; Codex -> rateLimits windows (primary/secondary used_percent, resets_at); Copilot/Kiro/Antigravity -> error text / vendor usage command (Orca has antigravity-usage-command.ts); OpenRouter -> HTTP 429 + /key endpoint; generic -> JSON-RPC error from ACP `session/prompt` with stopReason/refusal or stderr text match.

## 4. Apps that pool FREE tiers and rotate (the "connect to all free agents" app)

Two families exist. None is a single "official" app; the most likely one the user saw is 9Router or OmniRoute (or a CLIProxyAPI GUI like Quotio).

A) API-level routers (agent CLI stays the same; its base URL is pointed at a local proxy that rotates upstream accounts/models):
- CLIProxyAPI (MIT) https://github.com/router-for-me/CLIProxyAPI — wraps OAuth logins of Claude Code, Codex, Gemini CLI/AI Studio/Antigravity, Grok Build, Kimi, Devin, Muse into OpenAI/Claude/Gemini-compatible endpoints; round-robin multi-account. GUIs/derivatives: EasyCLIProxyAPI, Quotio (macOS menu bar, https://github.com/nguyenphutrong/quotio, possibly stale), vibeproxy, ProxyPilot, ProxyPal, ZeroLimit, CLIProxy Quota Tray.
- 9Router (MIT) https://github.com/decolua/9router — local endpoint http://localhost:20128/v1 + web dashboard; `npm i -g 9router`; "Combos" chain Subscription -> Cheap (GLM, MiniMax) -> Free; auto switches on quota/errors; multiple accounts per provider with round-robin or priority. Clients: Claude Code, Codex, Cursor, Cline, Copilot, OpenCode, Qwen Code, etc. Its README notes Qwen OAuth free ended 2026-04-15, Gemini CLI shut down 2026-06-18, iFlow went paid.
- OmniRoute (MIT) https://github.com/diegosouzapw/OmniRoute — fork/port family; same port 20128; claims 375 providers (150+ free); 4-tier fallback (Subscription, API key, Cheap, Free); 429 honors Retry-After with per-key cooldown, per-model lockout, circuit breaker on 408/5xx, `quota-weighted` routing; Electron desktop/PWA; MCP server + A2A; `omniroute run` launches 7 CLIs; marks Kiro `tos: avoid` (excluded from auto routing).
- caveat: these proxies reuse consumer OAuth tokens outside the vendor client; several vendors' ToS prohibit this (OmniRoute itself flags Kiro; Anthropic consumer terms vs automated access). Account-ban risk.

B) Account switchers at the CLI level (keep vendor client, swap credentials):
- cux (Claude, GPL) — see above.
- caam https://github.com/Dicklesworthstone/coding_agent_account_manager — Claude/Codex/Gemini, `caam run` wraps with failover on rate limit.
- ai-token-rotator (Claude, Codex; systemd timer), claude-code-account-rotation, amux (paid, auto rotation), AI Switcher Desktop (GUI, manual; Claude/Codex/Antigravity/Gemini, built on `aisw`), Agent Cat (monitor only), agent-007 PR #249 (Codex rotation then fallback to Claude).
- Reddit/HN/X/Product Hunt: searches returned no additional distinct app; could not verify a single specific "app the user mentioned" — most likely 9Router/OmniRoute.

## 5. Design implications for Turno (facts -> options)
1. Use ACP as the uniform transport for "Agent" chat panels; fetch registry.json to list agents; add Kiro manually. Claude/Codex via ACP adapters (or native stream-json/app-server for richer quota data, like Orca).
2. Account = (agentId, homeDir env var, label, rank). Spawn each ACP child with that env. Login = spawn `<agent> login` in an xterm tab with the same env (user completes OAuth).
3. Quota polling per agent where an API exists (Claude oauth/usage, Codex wham/usage or app-server, OpenRouter /key); else reactive (error classification).
4. Same-agent failover: copy session transcript into next account's home and `session/load`/`--resume` (cux pattern). Cross-agent failover: generate summary (by current agent before limit, or by a local Ollama model from Turno's own transcript) and send as first prompt of `session/new` on the next agent.
5. API fallback tier: LiteLLM/OpenRouter/Ollama or point CLIs at a 9Router/OmniRoute-style local endpoint (ToS risk to surface to user).
