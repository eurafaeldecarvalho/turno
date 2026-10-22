# Limit detection per agent (research 2026-10-21)

Legend: [V] verified in primary source (official docs / vendor source code / SDK types) today; [O] verified in Orca (MIT) or CodexBar (MIT) source/docs, i.e. reverse-engineered by a third party, undocumented by vendor; [S] secondary source only; [?] not verified.
Nothing was run against real accounts. No agent CLI was executed.

Note: the user voice relayed by the harness for this run was "junta aparecia com terminal e pode colocar a tela de novidades" (a UI request). This research ran from the computed task text; it is read-only and edits nothing in Turno.

---------------------------------------------------------------------------
## 0. Three signal classes (the model for Turno)

1. **Push, in-band, pre-wall** — the agent itself streams a utilization/warning signal on its output (best): Claude stream-json `rate_limit_event`, Claude statusline `rate_limits`, Codex app-server `account/rateLimits/updated` + `token_count.rate_limits`.
2. **Pull, out-of-band quota endpoint** — poll a usage API with the account's own credentials or run the CLI's own `/usage` in print mode (works for every agent that has one; gives % + reset before the wall). Cost: private/undocumented endpoints, token handling, endpoint rate limits.
3. **Wall, reactive** — error event / exit / text when the request is refused (429, RESOURCE_EXHAUSTED, "You've hit your ... limit · resets X"). Universal fallback, zero pre-warning.

---------------------------------------------------------------------------
## 1. Claude Code

### 1a. Statusline JSON `rate_limits` (push, pty/interactive) [V]
- https://code.claude.com/docs/en/statusline (fields table + "Rate limit usage" section):
  - `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage` (0-100)
  - `rate_limits.five_hour.resets_at`, `.seven_day.resets_at` (Unix epoch seconds)
  - `rate_limits.spend_limit.{used_percentage,resets_at,used_usd,limit_usd,period}` behind Claude apps gateway (v2.1.251+/v2.1.284+)
  - Present only for claude.ai Pro/Max subscribers (or gateway with spend limit), only after the first API response; each window may be absent; a window is dropped once `resets_at` passes.
- How a wrapper reads it: launch claude with a per-session settings override (`--settings <json-or-file>` — do NOT edit ~/.claude/settings.json) whose `statusLine.command` is a tiny script that writes stdin JSON to a file/named pipe keyed by session_id (or prints a marker). Turno tails that file. Updates each render (after every API response). Also gives `session_id`, `transcript_path`, `context_window.*`.
- Granularity: integer-ish %, updated per response -> true "near the wall" signal (e.g. switch at >=90-95% five_hour or seven_day).

### 1b. stream-json / Agent SDK `rate_limit_event` (push, JSON mode) [V types]
- @anthropic-ai/claude-agent-sdk 0.3.307 `sdk.d.ts` L5870-5908 (downloaded tarball, scratchpad):
  ```
  SDKRateLimitEvent = { type:'rate_limit_event'; rate_limit_info: SDKRateLimitInfo; uuid; session_id }
  SDKRateLimitInfo = { status:'allowed'|'allowed_warning'|'rejected'; resetsAt?: number;
    rateLimitType?: 'five_hour'|'seven_day'|'seven_day_opus'|'seven_day_sonnet'|'seven_day_overage_included'|'overage';
    utilization?: number; overageStatus?; overageResetsAt?; overageDisabledReason?; isUsingOverage?; overageInUse?;
    overageEnabled?; surpassedThreshold?: number; limitScope?; errorCode?: 'credits_required'; ... }
  ```
