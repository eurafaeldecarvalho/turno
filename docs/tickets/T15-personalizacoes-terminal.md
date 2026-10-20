# T15 — Personalizações do terminal

**Frente:** Aparência · **Esforço:** M (fatiável) · **Depende de:** T00

## Objetivo
Adicionar as opções de personalização que devs mais valorizam (pesquisa: Warp, iTerm2, WezTerm, Kitty, Ghostty, VSCode + threads). Priorizar o que o xterm.js/addon já suporta (fácil) e é muito pedido.

## Lotes (do mais fácil/querido pro mais caro)

**Lote 1 — options do core (quick wins, ~1 dia):** só expor em `TerminalSettings` + aplicar em `TerminalPanel.tsx`.
- `padding` interno (CSS no container) — respiro texto/borda. (Kitty, Ghostty)
- `drawBoldTextInBrightColors` — **já está hardcoded `true` no `createTerm`**; virar toggle. (iTerm2)
- `cursorInactiveStyle`, `cursorWidth`, `scrollSensitivity`, `minimumContrastRatio` — options do core.
- cor de seleção custom (`selectionBackground`) por tema — já existe no tema; expor override opcional.

**Lote 2 — addons oficiais (`pnpm add`):**
- **Font ligatures** via `@xterm/addon-ligatures` — toggle **OFF por padrão** (opção divisiva + custo de performance). (Kitty, VSCode, Warp)
- Hyperlinks: `@xterm/addon-web-links` já carregado; avaliar OSC 8 (core) p/ links marcados pelo app.
- `@xterm/addon-progress` (OSC 9;4) — barra de progresso no ícone/taskbar. (Windows Terminal)

**Lote 3 — camada Electron (aparência):**
- **Opacidade/transparência** da janela — `BrowserWindow({ transparent })` + CSS + `allowTransparency:true` no xterm. (iTerm2, WezTerm, Ghostty)
- **Blur** de fundo — `vibrancy` (mac) / `backgroundMaterial` mica/acrylic (win11); **Linux sem caminho confiável**. Depende do Lote 3 opacidade.

**Fora/depois (alto custo ou baixo ROI):** cursor trail (shader custom), imagens inline (`addon-image`), command decorations + notificação de fim de comando (exigem shell integration OSC 133 — projeto próprio), confirmar fechamento com processo rodando.

## Arquivos
- `src/shared/types.ts` (`TerminalSettings`: novos campos)
- `src/main/settings.ts` (`TERMINAL_DEFAULTS`: defaults — ligatures OFF)
- `src/renderer/src/panels/TerminalPanel.tsx` (aplicar nas `term.options` / CSS)
- `src/renderer/src/panels/SettingsPanel.tsx` (controles)
- `src/renderer/src/appearance.ts` (se precisar aplicar CSS global)

## TDD (RED → GREEN)
Seam pura = `terminalOptions(settings): ITerminalOptions` (mapeia `TerminalSettings` → options do xterm). Hoje o mapeamento está inline no `onSettings`; extrair pra função testável.
1. **RED:** `terminalOptions` reflete `padding`, `cursorWidth`, `minimumContrastRatio`, etc.
2. **RED:** ligatures OFF por padrão no `TERMINAL_DEFAULTS`.
3. **GREEN:** implementar por lote; UI/efeito visual via `smoke`.

## Done
- `terminalOptions` verde; cada lote entregue com typecheck + test verdes. Ligatures default OFF.
