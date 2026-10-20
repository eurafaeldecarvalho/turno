# T11 — Digest matinal "turno da manhã" (R3)

**Frente:** Rotinas · **Esforço:** M · **Depende de:** T00

## Objetivo
Consolidar o resultado das runs de um período num **painel + uma notificação única** em vez de N toasts. Devs querem revisar em lote (pitch "5 PRs na segunda de manhã"). Encaixa no nome do app.

## Escopo
- **Dentro:** `buildDigest(runs, window)` agrupando por rotina/status/custo; painel de digest; 1 notificação-resumo; agendamento do digest (rotina especial ou setting de horário).
- **Fora:** envio por email/Slack (backlog; já existe ntfy em `notify.ts`).

## Arquivos
- `src/main/db.ts` (query de runs por janela — tabela `runs` já tem `started_at`/`status`/`cost_usd`)
- `src/main/notify.ts` (resumo único)
- `src/main/digest.ts` (novo) + renderer painel

## TDD (RED → GREEN)
Seam pura = `buildDigest(runs, window): DigestModel`.
1. **RED:** agrupa por rotina com contagem de sucesso/falha e soma de custo.
2. **RED:** janela filtra fora runs de outro período.
3. **RED:** sem runs → digest "nada rodou" (não quebra, não notifica vazio conforme setting).
4. **GREEN:** implementar; query real no db por cima.

## Done
- `buildDigest` verde; ao disparar, gera painel + 1 notificação consolidada.
