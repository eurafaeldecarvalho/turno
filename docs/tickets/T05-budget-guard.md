# T05 — Budget/token guard por rotina (R4)

**Frente:** Rotinas · **Esforço:** S · **Depende de:** T00

## Objetivo
Teto de custo/tokens por run com kill-switch. Dor nº1 nas opiniões de devs ("stop it from wasting tokens"). O app já grava `cost_usd` por run — falta o teto que mata o run ao estourar.

## Escopo
- **Dentro:** config por rotina (`budget_usd?`, `max_tokens?`); acumular custo do stream; abortar o child ao estourar; gravar `skip_reason`/motivo "budget exceeded".
- **Fora:** billing/relatório de custo (o `RunViewer` já mostra custo).

## Arquivos
- `src/main/routines.ts:28` (schema zod: novos campos)
- `src/main/runner.ts:60-99` (`summarize()` lê custo no stream), `:251` (mata o `child`)
- `src/main/engine.ts` (propaga motivo)

## TDD (RED → GREEN)
Seam pura = `shouldAbortForBudget(spent, limit)` + acumulador do stream.
1. **RED:** `spent > limit` → `true`.
2. **RED:** `spent <= limit` → `false`.
3. **RED:** `limit` indefinido → **sempre** `false` (sem teto nunca aborta).
4. **RED:** acumulador soma deltas de custo de múltiplos eventos corretamente.
5. **GREEN:** ligar ao loop do stream; ao `true`, `kill` + motivo.

## Done
- Guard verde; run com teto baixo aborta com motivo; sem teto roda normal.
