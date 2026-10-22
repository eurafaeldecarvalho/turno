# Compliance / ToS / security / reliability research: multi-account + multi-agent rotation (Oct 21 2026)

Scope: risks of the "Agent" button design for Turno: (1) pooling several paid accounts of the SAME provider and auto-rotating at limits; (2) cycling FREE tiers across many providers; (3) storing many OAuth tokens locally (Electron safeStorage/DPAPI); (4) abuse detection and bans caused by automated switching. Ends with a recommended safe design.
Legend: [V] verified from a primary source (policy text, official docs, or local source code); [S] secondary (press, blogs, forums); [U] unverified or my inference. This is not legal advice.

---

## 0. TL;DR verdict table

| Pattern | Anthropic (Pro/Max, Claude Code) | OpenAI (ChatGPT/Codex) | Google (Antigravity/Gemini CLI, Gemini API) | GitHub Copilot | AWS Kiro |
|---|---|---|---|---|---|
| Owning >1 paid account yourself | GRAY-OK: no clause forbids it; staff said "not against ToS" [S citing staff X post] | GRAY: no clause found | GRAY | Paid: GRAY. Free: PROHIBITED (one free account per person) [V] | UNKNOWN (no clause found) |
| Auto-rotating accounts to keep working past a per-account limit | GRAY to RISKY: "bypassing ... protective measures" [V], AUP "bypass ... restrictions" [V], "limits assume ordinary, individual usage" [V]; ban wave Feb 2026 hit multi-Max holders [S] | RISKY/likely PROHIBITED: "circumvent any rate limits or restrictions" [V] | RISKY: Google APIs ToS "will not attempt to circumvent" limits [V] | RISKY: GitHub warnings cite "multi-account workarounds" [S] | RISKY: 429 "suspicious activity" throttles reported [S] |
| A third-party app storing/refreshing the CLI's OAuth tokens or calling the backend with them | PROHIBITED for developers: "may not collect, store, or intermediate Claude.ai credentials or session tokens" [V] | Not stated; treat auth.json "like a password" [V] | PROHIBITED: third-party access with Gemini CLI OAuth "is a violation" [V] | Proxies get warnings and suspensions [S] | Proxy routers flag Kiro "tos: avoid" [S] |
| Launching the UNMODIFIED vendor CLI, which the user logged into, in a terminal | ALLOWED [V] | ALLOWED [V] | ALLOWED | ALLOWED | ALLOWED |
| Creating many FREE accounts to cycle free quotas | PROHIBITED: AUP "create multiple accounts to avoid detection", "automation in account creation" [V] | PROHIBITED (circumvention) [V] | PROHIBITED (circumvention) [V] | PROHIBITED: one free account [V] | UNKNOWN/RISKY |
| Using ONE free tier per provider, each in its own CLI, with cross-provider fallback | ALLOWED (each used as offered) [U: inference] | ALLOWED | ALLOWED (unpaid data used for training [V]) | ALLOWED | ALLOWED |
| API keys (pay-as-you-go) with automation and fallback | ALLOWED, explicitly exempt from the automation clause [V] | ALLOWED (API terms) | ALLOWED | n/a | n/a |

---

## 1. Same-provider pooling of paid accounts + auto-rotation

### Anthropic (Claude Pro/Max, Claude Code)
Primary text:
- Consumer Terms (effective Oct 8 2025), https://www.anthropic.com/legal/consumer-terms [V]:
  - §2: "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else." The terms also forbid making your Account available to anyone else.
  - §3(7): you may not "access the Services through automated or non-human means, whether through a bot, script, or otherwise", "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it".
  - §3: no interference, including "bypassing any of our systems or protective measures".
  - The terms contain NO express clause on multiple accounts and NO express usage-limit clause.
  - §12: Anthropic may "suspend or terminate your access ... at any time without notice", and there is no refund on a breach.
