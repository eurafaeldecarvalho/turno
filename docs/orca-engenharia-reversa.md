# Orca: engenharia reversa (para inspirar o Turno)

> Alvo: Orca **1.4.224** (stablyai, MIT, `github.com/stablyai/orca`), instalado em `%LOCALAPPDATA%\Programs\orca`.
> Data: 2026-10-18. Método: `@electron/asar extract` + REA (`rea-agents analyze-javascript-application`) + leitura direta do bundle. Nada da instalação foi alterado; `rea-agents setup` não foi executado.

## 0. Como foi feito / o que o REA entregou
- **REA no `.asar` inteiro:** estourou o timeout padrão (300 s) em 956 de 4724 arquivos.
- **REA só em `out/main/index.js` + `out/preload/index.js`:**
  - 5 `BrowserWindow` e 1 `contextBridge`;
  - **1031 canais IPC**: 791 handlers no main, 848 envios do renderer e 191 listeners;
  - todas as janelas com `contextIsolation:true`, `nodeIntegration:false` e `sandbox:true`.
- **O que realmente ajudou:** o asar traz `out/shared/` com **1593 módulos CommonJS não minificados**, comentados com `// Why:`.
- **Stack:** Electron + React + Tailwind v4 (tokens shadcn), i18next, Monaco, xterm 6 beta, `node-pty`, `@anthropic-ai/claude-agent-sdk 0.3.284`, `zod`, `electron-updater`, `sherpa-onnx` (voz).
- **Prefixos IPC:**

  | Prefixo | Canais |
  |---|---|
  | `ui` | 87 |
  | `gh` | 61 |
  | `pty` | 59 |
  | `browser` | 56 |
  | `git` | 37 |
  | `fs` | 37 |
  | `automations` | 12 |
  | `clipboard` | 12 |
  | `settings` | 9 |
  | `notifications` | 9 |
  | `keybindings` | 7 |
  | `nativeChat` | 4 |

## 1. Configurações
- **Onde ficam:**
  - configurações e estado: `%APPDATA%\orca\orca-data.json`, num JSON único gravado por `flush()` (settings + UI + automations + runs);
  - atalhos: `~/.orca/keybindings.json`, com watcher e IPC `keybindings:openFile/revealFile/reload`.
- **Flags de migração** junto dos valores (ex.: `terminalCursorStyleDefaultedToBlock: true`): permitem mudar um default sem atropelar escolhas explícitas.
- **Seções:** general, appearance, terminal, agents, accounts, notifications, shortcuts, terminal-shortcut-policy, quick-commands, automations, input, voice, git, browser, integrations, ssh, servers, mobile, orchestration, artifacts, session-history, stats, privacy, experimental, advanced. Busca com Ctrl+F.

**Geral / aparência**
```js
theme:'system', uiLanguage:'system', appFontFamily:'Geist', minimizeToTrayOnClose:false,
showMenuBarIcon:true, keepComputerAwakeWhileAgentsRun:false // sidebarWidth 280, rightSidebarWidth 350
```
**Terminal**
```js
terminalFontSize:14, terminalFontFamily:'Cascadia Mono'(win), terminalFontWeight:500, terminalFontWeightBold:700,
terminalLineHeight:1 /*1..3*/, terminalScrollSensitivity:1.15, terminalFastScrollSensitivity:5,
terminalGpuAcceleration:'auto', terminalLigatures:'auto', terminalCursorStyle:'block', terminalCursorBlink:true,
terminalThemeDark:'Ghostty Default Style Dark', terminalThemeLight:'Builtin Tango Light', terminalUseSeparateLightTheme:true,
terminalDividerThicknessPx:3, terminalInactivePaneOpacity:0.9, terminalPaneOpacityTransitionMs:140,
terminalRightClickToPaste:(win32), terminalWindowsShell:'powershell.exe' /*prefere pwsh*/, terminalClipboardOnSelect:false,
terminalCopyTrimsGutter:true, terminalAllowOsc52Clipboard:true, terminalScrollbackRows:5000 /*1000..50000*/,
terminalShortcutPolicy:'orca-first', terminalQuickCommands:[] /*até 40*/, floatingTerminalEnabled:true
```
**Agentes / chat**
```js
nativeChatQueueFollowUps:true, nativeChatResumeWorkOnRestart:false, agentStatusHooksEnabled:true,
promptCacheTtlMs:300000, agentHibernationIdleMs:1800000
// chat: fontSize 14 (12–20), codeFontSize 12, width comfortable|wide|full, contrast 100 (50–150)
```
**Notificações**
```js
{enabled:true, agentTaskComplete:true, terminalBell:false, suppressWhenFocused:true, customSoundId:'system', customSoundVolume:100}
// cooldown de 5000 ms por chave; sons: system, two-tone, bong, thump, blip, sonar, blop, ding, clack, beep, custom
```