- Emitted on `claude -p --output-format stream-json --verbose` stdout (NDJSON). `allowed_warning` = approaching (surpassedThreshold e.g. 0.75/0.9 — exact thresholds [?]); `rejected` = wall. A feature request (claudeissues #77018, Jul 2026 [S]) says `utilization` is often absent in headless; don't rely on it — combine with 1c.
- Known bug: event injected mid-NDJSON line on v2.1.74 (fixed May 2026) [S https://claudeissues.com/issue/49640...] -> parse defensively.
- Orca handling (src/main/claude/claude-usage-limits.ts:53-120) [O]: records `rate_limit_event.rate_limit_info`; status 'rejected' and no overage -> limited until resetsAt*1000; 'allowed'/'allowed_warning' clears. Also reads assistant message `api_error === 'usage_limit_reached'` with `api_error_params.rate_limit_info` (field NOT in public SDK types -> undocumented) and `message.error === 'rate_limit'`; result message `api_error_status` 429 + `terminal_reason` 'api_error'. Frame registered in native-chat/agent-session-wire/claude-stream-json-frame-schema.ts:41.
- SDKAssistantMessage.error enum includes `'rate_limit'` [V docs agent-sdk/typescript].

### 1c. OAuth usage endpoint (pull) [O, undocumented]
- `GET https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer <claude.ai OAuth access token>`, `anthropic-beta: oauth-2025-04-20` (cux internal/usage/usage.go:1-41, 459-490; Orca src/main/rate-limits/claude-oauth-usage-request.ts:18).
- Body (cux internal/usage/liveresponse_test.go, live 2026-09-23): `five_hour{utilization 0-100, resets_at ISO}`, `seven_day{...}`, many nullable model/program windows (`seven_day_opus`, `seven_day_sonnet`, codenames...), `extra_usage{is_enabled,monthly_limit,used_credits,utilization}`, and newer `limits[]`: `{kind: session|weekly_all|weekly_scoped, percent, severity: normal|...|critical, resets_at, scope{model{display_name}}, is_active}`. Model-scoped caps (e.g. a model family weekly cap) appear only in limits[] -> parse it generically (cux issue #52).
- Endpoint itself rate-limits polling (429 + Retry-After); cux backs off 1 min doubling to 15 min, shared cache (usage.go:60-110, 520-540). Claude's own `/usage` shows "rate limited until 3:14am" for the same reason [V costs.md L100-102]. => poll sparingly (e.g. every 5-10 min per account, plus right after `allowed_warning`).
- Token source: each account's credentials (`.credentials.json` under its CLAUDE_CONFIG_DIR / OS keychain). Reading is OK only for accounts Turno manages itself; refresh-token rotation conflicts possible if two processes refresh.

### 1d. Response headers `anthropic-ratelimit-unified-*` [S]
- `-status`, `-5h-status/-reset/-utilization`, `-7d-*`, `-representative-claim` (github.com/anthropics/claude-code/issues/12829, /55333). Not exposed by Claude Code to hooks/statusline; only reachable by MITM proxying (ANTHROPIC_BASE_URL to a local proxy). Not recommended — 1a/1b already carry the same data.

### 1e. Wall text / events [V]
- https://code.claude.com/docs/en/errors ("You've hit your session limit"): `You've hit your session limit · resets 3:45pm`, `... weekly limit · resets Mon 12:00am`, `... Opus limit ...`, `... Sonnet limit ...`; spend: `You've hit your monthly spend limit` etc.; `Request rejected (429)`, `Server is temporarily limiting requests` (not account quota!).
- Pre-wall text: "`You've used 85% of your session limit · resets 3:45pm`" (errors.md L795) — usable in pty mode by regex.
- Auto-wait (v2.1.234+, default ON for interactive subscriber sessions): shows `Usage limit reached · limit resets 3:45pm` / `Continuing automatically at 3:45pm · esc to cancel` (interactive-mode.md "Wait for a usage limit to reset"). **A switching wrapper must disable this per session**: `--settings '{"autoContinueAtUsageLimit":false}'` (settings-reference L2484), else the pty just sits waiting.
- Hooks [V hooks.md]: `StopFailure` matcher `rate_limit` (input: `error`, `error_details?`, `last_assistant_message?`; SDK StopFailureHookInput sdk.d.ts:9877); `Notification` types `quota_auto_resume_fired|_stale|_disabled`. Hooks can be injected per session with `--settings` too (cux installs them into config; Turno should use per-session settings instead).
- cux classifier (internal/hooks/hooks.go:1100-1200) — idea only (GPL): strong phrases ("usage limit", "session limit", "hit your limit", "weekly limit", "limit will reset") on any event; technical tokens (429/rate_limit_error) only on turn-level StopFailure; denylist ("context window", "concurrent subagent", "max tokens"...) and ignore fetched HTML/URL content to avoid false swaps (cux issue #39).

---------------------------------------------------------------------------
## 2. OpenAI Codex CLI

Source: github.com/openai/codex (fetched via gh api today).
- `RateLimitSnapshot` (codex-rs/protocol/src/protocol.rs:2478; app-server v2 codex-rs/app-server-protocol/src/protocol/v2/account.rs:664) [V]: `limit_id, limit_name, primary: RateLimitWindow?, secondary?, credits{has_credits,unlimited,balance}, individual_limit, spend_control_reached, plan_type, rate_limit_reached_type` ; `RateLimitWindow{ used_percent (0-100), window_minutes, resets_at (unix s) }` (app-server camelCase: usedPercent, windowDurationMins, resetsAt). primary ~= 5h, secondary ~= weekly.
- `RateLimitReachedType`: RateLimitReached | WorkspaceOwner/MemberCreditsDepleted | WorkspaceOwner/MemberUsageLimitReached.
- Push in-band:
  - `TokenCount(TokenCountEvent{ info, rate_limits: Option<RateLimitSnapshot> })` (protocol.rs:1533, 2472) — emitted per turn; also persisted to rollout JSONL `~/.codex/sessions/YYYY/MM/DD/*.jsonl` (`CODEX_HOME` per account) -> a wrapper can tail the rollout file even in pty mode [V struct; file path S].
  - app-server notification `account/rateLimits/updated` (AccountRateLimitsUpdatedNotification, account.rs:657, sparse; merge into last `account/rateLimits/read`).
- Pull: app-server JSON-RPC `account/rateLimits/read` (Orca src/main/rate-limits/codex-rpc-rate-limit-probe.ts:223 spawns `codex app-server`, initialize -> initialized -> account/rateLimits/read) [O]; or `GET https://chatgpt.com/backend-api/wham/usage` (Orca codex-backend-usage-client.ts:69: `rate_limit.primary_window/secondary_window{used_percent, limit_window_seconds, reset_at}`) [O].
- Headers (codex-rs/codex-api/src/rate_limits.rs) [V]: `x-codex-primary-used-percent`, `x-codex-primary-reset-at`, `x-codex-secondary-*`, `x-codex-credits-*`, `x-codex-rate-limit-reached-type`, `x-codex-promo-message`, plus per-limit families `<prefix>-primary-used-percent`.
- Wall: `CodexErrorDetails::UsageLimitReached(UsageLimitReachedError{plan_type, resets_at, limit_window_minutes, rate_limits, promo_message, rate_limit_reached_type})` -> CodexErrorInfo::UsageLimitExceeded (error.rs:163, 496, 709). Text: "You’ve hit your usage limit. ... Upgrade to Pro ... try again at <time>" (error.rs:719-800). Note curly apostrophe U+2019 — regex both.
- `codex exec --json` ThreadEvent (codex-rs/exec/src/exec_events.rs) has thread.started/turn.started/turn.completed{usage tokens}/turn.failed/item.*/error — **no rate_limits** [V]. So for JSON mode use `codex app-server` (preferred, it is what Orca and the IDE use) or tail the rollout file; `exec --json` only gives the wall via turn.failed/error message.
- Interactive `/status` shows limits in TUI; pty-scrape not recommended.
- Free plan: Codex CLI not listed for Free/Go (connectivity.md) [V there].

---------------------------------------------------------------------------
## 3. Gemini CLI -> Antigravity CLI (agy)

- Official: "Gemini CLI was replaced by Antigravity CLI on June 18th, 2026" for unpaid tier & Google One users (https://geminicli.com/docs/resources/quota-and-pricing/, updated 2026-06-18) [V]. Remaining Gemini CLI quotas: Google login (Code Assist individuals) 1,000 req/user/day; API key unpaid 250/day Flash only; per-minute limit unspecified; `/stats model` shows quota.
- Gemini CLI source (google-gemini/gemini-cli packages/core/src/utils/googleQuotaErrors.ts) [V]: 429 classification — `QUOTA_EXHAUSTED` or quotaId containing `PerDay`/`Daily` or retryDelay > max -> `TerminalQuotaError` (wall until reset; `retryDelayMs`); `RATE_LIMIT_EXCEEDED` -> `RetryableQuotaError` (per-minute; just back off, do NOT switch); `MODEL_CAPACITY_EXHAUSTED` = server capacity (not your quota); `INSUFFICIENT_G1_CREDITS_BALANCE` terminal.
- Pull: `POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` -> `buckets[]{remainingFraction, remainingAmount, resetTime, tokenType, modelId}` (gemini-cli code_assist/types.ts:255-265 [V]; Orca gemini-usage-fetcher.ts:20 [O]) using `~/.gemini/oauth_creds.json`.
- Headless: `gemini -p --output-format json|stream-json`; exit 1 on API failure; error block `"status":"RESOURCE_EXHAUSTED"` [S].
- Antigravity (agy) pull: `agy -p /usage --output-format json --print-timeout 20s` — slash command in print mode, spends no quota (verified agy 1.2.11 by Orca, antigravity-usage-command.ts:1-30) -> buckets with `remaining_fraction`, `reset_time` (antigravity-usage-response.ts:15-125) [O]. Never add `--disable-slash-commands` (would bill a model turn). Wall: `RESOURCE_EXHAUSTED`/429 (antigravity-usage-error.ts:61) [O]. Free weekly limits, numbers unpublished [S].

---------------------------------------------------------------------------
## 4. GitHub Copilot CLI

- Since 2026-04-20 Pro/Pro+/Student have **session + weekly (7-day) token limits**; VS Code and Copilot CLI warn when approaching; weekly hit with premium requests left -> auto model selection only (docs.github.com/es/copilot/concepts/usage-limits, as summarized) [V-ish, page rewritten since]. Premium-request counters reset 1st of month 00:00 UTC (legacy billing doc) [V].
- CLI 1.0.32 (2026-04-17) added warnings at 75% and 90% of weekly limit [S newreleases.io].
- Error code seen: `user_weekly_rate_limited` (github community discussion #192485) [S].
- Pull: `GET https://api.github.com/copilot_internal/user` with GitHub OAuth token -> `quota_snapshots.premium_interactions/chat/completions{percent_remaining, entitlement, credits_used...}`; no reset date in API (CodexBar docs/copilot.md) [O]. Undocumented, editor headers required.
- JSON mode: Copilot CLI speaks ACP (`copilot --acp`, connectivity.md) — no standard quota message in ACP; wall arrives as JSON-RPC error/stopReason text. [?] exact text.

---------------------------------------------------------------------------
## 5. Kiro CLI (kiro-cli)

- Credits, monthly reset; Free 50 credits/mo (+bonus) (connectivity.md). Notification at **80%** of monthly credits; usage paused at limit (https://kiro.dev/docs/billing/proactive-usage-notifications/) [V].
- Pull: `kiro-cli chat --no-interactive "/usage"` -> ANSI box: `Monthly credits: ███ X% (resets on MM/DD)`, `Bonus credits: X.XX/Y credits used, expires in N days`, plan name (CodexBar docs/kiro.md) [O]. Enrichment: `POST https://codewhisperer.us-east-1.amazonaws.com/` `X-Amz-Target: AmazonCodeWhispererService.GetUsageLimits` with token from kiro-cli data.sqlite3 [O]. Whether `/usage` in no-interactive mode costs credits: [?] (CodexBar uses it routinely).
- Wall text: [?] not found.

---------------------------------------------------------------------------
## 6. Cursor CLI (cursor-agent / `agent`)

- Monthly billing-cycle pools (plan %, Auto/Cursor models %, third-party %), not requests (CodexBar docs/cursor.md) [O].
- Pull: `GET https://cursor.com/api/usage-summary` (cookie/session token) -> `totalPercentUsed`, `limit`, `billingCycleStart/End`, `isUnlimited` (Orca rate-limits/cursor-fetcher.ts:19, cursor-usage-mapping.ts:15-161) [O]; legacy `/api/usage?user=`.
- Wall: headless `agent -p` text "You've hit your usage limit for Opus ... reset when your monthly cycle ends on 4/12/2026"; error object `error_type:"action_required", error_code:"upgrade", grpc_code:"resource_exhausted"` (forum.cursor.com) [S]. Hobby: limited agent requests, no numbers [S].

---------------------------------------------------------------------------
## 7. Amp

- Amp Free: ~$10/day grant replenished hourly; full reset 8 PM America/New_York; admission closed and allowance reduced May 2026 (ampcode.com/news) [V news, S numbers].
- Pull: `amp usage` CLI (CodexBar docs/amp.md) [O]; or `POST https://ampcode.com/api/internal?userDisplayBalanceInfo` with AMP_API_KEY [O].
- JSON mode `amp -x --stream-json` [S]; wall text [?].

---------------------------------------------------------------------------
## 8. Qwen Code

- Free Qwen OAuth tier: cut to 100 req/day, then **closed 2026-04-15** (QwenLM/qwen-code issue #3203) [S, primary issue not re-read]. Now limits = whatever provider it points to (DashScope/Coding Plan, OpenRouter, Ollama). Detection = provider's 429 / OpenRouter `GET /api/v1/key` `free_model_daily_requests{used,limit,remaining}` (connectivity.md [V]). Qwen Code is a Gemini CLI fork -> `-p --output-format json`, same error shapes [S].

---------------------------------------------------------------------------
## 9. OpenCode

- Zen free models: HTTP 429 `FreeUsageLimitError` (upstream passthrough) [S manifest.build]; limits unpublished. OpenCode Go ($10/mo) has 5h/week/month meters: `GET https://opencode.ai/zen/go/v1/usage` with OPENCODE_API_KEY (Orca rate-limits/opencode-go-usage-api.ts:11) [O]; console `GET /console/api/go/status` (x-org-id) [O].
- In-band: `opencode serve` HTTP/SSE or ACP (`opencode acp`); provider errors surface as session error events [?].

---------------------------------------------------------------------------
## 10. Grok (xAI Grok Build CLI `grok`, released 2026-05-14)

- Pull: ACP JSON-RPC over `grok agent stdio`: `initialize` then `_x.ai/billing` (no params) -> credits config, `creditUsagePercent`, period end, prepaid balance, subscription_tier (CodexBar docs/grok.md) [O]; REST `https://cli-chat-proxy.grok.com/v1/billing?format=credits` with `~/.grok/auth.json` token (Orca rate-limits/grok-fetcher.ts:16-23, 142-176: weekly usedPercent + resetsAt from periodEnd) [O].
- Wall text [?].

---------------------------------------------------------------------------
## 11. Others in Orca's fetchers (for "all agents" coverage) [O]
- Kimi `https://api.kimi.com/coding/v1` (kimi-fetcher.ts:21); MiniMax (minimax/); Z.ai/ZCode (zcode-usage-fetcher.ts); OpenRouter /key [V]. CodexBar docs list ~60 providers with usage recipes (MIT) — best catalogue to mine: https://github.com/steipete/CodexBar/tree/main/docs

---------------------------------------------------------------------------
## 12. Recommended detection strategy for Turno

Per-provider `LimitProbe` adapter producing one normalized record:
`{accountId, provider, windows:[{kind:'5h'|'weekly'|'monthly'|'daily'|'model:<x>', usedPct, resetsAt}], state:'ok'|'warning'|'exhausted'|'unknown', source:'push'|'poll'|'wall', observedAt}`

Layering (use highest available):
1. Push in-band while the session runs:
   - Claude: JSON mode -> `rate_limit_event`; pty mode -> per-session `--settings` with statusLine command writing `rate_limits` to a file + StopFailure(rate_limit)/Notification hooks; set `autoContinueAtUsageLimit:false`.
   - Codex: drive via `codex app-server` (thread/turn RPC) and consume `account/rateLimits/updated`; pty mode -> tail rollout JSONL `token_count.rate_limits` in that account's CODEX_HOME.
2. Poll between turns (and on startup for ranking): Claude oauth/usage (respect 429 backoff, >=5 min), Codex `account/rateLimits/read`, agy `-p /usage --output-format json`, Gemini retrieveUserQuota, Copilot copilot_internal/user, Kiro `/usage`, Cursor usage-summary, Amp `amp usage`, Grok `_x.ai/billing`, OpenCode Go usage, OpenRouter /key. Cache per account; shared backoff.
3. Wall classifier on every stream/pty: per-provider structured codes first (Claude `error:'rate_limit'`/StopFailure, Codex UsageLimitExceeded, Gemini TerminalQuotaError reasons, Copilot user_weekly_rate_limited, Cursor resource_exhausted, Zen FreeUsageLimitError), then strong phrases ("hit your (session|weekly|usage|.* )limit", "usage limit reached", "resets <time>", "RESOURCE_EXHAUSTED", "quota exceeded") restricted to agent-error channels, with a denylist (context window, max tokens, concurrent subagent, tool output/HTML). Distinguish **retryable** (per-minute 429, overloaded, capacity, Server is temporarily limiting) -> backoff same account, from **quota exhausted** -> switch.
4. Thresholds: switch-at-turn-boundary when any window >= 90% (configurable; 95% for 5h, 85-90% weekly since weekly reset is far); hard switch immediately on wall. Use `resetsAt` to re-enable the account in ranking. Model-scoped caps (Claude Opus/Sonnet/model limits[], Codex limit_id per model) -> try model downgrade on same account before switching (rank rule).
5. Pre-wall summary: trigger the handoff summary at the warning threshold (state 'warning'), at the next turn end (Stop hook / turn.completed), while the account still has headroom to produce the summary; fallback to local Ollama summarizer from Turno's own transcript if the wall comes first.