- Usage Policy, https://www.anthropic.com/legal/aup [V]. The fetched page shows "Effective Nov 12 2026", which is a future date, so this may be an announced upcoming version.
  - "Intentionally bypass or interfere with capabilities, restrictions, or guardrails established within our products"
  - "Coordinate malicious activity across multiple accounts, or create multiple accounts, to avoid detection"
  - "Utilize automation in account creation"
  - "Circumvent a ban through the use of a different account"
  - "Resell, proxy, or otherwise provide access to Claude through unauthorized means"
  - Enforcement may be "warn ... throttle, limit, suspend, or terminate". The policy also notes "encountering a block does not by itself indicate a violation".
- Claude Code Legal & compliance, https://code.claude.com/docs/en/legal-and-compliance [V]:
  - "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
  - OAuth "is designed to support ordinary use of Claude Code and other native Anthropic applications."
  - "developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
  - "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users."
  - The doc does NOT prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription".
  - "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."
- Phone verification: at most 3 Claude accounts per phone number. https://support.claude.com/en/articles/8287232 [S via search snippet of an official help page]

Enforcement history:
- 2025-07-28 @AnthropicAI: weekly limits were introduced, and a small number of users were "sharing and reselling accounts". https://x.com/AnthropicAI/status/1949898513019466140 [S, cited by metricnexus]
- Jan 2026: Anthropic tightened safeguards against "spoofing the Claude Code harness" after third-party harnesses (OpenCode, OpenClaw) using subscription OAuth tripped abuse filters (Thariq Shihipar, Anthropic). https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/ [S] Quote: third-party harnesses "generate unusual traffic patterns without any of the usual telemetry that the Claude Code harness provides".
- Feb 18-20 2026: users holding multiple Max accounts reported bans [S].
  - Thariq on X: "It's not against terms of service to have multiple MAX accounts" (https://x.com/trq212/status/2024230184287949207). He called the legal-page change "a docs clean up" and said "We want to encourage local development and experimentation with the Agent SDK and claude -p" (https://x.com/trq212/status/2024212378402095389). [S: quoted by https://piunikaweb.com/2026/02/19/anthropic-claude-max-ban-agent-sdk-clarification/. X itself was not fetched.]
  - An unnamed representative reportedly admitted that some bans came from automated abuse filters and were being reversed. [S] https://metricnexus.ai/blog/anthropic-banning-multiple-claude-accounts
- 2026-04-04: third-party harnesses (OpenClaw first, "applies to all third-party harnesses") moved off subscription limits to separately billed pay-as-you-go "extra usage". https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/ [S]
- Reported heuristics (speculative; Anthropic has not confirmed them) [S]: multiple accounts sharing IP, device, or payment; 24/7 autonomous loops that look like resale; prior third-party harness use; false positives.

Assessment:
- OWNING several Pro/Max accounts: gray-OK. No clause forbids it, and a staff statement says it is allowed [S].
- RUNNING them through unmodified Claude Code, each logged in by the user in its own CLAUDE_CONFIG_DIR: allowed. This is "ordinary use of Claude Code".
- AUTOMATIC rotation for the explicit purpose of exceeding a single account's 5h/7d limit: GRAY to RISKY.
  - No clause names it.
  - But "limits assume ordinary, individual usage", the "bypassing ... protective measures" language, and the AUP's "bypass ... restrictions ... established within our products" give Anthropic a textual basis to act.
  - Combined usage across N accounts from one device/IP is exactly the pattern reported in the Feb 2026 wave. [U: inference]
- Tooling like cux that rewrites `~/.claude/.credentials.json`, refreshes tokens itself, and polls the backend:
  - It rewrites the live credential blob in place (`C:\rx\cux\internal\creds\creds.go:1-25`, file backend on Windows :721).
  - It refreshes tokens itself against `https://platform.claude.com/v1/oauth/token` using Claude Code's public client_id (`creds.go:77-79, 439`).
  - It polls the undocumented `https://api.anthropic.com/api/oauth/usage` (`C:\rx\cux\internal\usage\usage.go:2,36`).
  - Doing token refresh outside Claude Code = "store, or intermediate Claude.ai credentials or session tokens". That clause targets "developers ... on behalf of their users". For a personal tool it is gray. For a distributed app like Turno, it is squarely what the doc forbids. [U: interpretation]
  - cux is GPL-3.0: ideas only.
- Orca (MIT) does NOT auto-rotate:
  - Each account is a separate CLAUDE_CONFIG_DIR profile, logged in through the real CLI (`C:\rx\orca\src\main\claude-accounts\claude-login-session.ts`, `claude-profile-*`).
  - It reads the keychain only to detect state (`claude-accounts\keychain.ts:8-21`).
  - It polls the same usage URL for display (`src\main\rate-limits\claude-oauth-usage-request.ts:18`).
  - Manual switching. This is the lower-risk reference.
- First-party limit signal (no token handling needed): the Claude Code status line JSON includes `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage`, and `.resets_at` (epoch s). https://code.claude.com/docs/en/statusline [V] A status-line script configured per profile can write these to a file that Turno watches. Prefer this over calling `api/oauth/usage`, which is undocumented and may be rate-limited or changed. [U]

### OpenAI (ChatGPT plans / Codex)
- Terms of Use, effective Jan 1 2026 (ROW). https://openai.com/policies/row-terms-of-use/ fetched via r.jina.ai [V]:
  - "You may not share your account credentials or make your account available to anyone else."
  - Prohibited: interfering, including "circumvent any rate limits or restrictions or bypass any protective measures or safety mitigations".
  - Prohibited: "Automatically or programmatically extract data or Output".
  - OpenAI may suspend or terminate on breach.
  - The US terms page returned 403 to direct fetch. A tracker (conductatlas) shows the same "circumvent any rate limits" language in the US Terms (May 2026). [S]
- Codex limits are per plan/subscription. An OpenAI staffer on GitHub discussion #2251 confirms "subscription limits". https://github.com/openai/codex/discussions/2251 [S] Some users openly rotate 3-5 accounts (community.openai.com threads) [S]. I found NO public OpenAI enforcement report specific to Codex multi-account rotation [U].
- Codex auth https://developers.openai.com/codex/auth [V]:
  - Credentials live in `~/.codex/auth.json` (plaintext) or the OS keyring via `cli_auth_credentials_store = file|keyring|auto|ephemeral`.
  - "treat ~/.codex/auth.json like a password".
  - Copying auth.json to a headless box is documented.
  - API keys are recommended for automation.
- Technical blocker: encrypted reasoning is bound to the org. Resuming across accounts fails with `invalid_encrypted_content ... organization_id did not match` (see handoff.md). Even where rotation is tolerated, native resume is unreliable.
- Assessment: rotating ChatGPT accounts to keep going past Codex limits matches "circumvent any rate limits or restrictions" more directly than Anthropic's text does. PROHIBITED on a plain reading. RISKY in practice.

### Google (Antigravity CLI / Gemini CLI / Gemini API)
- Gemini CLI ToS page https://geminicli.com/docs/resources/tos-privacy/ [V]:
  - "Directly accessing the services powering Gemini CLI ... using third-party software, tools, or services (for example, using OpenClaw with Gemini CLI OAuth) is a violation of applicable terms and policies. Such actions may be grounds for suspension or termination of your account."
  - Terms by auth type: Google ToS (+ Google One Additional Terms for AI Pro/Ultra); Gemini API ToS for API keys; GCP terms for Vertex.
- Google APIs Terms §2.d (last modified Nov 9 2021) https://developers.google.com/terms [V]: you "will not attempt to circumvent" documented API limits. §2.c: "will not misrepresent or mask either your identity or your API Client's identity."
- Gemini API Additional Terms (effective Mar 23 2026) https://ai.google.dev/gemini-api/terms [V]:
  - "Unpaid Services" content is used "to provide, improve, and develop" products.
  - "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
  - The terms are for professional/business developers.
- Enforcement [S]:
  - Feb 2026: mass "403 ToS violation" disables of Antigravity / Gemini Code Assist for users who plugged Antigravity OAuth into OpenClaw/OpenCode, including $250/mo Ultra subscribers.
  - A reported blanket unban on ~Feb 27 2026 (single blog; https://metricnexus.ai/blog/google-banning-openclaw-antigravity-users).
  - Appeal threads continued through July 2026 (https://discuss.ai.google.dev/t/antigravity-gemini-code-assist-access-suspended-403-tos-violation-requesting-help-escalation/138048, .../123014). Appeals go to gemini-code-assist-user-feedback@google.com.
- Gemini CLI individual tiers moved to Antigravity CLI on 2026-06-18 (handoff.md / connectivity.md).

### GitHub Copilot
- GitHub ToS (effective Apr 27 2026) https://docs.github.com/en/site-policy/github-terms/github-terms-of-service [V]:
  - §B.3 "One person or legal entity may maintain no more than one free Account". One free machine account is allowed; it is "used exclusively for performing automated tasks".
  - §B.3 "Your login may only be used by one person".
  - §H: API abuse or excessive requests may lead to suspension, and "You may not share API tokens to exceed GitHub's rate limitations."
  - Copilot for individuals is governed by §J (AI Features), which has no limit-specific clauses. https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features [V]
- Acceptable Use §4: "excessive automated bulk activity", "place undue burden on our servers through automated means". [V]
- Enforcement [S]:
  - GitHub Security emails cite "scripted use and multi-account workarounds" and "usage through a proxy that interferes with how Copilot works, or credential sharing". The pattern is a warning, then a temporary Copilot suspension, then a possible permanent account suspension.
  - Copilot-proxy projects (copilot-api, coproxy) warn of suspension.
  - Apr 2026: GitHub paused new Copilot Pro/Student sign-ups and trials over abuse ("illicit harvesting"). https://securityonline.info/github-copilot-pro-trial-suspended-abuse-2026/
- Assessment: multiple FREE Copilot accounts = PROHIBITED [V]. Rotating paid seats = gray/risky. Proxying = risky.

### AWS Kiro
- Kiro is "AWS Content" under the AWS Customer Agreement (https://kiro.dev/license/) [V].
- AWS Service Terms (last updated Oct 13 2026) list Kiro under §1.24 generative AI Services, and §1.24.1 says "Amazon Bedrock abuse detection mechanisms may apply". [V]
- No Kiro-specific multi-account or free-tier clause found [U].
- Enforcement [S]: 429 "Due to suspicious activity, we are imposing temporary limits on how frequently your account..." reported by 9Router users (https://github.com/decolua/9router/issues/1255, May 2026). Users there say Kiro and Antigravity "are banning many accounts". OmniRoute marks Kiro `tos: avoid` and excludes it from auto routing (connectivity.md).
- Assessment: RISKY for proxy/rotation. Fine through the unmodified Kiro CLI/IDE logged in by the user.

---

## 2. Cycling FREE tiers across many providers ("the app that connects to every free agent")
- Likely candidates: 9Router (decolua/9router, MIT, ~31k stars, pushed 2026-10-15; tagline "Unlimited FREE AI coding ... never hit limits") and OmniRoute (connectivity.md §4).
- How they work: a local OpenAI/Anthropic-compatible proxy that takes consumer OAuth tokens and replays them to vendor backends, with round-robin across multiple accounts per provider.
- Two distinct things get conflated:
  1. ONE free account per provider, each used inside that provider's own client, with the user moving between providers when one is exhausted. Each tier is used as offered. I found no clause forbidding use of competitor products. Allowed. [U: inference from absence]
  2. Many free accounts per provider, and/or a proxy that replays CLI OAuth tokens outside the vendor client. Explicitly prohibited by:
     - Anthropic legal doc (store/intermediate tokens) [V]
     - Anthropic AUP (multiple accounts to avoid detection; automated account creation) [V]
     - Gemini CLI ToS (third-party access with CLI OAuth) [V]
     - OpenAI ToS (circumvent rate limits) [V]
     - Google APIs ToS (circumvent limits; mask client identity) [V]
     - GitHub (one free account) [V]
     Bans in 2026 are documented for Google, Anthropic, Copilot, and Kiro [S].
- Free-tier facts that change the economics (connectivity.md):
  - Claude Free does not include Claude Code.
  - Qwen OAuth free ended 2026-04-15.
  - Gemini CLI free moved to Antigravity (weekly limits).
  - iFlow went paid.
  - Free tiers churn often, so a "connect all free agents" registry needs per-provider kill switches and a "last verified" date.
- Privacy: free tiers commonly train on inputs. Gemini API "Unpaid Services" [V]; others vary. Turno must warn before sending private code to a free tier.

---

## 3. Storing many OAuth tokens locally
- Turno today: `src/main/secrets.ts` (read-only review). `%APPDATA%\turno\secrets.json` holds Electron `safeStorage` (sync) ciphertext as base64. It refuses to store when encryption is unavailable. Writes are non-atomic `writeFileSync` (turno.md §3).
- Electron safeStorage docs https://www.electronjs.org/docs/latest/api/safe-storage [V]:
  - Windows uses DPAPI. "content is protected from other users on the same machine, but not from other apps running in the same userspace."
  - macOS Keychain also blocks other apps without user override.
  - Linux `basic_text` = hardcoded password, i.e. unprotected.
  - The sync methods are deprecated since Electron 45 and will be removed in Electron 46. The async `encryptStringAsync`/`decryptStringAsync` are the replacement and support `shouldReEncrypt` and `isTemporarilyUnavailable`.
  - Turno is on Electron 44.9.0, so plan the migration before upgrading.
- Orca reference (MIT):
  - `src/main/host/electron-secret-store.ts`: pass-through with an explicit "protection gap" message.
  - `host/safe-storage-availability.ts`: run-wide "withhold" after a probe so a blocking keychain prompt can't freeze the main thread.
  - `credential-file-protection.ts`: classify-without-decrypt for settings UI.
- Threat reality 2026 [S]:
  - Infostealers target `%USERPROFILE%\.claude\.credentials.json` (plaintext on Windows; cux confirms the Windows file backend at creds.go:8). https://securityarsenal.com/blog/infostealers-targeting-claude-accounts-session-token-theft-detection-and-response-guide
  - Fake Claude Code installers (ClickFix on Google Sites, since Mar 2026).
  - A malicious npm package exfiltrated Codex OAuth (CSA note, Jun 2026).
  - MCP config hijack (Mitiga, May 2026; Anthropic: out of scope because it needs prior code execution).
  - DPAPI does not stop same-user malware. Every extra stored token increases what one compromise yields.
- Policy angle: for Anthropic, Turno storing or refreshing Claude OAuth tokens itself is the prohibited "collect, store, or intermediate" act [V]. Codex/Gemini store their own tokens. Turno should not copy them.
- Conclusion: Turno should store NO subscription OAuth tokens.
  - Each agent CLI keeps its own login in its own isolated home (CLAUDE_CONFIG_DIR / CODEX_HOME / GEMINI or agy home / Kiro profile).
  - Turno stores only: profile metadata, the path of each home, rank, consent flags, and API keys the user pasted (safeStorage async, atomic write, per-key provider tag).
  - Recommend `cli_auth_credentials_store=keyring` for Codex homes where the OS supports it. For Claude on Windows the CLI uses a plaintext file; Turno can't change that, but it can show a warning.

---

## 4. Abuse detection / bans from automated switching
Signals that, per public reports, correlate with enforcement [S unless marked]:
- Non-official clients or harness spoofing, missing Claude Code telemetry (Anthropic, Thariq) [S, staff quote].
- Proxies replaying CLI OAuth (Google, Copilot, Kiro).
- Many accounts from one device/IP/payment, especially free ones (Anthropic AUP [V], GitHub [V]).
- 24/7 unattended high-volume loops that look like resale (Anthropic).
- Burst switching: an immediate jump to the next account the moment one hits 429, repeatedly. [U]
- Token refresh from a non-official client using the official client_id (cux pattern). [U]

Consequences seen:
- Throttling (Kiro 429).
- Product-level disable (Google "403 TOS_VIOLATION" for Antigravity/Code Assist).
- Account termination without notice and without refund (Anthropic §12) [V].
- Appeals are slow; some bans were reversed as false positives [S].
- Collateral: a ban can hit the user's main Google/GitHub identity, not just an AI seat. [U, but GitHub suspends the whole account per §M.3 V]

Reliability risks independent of ToS:
- Undocumented endpoints (`api/oauth/usage`) and transcript formats change without notice. Claude docs call jsonl "internal".
- Thinking-signature and encrypted-reasoning errors on resume across accounts or providers (handoff.md).
- Hard-killing a CLI mid-turn on Windows (no SIGINT) can lose a tool result.
- Two processes resuming one session interleave transcripts.
- Rotating a mid-turn session can double-execute tools, since interrupted calls are flagged on resume.

---

## 5. Recommended safe design for the Turno "Agent" button
1. Unit of rotation = (agent CLI, account the user owns), ranked by the user.
   - Default ranking mixes DIFFERENT providers: Claude Max → Codex Plus → Antigravity → Copilot → Kiro → API key → local Qwen.
   - Same-provider multi-account is opt-in, behind a per-provider warning that quotes the relevant clause.
   - Offer "Manual (recommended) / Ask me / Automatic" per provider. Defaults:
     - Anthropic same-provider: Ask.
     - OpenAI same-provider: Ask, with a "may violate 'circumvent rate limits'" banner.
     - GitHub free: disallow a second free account.
     - Cross-provider switches: Automatic allowed.
2. Never touch credentials.
   - Each profile = isolated home dir (CLAUDE_CONFIG_DIR, CODEX_HOME, etc.). Login only by running the vendor's own `login` command in a visible Turno terminal that the user drives. Same model as Orca.
   - No token copying, no refresh, no proxy, no harness spoofing, no modified binaries.
   - Never create accounts or automate sign-up.
3. Limit detection from first-party signals only:
   - Claude status-line `rate_limits.*` [V]
   - CLI rate-limit/429 messages parsed from the PTY
   - `/usage`/`/status` style commands the user could run
   - Show used% and resets_at in the UI.
   - Avoid polling undocumented usage endpoints. If one is ever used, use a low frequency, display only, and make it opt-in.
4. Switch at a turn boundary, never mid-tool-call.
   - Wait for idle/Stop.
   - Cross-provider: hand off a structured summary (handoff.md tier 2).
   - Same-account-family native resume only where verified. Drop to the summary on signature/org errors.
5. Make every switch visible:
   - Banner "Switched from Claude (acct A, 5h limit, resets 14:00) → Codex (acct B)".
   - The handoff summary is editable, with an option to confirm before sending.
   - Keep a local switch log.
   - Rate-limit switching: cooldown, a max switches/hour, and no 24/7 unattended auto-rotation by default.
6. API-key fallback tier: Anthropic Console, OpenAI, Gemini paid, OpenRouter, Bedrock.
   - This is the only tier where automated fallback is explicitly allowed [V Anthropic §3(7) carve-out].
   - Spend cap per key. Show cost. Keys stored with safeStorage async + atomic write.
7. Free-tier registry:
   - One account per provider, used through its own CLI. Mark training/data-use per tier. Per-provider kill switch and "last verified" date.
   - Never bundle or recommend 9Router/OmniRoute-style OAuth proxies. If the user insists, gate them behind an explicit ToS warning naming the specific clauses and documented bans.
8. Consent screen on first enable:
   - Lists what is allowed, gray, and prohibited per provider (table §0).
   - States that bans are at the provider's discretion without notice.
   - Records acceptance in settings with a timestamp.
   - Never claims "safe" or "ToS-compliant" for same-provider rotation.

## Unverified / gaps
- No primary OpenAI or Google statement on multiple paid accounts per person.
- The Thariq X posts were seen only via PiunikaWeb quotes.
- No Kiro-specific terms on multiple accounts or the free tier.
- AUP "Effective Nov 12 2026" date: confirm whether this is the current or an announced version.
- The Anthropic phone-number limit comes from a help-center search snippet.
- The OpenAI US Terms page was blocked (403). The ROW text was used instead, plus a tracker for the US text.
