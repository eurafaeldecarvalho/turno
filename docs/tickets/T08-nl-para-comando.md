# T08 — NL→comando no terminal (C1)

**Frente:** Companheiro (IA no dia a dia) · **Esforço:** M · **Depende de:** T01/T03 (precisa de Connection)

## Objetivo
No terminal embutido, atalho para "explique esse erro" / "gere o comando" em linguagem natural → provider selecionado → sugere comando com **Execute / Describe / Abort**. A feature mais usada do Warp/shell-gpt. **Nunca** auto-executa.

## Escopo
- **Dentro:** capturar contexto (último comando + output/erro visível no xterm); montar prompt; chamada curta ao provider (via Connection); parsear resposta em `{command, explanation}`; só injeta no pty no **Execute**.
- **Fora:** autocompletar inline enquanto digita (backlog).

## Arquivos
- `src/renderer/src/panels/TerminalPanel.tsx` (xterm: atalho + UI do card)
- `src/main` novo handler `ai:suggestCommand` (usa connection + `claude -p` one-shot)
- `src/main/pty.ts` (injeta comando só no Execute)

## TDD (RED → GREEN)
Seams puras = `buildNlPrompt(ctx)` e `parseSuggestion(raw): {command, explanation}`.
1. **RED:** `buildNlPrompt` inclui o erro/último comando no prompt.
2. **RED:** `parseSuggestion` extrai comando e explicação; resposta sem comando → `command=null` (UI não oferece Execute).
3. **RED (guarda):** fluxo nunca retorna um "auto-run"; Execute é ação explícita.
4. **GREEN:** implementar; chamada ao provider mockada no teste.

## Done
- Prompt/parse verdes; no terminal, pedir sugestão mostra comando + Execute/Describe/Abort; só roda no Execute.
