# T05 — Abort policy agnóstica (R4)

**Frente:** Rotinas · **Esforço:** M · **Depende de:** T00 · **Status:** ✅ (substitui o antigo "budget guard")

## Objetivo
O usuário escolhe QUANDO a run para, de forma agnóstica — não só por custo. Generaliza o antigo `budget_usd`/`shouldAbortForBudget` numa lista de políticas (`AbortPolicy[]`).

## Modelo (`src/main/abort.ts`)
```ts
type AbortPolicy =
  | { kind: 'cost_usd';     limit: number }   // custo acumulado (so provider que reporta total_cost_usd)
  | { kind: 'steps';        limit: number }   // num_turns
  | { kind: 'duration_min'; limit: number }   // tempo de parede do segmento
  | { kind: 'session_limit' }                 // bateu o limite de 5h → PAUSA e retoma no reset
  | { kind: 'weekly_limit' }                  // bateu o limite semanal → PAUSA e retoma no reset
```
- `evaluateThresholds(metrics, policies)` — aborta (status `aborted`) se cost/steps/duration estourar.
- `parseRateLimit(line)` — lê o `rate_limit_event` do stream do CLI; só considera `status:'rejected'` (allowed/allowed_warning NÃO pausam). Campos verificados na fonte: `rateLimitType` ∈ {five_hour, seven_day}, `resetsAt` em segundos.
- `matchedRateLimit(type, policies)` — mapeia five_hour→session_limit, seven_day→weekly_limit.
- `policiesFromConfig(config)` — `budget_usd` legado vira açúcar de `cost_usd` (sem duplicar).
- `priorCost(threadRuns)` — soma `cost_usd` dos segmentos p/ o teto de custo ser **cumulativo pela conversa** (não reinicia a cada resume → anti-overspend).

## Pausar/retomar (`runner.ts` + `engine.ts` + `db.ts`)
- Ao bater 5h/semanal (rejected) com a policy habilitada: `runner` marca `pauseUntil=resetsAt`; `finish()` grava status **`paused`** + `resume_at` + `session_id`, e NÃO poda a run.
- `engine.resumePaused()` (a cada 120s + no `catchUp`): pega `duePausedRuns`, **reivindica (`resume_at=null`) antes do await** (sem retomada dupla), e `followUp(--resume)`. Em `lock busy` reagenda (+5min); em erro permanente marca `failed` (não some em silêncio).
- Migração `db.ts`: coluna `resume_at` (user_version 4) + `over_budget`→`aborted` (5). `paused` sobrevive ao restart (recovery só mexe em running/queued) e não é podada.

## TDD
`abort.test.ts` cobre evaluateThresholds, matchedRateLimit, parseRateLimit (rejected vs allowed), policiesFromConfig, priorCost. Núcleo puro; pause/resume e detecção são integração (runner/engine), verificadas por review + build/smoke.

## Limitações conhecidas (documentadas no código)
- `cost_usd` só atua em provider que reporta custo (Ollama local = grátis, teto inócuo).
- `steps`/`duration_min` são por-segmento (não cumulativos entre resumes; steps não é persistido).
- Input visual no `RoutineEditor` p/ montar as policies: **follow** (hoje via frontmatter do ROUTINE.md).

## Done
`pnpm test` + `tsc` verdes; review 3-gate fechado a zero.
