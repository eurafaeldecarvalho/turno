# T10 — Triggers de evento local + cadência sub-horária (R2)

**Frente:** Rotinas · **Esforço:** M · **Depende de:** T00

## Objetivo
Diferencial local-first sobre as Routines cloud (mín. 1h, só webhook GitHub). Além do cron, disparar rotina por: **file-watch**, **git hook**, **"quando o comando X falhar"**; e permitir intervalos **< 1h**.

## Escopo
- **Dentro:** novos tipos de trigger no schema; watcher com **debounce** (não disparar em rajada); respeitar os locks existentes (não rodar 2x em paralelo).
- **Fora:** webhooks externos/entrada de rede (backlog; é um app local).

## Arquivos
- `src/main/engine.ts:53-78` (hoje só croner + catch-up)
- `src/main/triggers.ts` (novo) — reaproveitar o watch já usado em `routines.ts:144-151`
- `src/main/routines.ts:28` (schema de trigger)

## TDD (RED → GREEN)
Seams puras = `debounceTrigger` e `shouldFire(event, config)`.
1. **RED:** N eventos dentro da janela de debounce → **1** disparo.
2. **RED:** intervalo < 1h é aceito pelo schema (ao contrário da limitação cloud).
3. **RED:** trigger "on-fail" só dispara quando o comando-gatilho sai ≠ 0.
4. **RED:** trigger respeita lock (rotina já rodando → `skip`/`queue` conforme política).
5. **GREEN:** implementar; `fs.watch` mockado.

## Done
- Debounce/shouldFire/lock verdes; salvar rotina com file-watch dispara 1x por mudança.