## 2. Temas
- **Interface:** só claro/escuro/sistema (tokens shadcn neutral).
  - Escuro: `--background #0a0a0a`, `--card #171717`, `--muted-foreground #a1a1a1`, `--border #ffffff12`, `--input #ffffff26`, `--sidebar-primary #1447e6`.
  - Claro: `#fff`, `#0a0a0a`, `#737373`, `#e5e5e5`.
- **Chat por `color-mix`:** duas fontes (`--chat-source-background` e `--chat-source-foreground`) e percentuais de mistura.
  - Escuro: canvas 5%, fg 78%, user 7%, code 3.5%, composer 4%.
  - Claro: user 4%, code 2%.
  - Largura máxima de conteúdo: 46rem.
- **30 temas de terminal:**
  - escuros: Dracula, One Dark, Nord, Monokai, Tokyo Night, Gruvbox, Catppuccin, Solarized, Material, Ayu, Nightfox, Kanagawa, Rose Pine, Everforest, Palenight, Horizon, Night Owl;
  - claros: Solarized Light, One Light, Catppuccin Latte, GitHub Light, Rose Pine Dawn, Gruvbox Light, Tokyo Night Light, Everforest Light;
  - clássicos: Tango, Homebrew, Snazzy.
- **Escolha do tema no modo claro:** com "tema claro separado" ligado, usa `terminalThemeLight`; senão, `terminalThemeDark`.
- **Ajustes do Orca nas paletas:**
  - a seleção do Ghostty mudou para `#5a7898`;
  - no Tango Light, yellow/white foram escurecidos porque o Claude usa ANSI para texto.

Paletas completas (1 tema por linha): ver o apêndice no fim deste arquivo.

## 3. Fontes
- **Interface:** Geist variável embutida.
- **Símbolos:** `SymbolsNerdFontMono-Regular.woff2` embutida com `unicode-range` só da PUA (`U+E000-F8FF, U+F0000-FFFFD, U+100000-10FFFD`), para os ícones de prompt funcionarem com qualquer fonte.
- **Fallback do terminal:** fonte do usuário, depois `Cascadia Mono, Consolas, … , Orca Nerd Font Symbols, Symbols Nerd Font Mono, …, monospace`.
- **Fontes do sistema no Windows:**
  ```powershell
  Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | % Name
  ```
- **Ligaduras automáticas** para Fira, JetBrains, Cascadia Code, Iosevka, Victor, Geist Mono, Maple Mono e outras.
- **Pesos e espaçamento:** normal 500 e bold 700 configuráveis à parte, line-height 1–3, sem letter-spacing.

## 4. Terminal
- **Opções do xterm:** `cursorInactiveStyle:'outline'`, `drawBoldTextInBrightColors:true`, `scrollbar:{width:7}`, `scrollSensitivity:1.15`, `minimumContrastRatio`.
- **Addons:**
  - sempre carregados: fit, search, serialize, unicode11, web-links;
  - sob demanda: webgl, ligatures, image;
  - se o contexto WebGL se perde, cai para o renderer DOM.
- **Colagem segura:** `\r?\n` vira `\r`, ESC vira `␛`, e o texto vai entre `ESC[200~` e `ESC[201~` (bracketed paste).
- **Copiar e colar:**
  - copiar com Ctrl+Shift+C, ou Ctrl+C quando há seleção;
  - colar com Ctrl+V, Ctrl+Shift+V ou Shift+Ins;
  - no Windows, o botão direito cola;
  - ao copiar, remove o recuo comum das linhas.
