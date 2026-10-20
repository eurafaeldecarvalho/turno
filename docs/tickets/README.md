# Tickets — Turno (agnóstico de provider + rotinas + IA no dia a dia)

> Planejamento de implementação. Cada ticket nasce de um **teste que FALHA** (TDD: RED → GREEN → REFACTOR).
> Runner: **Vitest** (ver T00). O alvo do teste é sempre a **função pura no main process**; UI/Electron fica no `smoke`.
> Comentários/docs em PT-BR, identificadores em inglês.

## Ordem sugerida (impacto × esforço × dependência)

| # | Ticket | Frente | Esf | Depende de | Status |
|---|---|---|---|---|---|
| T00 | Harness de testes (Vitest) | base | S | — | ✅ |
| T01 | Modelo de Connection (provider-agnostic core) | Parte 0 | M | T00 | ✅ (backend; migração desnecessária: ids legados = ids semeados; alguns displays de UI pendentes) |
| T02 | Secret storage (safeStorage) | Parte 0 | S | T00 | ✅ |
| T03 | Aba "Conexões" + fluxo de login | Parte 0 | M | T01, T02 | ✅ (CRUD+login+token no cofre+seletores) |
| T04 | Preflight / Diagnóstico de provider | Parte 0 | M | T01 (+T03) | ✅ (classifier+check+botão; modal install FEITO; sem claude doctor) |
| T05 | Abort policy agnóstica (R4): cost_usd/steps/duration + limite sessão/semanal (pausa+retoma) | Rotinas | M | T00 | ✅ (abort.ts+runner+pause/resume; input no editor FEITO) |
| T06 | Recipes (templates de rotina) (R1) | Rotinas | S | T00 (+T01) | ✅ (catalogo+materialize; picker UI pendente) |
| T07 | Worktree por agente nativo (O1) | Orquestração | M | T00 | ✅ (primitivas + teste de integração git; wiring no engine/runner PENDENTE) |
| T08 | NL→comando no terminal (C1) | Companheiro | M | T01/T03 | ✅ (buildNlPrompt+parseSuggestion; card no terminal FEITO, Ctrl+Shift+A) |
| T09 | Inbox de aprovação em lote (O3) | Orquestração | M | T00 | ✅ (matchAllowlist+fila; painel+wiring runner pendentes) |
| T10 | Triggers de evento local + sub-horário (R2) | Rotinas | M | T00 | ✅ (debounce+shouldFireOnExit; sub-horário no cron; fs.watch no engine FEITO, anti-loop) |
| T11 | Digest matinal "turno da manhã" (R3) | Rotinas | M | T00 | ✅ (buildDigest; painel+notificação pendentes) |
| T12 | Fan-out: N agentes + comparar + merge (O2) | Orquestração | L | T07, T01 | ✅ (fanOut+compare view FEITOS; worktree-hot-path + merge-winner = follow) |
| T13 | Sandbox opcional (default OFF) | Orquestração | L | T00 (+T07) | ✅ (wrap+env-forward+toggle UI FEITOS; imagem docker/wsl = follow) |
| T14 | +16 temas populares (Gruvbox/Solarized/Ayu/…) | Aparência | S | T00 | ✅ (sem arquivo T14-*.md) |
| T15 | Personalizações (Lote 1: padding, bold-bright, cursor, contraste) | Aparência | M | T00 | ✅ (padding/bold-bright/cursor/contraste/opacidade/ligatures FEITOS; blur = follow) |

**Extra já feito (fora de ticket):** copy-on-select ligado por padrão (settings.ts).

Esf: S ≤ ~1d · M ~2-3d · L ~1sem.

## Parkeados (backlog, não ticketados)
companion mobile · account-switcher com rate-limit · self-healing watchdog · session-restore de scrollback completo · broadcast input.

## Regras transversais (valem p/ todo ticket)
- **TDD**: teste vermelho primeiro, colar a saída crua do runner; não relaxar asserção pra passar.
- **Blast radius**: símbolo exportado que muda → atualizar todos os call sites no mesmo PR.
- **Segredo**: nunca logar/serializar token; só nome da env var. Token sempre via T02.
- **Idempotência/falha parcial**: orquestração de N agentes usa `allSettled` e checa cada resultado.
- **Antes de DONE**: `pnpm typecheck` + `pnpm test` verdes, saída colada.
