# T09 — Inbox de aprovação em lote (O3)

**Frente:** Orquestração · **Esforço:** M · **Depende de:** T00

## Objetivo
Combater a *dialog fatigue* ("whack-a-mole with permission prompts", "click approve on everything"). Em vez de pop-up por ação, acumular as `can_use_tool` de **todas as runs** num inbox revisável; aprovar/negar em lote e por **allowlist** (categoria/padrão). Enhancement do fluxo atual de cartões.

## Escopo
- **Dentro:** fila de pending global; allowlist por padrão de tool (ex. `Bash(git *)`, `Read`); ações bulk (aprovar todos de uma rotina/categoria); persistir allowlist.
- **Fora:** auto-approve irrestrito/YOLO (isso só com sandbox — T13).

## Arquivos
- `src/main/runner.ts:287-295` (control_request `can_use_tool`), `:134-152` (`answerPermission`)
- `src/main/permissions.ts` (novo: fila + allowlist)
- renderer: painel Inbox

## TDD (RED → GREEN)
Seams puras = `matchAllowlist(tool, rules)` + fila `pending` (add/resolve).
1. **RED:** tool batendo numa regra → auto-`allow` (não entra no inbox).
2. **RED:** sem regra → fica `pending`.
3. **RED:** `resolve(id, decision)` remove do pending e devolve a decisão (allow/allow_session/deny) correta ao runner.
4. **RED:** decisão em lote por rotina resolve todos os daquela rotina.
5. **GREEN:** implementar; ligar ao `answerPermission`.

## Done
- Allowlist + fila verdes; aprovar em lote responde todos os control_requests pendentes.