- **Splits:** Ctrl+Shift+D (direita), Alt+Shift+D (baixo), Ctrl+] / [ (foco). Painel inativo com opacidade 0.9 e divisor de 3 px.
- **Extras:** confirmação ao fechar com processo vivo, OSC 133 (código de saída), quick commands, terminal flutuante.

## 5. Chat nativo
- **TUI como chat:** junta três fontes, em ordem de prioridade:
  - o transcript `~/.claude/projects/*.jsonl` (watch + leitura reversa);
  - hooks enviados a um listener HTTP local;
  - texto raspado da tela.
- **Sessão estruturada:** `query()` do Agent SDK com um gerador assíncrono de mensagens. Opções:
  - `includePartialMessages`;
  - preset `claude_code`;
  - setting sources user/project/local;
  - `replay-user-messages`.
- **Control requests:** `initialize`, `interrupt`, `set_model`, `set_permission_mode`, `apply_flag_settings` (effort), `list_models`, `cancel_async_message`, `stop_task`.
- **ID e retomada:** ID derivado de `sha256("orca-claude:<chatId>")`; sessões terminadas reabrem com `claude --resume <id>`.
- **Encerramento:** mata a árvore de processos, primeiro de forma gradual (1500 ms) e depois forçada (1000 ms).
- **Renderização:**
  - "Working for 1m 12s", depois "Worked for / Interrupted after / Failed after";
  - "Thought for 12s";
  - ferramentas com ícone fixo por categoria e frase-resumo ("Read 7 files, ran 17 commands and searched 4 times");
  - subagentes recolhíveis;
  - fila de follow-ups desenhada abaixo da linha viva;
  - aprovações e perguntas inline;
  - composer com `/` e seletor de esforço.

## 7. Automations
```js
{ id, name, prompt, precheck:{command, timeoutSeconds:60}, agentId, timezone, rrule|cron, enabled,
  missedRunPolicy:'run_once_within_grace', missedRunGraceMinutes:720, nextRunAt, lastRunAt }
// run: { runNumber (nunca reinicia), title:`${name} run ${n}`, scheduledFor, status, trigger, outputSnapshot, precheckResult, usage, error }
```
- **Status finais:** `completed`, `dispatch_failed`, `skipped_precheck`, `skipped_missed`, `skipped_unavailable`, `skipped_needs_interactive_auth`.
- **Retenção:** 100 runs por automação, apagando só as que já terminaram.
- **UI:**
  - agenda: Hourly, Daily, Weekdays, Weekly, Custom cron;
  - templates prontos;
  - na lista: Run Now, Pause/Resume, Rerun;
  - no detalhe do run: última saída, tokens e custo estimado.

## 8. Notificações, bandeja e atalhos
- **Notificações:** silenciadas com a janela em foco, cooldown de 5 s e badge de não lidas.
- **Bandeja:** "Open Orca"; minimizar para a bandeja vem desligado por padrão.
- **Atalhos:** 91 no Windows. Exemplos: Ctrl+P (arquivo), Ctrl+1..9 (workspace), Ctrl+T (nova aba), Ctrl+W (fechar), Ctrl+= / - / 0 (zoom), Ctrl+F (busca), Ctrl+Shift+D / Alt+Shift+D (split).
- **Ctrl+, sem atalho de propósito:** fica livre para os TUIs.

## 9. O que trazer para o Turno (valor ÷ esforço) e o que foi feito
| # | Ideia | Status no Turno |
|---|---|---|
| 1 | Frase-resumo de ferramentas por categoria | **feito** ("Leu 3 arquivos, rodou 2 comandos") |
| 2 | "Trabalhou por / Pensou por Ns" | **feito** |
| 3 | Fila de follow-ups visível | parcial: mensagens entram ao vivo pelo stdin |
| 4 | Control requests (`interrupt`) | **feito** (interrupt + fallback taskkill); set_model/set_permission_mode: depois |
| 5 | Streaming de tokens (`--include-partial-messages`) | depois |
| 6 | Tema do chat por color-mix | parcial (tokens do tema) |
| 7 | Nerd Font de símbolos embutida | depois |
| 8 | Listar fontes do sistema | **feito** |
| 9 | Opções do xterm + search/web-links/unicode11 | **feito** |
| 10 | Colagem segura (bracketed paste) | **feito** (`term.paste`) |
| 11 | Histórico com retenção e motivos de pulo | **feito** (motivo em todo skip; retenção de 200 por rotina) |
| 12 | Templates de rotina | depois |
| 13 | Notificação com cooldown, silenciada em foco | **feito** |
| 15 | Painel inativo 0.9 | **feito** |
| — | Permissões inline (`--permission-prompt-tool stdio`) | **feito** (cartão + notificação) |

## Apêndice: paletas de terminal do Orca (formato compacto)
Arquivo bruto gerado pela análise: ver `orca-temas-terminal.txt` nesta pasta.
