# Referências: Orca, Wave Terminal e Tabby → o que copiar para o Turno

Pesquisa feita em 2026-10-18 lendo o código-fonte (clone raso e esparso, sem executar nada):

| App | Repo | Commit lido | Stack relevante |
|---|---|---|---|
| **Orca** | `stablyai/orca` (MIT) | HEAD de `main` | Electron + React + Tailwind, xterm 6.1 beta, `@anthropic-ai/claude-agent-sdk` 0.3.284 |
| **Wave Terminal** | `wavetermdev/waveterm` (Apache-2.0) | HEAD de `main` | Electron + React/Jotai + backend Go, xterm |
| **Tabby** | `Eugeny/tabby` (MIT) | HEAD de `master` | Electron + Angular, xterm |

Também abri o pacote npm `@anthropic-ai/claude-agent-sdk@0.3.302` (só leitura de `sdk.d.ts`/`core.mjs`) para confirmar o protocolo stream-json que o SDK fala com o `claude`.

Caminhos citados são relativos à raiz de cada repo.

---

## 1. Settings: estrutura das telas

### 1.1 Orca: painéis com busca

Fonte: `docs/site/content/docs/settings.mdx`, `src/shared/default-global-settings.ts`, `src/renderer/src/components/settings/*`.

- Painel lateral de **panes** e **busca global** (`Cmd/Ctrl+,` e depois digitar). Cada opção é registrada num arquivo `*-search.ts` com `title`, `description` e `searchKeywords` (ex.: `terminal-typography-search.ts`). A busca filtra por esses metadados e rola até o controle. Esse é o padrão que vale copiar.
- Os panes são: **General, Appearance, Git, Terminal, Quick Commands, Agents, Browser, Artifacts, Integrations, Notifications, Voice, SSH, Remote Orca Servers, Shortcuts, Repository, Floating Workspace, Plugins, Experimental**.
- Uma flag `*DefaultedFor…` / `*Migrated` acompanha os defaults que mudaram entre versões. Assim o novo default chega a quem nunca mexeu e respeita quem já mexeu. Exemplo: `terminalCursorStyleDefaultedToBlock: true`.

Defaults reais do Orca (os relevantes):

| Chave | Default | Observação |
|---|---|---|
| `theme` | `'system'` | dark/light/system |
| `appFontFamily` | `'Geist'` | fonte embarcada |
| `uiLanguage` | `'system'` | |
| `terminalFontSize` | `14` | |
| `terminalFontFamily` | Win `Cascadia Mono` · Linux `DejaVu Sans Mono` · mac `SF Mono` | `terminal-platform-defaults.ts` |
| `terminalFontWeight` / `terminalFontWeightBold` | `500` / `700` | faixa 100–900, passo 100 |
| `terminalLineHeight` | `1` | |
| `terminalLigatures` | `'auto'` | liga só para fontes conhecidas (lista na seção 3) |
| `terminalGpuAcceleration` | `'auto'` | WebGL com fallback para DOM |
| `terminalCursorStyle` / `terminalCursorBlink` | `'block'` / `true` | |
| `terminalThemeDark` | `'Ghostty Default Style Dark'` | |
| `terminalUseSeparateLightTheme` / `terminalThemeLight` | `true` / `'Builtin Tango Light'` | tema de terminal separado por modo |
| `terminalDividerColorDark` / `Light` | `#3f3f46` / `#d4d4d8` | cor do divisor de split |
| `terminalDividerThicknessPx` | `3` | |
| `terminalInactivePaneOpacity` / `Active` | `0.9` / `1` | transição de `140ms` |
| `terminalScrollbackRows` | `5000` | |
| `terminalScrollSensitivity` / `Fast` / `Tui` | `1.15` / `5` / `1` | |
| `terminalRightClickToPaste` | `true` no Windows, `false` nos outros | Ctrl+clique direito abre o menu |
| `terminalClipboardOnSelect` | `false` | copy-on-select |
| `terminalCopyTrimsGutter` | `true` | remove a indentação comum ao copiar |
| `terminalAllowOsc52Clipboard` | `true` | |
| `terminalWindowsShell` | `'powershell.exe'` | |
| `terminalWindowsPowerShellImplementation` | `'auto'` | pwsh 7 se existir, senão Windows PowerShell |
| `terminalMouseHideWhileTyping` | `false` | |
| `terminalFocusFollowsMouse` | `false` | |
| `terminalShortcutPolicy` | `'orca-first'` | quem ganha quando um atalho conflita com a TUI |
| `skipCloseTerminalWithRunningProcessConfirm` | `false` | pergunta antes de fechar terminal ocupado |
| `notifications` | `{enabled:true, agentTaskComplete:true, terminalBell:false, suppressWhenFocused:true, customSoundId:'system', customSoundVolume:100}` | |
| `nativeChatQueueFollowUps` | `true` | follow-ups viram fila enquanto o turno roda |
| `nativeChatPermissionMode` | `'full-access'` | opções: `ask`, `accept-edits`, `auto`, `full-access` |
| `keepComputerAwakeWhileAgentsRun` | `false` | On / Agent / Off |
| `minimizeToTrayOnClose` | `false` | |
| `promptCacheTimerEnabled` / `promptCacheTtlMs` | `false` / `300000` | timer de cache de prompt |

Itens do **pane Terminal** (títulos e descrições reais): Font Size, Font Family, Font Weight, Line Height, Font Ligatures, GPU Acceleration, Color Contrast, Cursor Shape, Blinking Cursor, Cursor Opacity, Background Opacity, Window Blur, Horizontal/Vertical Padding, Hide Mouse While Typing, Color Overrides, Dark Theme, Light Theme, "Match dark mode", Dark/Light Divider Color, Import from YAML, Import from Warp, Import from Ghostty, Scrollback Rows, Word Separators, Copy on Select, Allow TUI Clipboard Writes (OSC 52), Trim Gutter on Copy, Inactive Pane Opacity, Divider Thickness, Scroll Speed, Ask Before Closing Running Terminals, Focus Follows Mouse, Terminal shell, Default Shell (Windows), PowerShell Version, Right-click to paste, Administrator mode, Manage Sessions.

O **Appearance → Chat** tem: Match terminal interface, Contrast, Text size, Code text size, Width e "Reset chat appearance".

O pane Terminal mostra um **preview ao vivo** (`TerminalSettingsPreview.tsx`).

### 1.2 Wave: JSON primeiro

Fonte: `pkg/wconfig/defaultconfig/settings.json`, `docs/docs/config.mdx`.

- O arquivo é `~/.config/waveterm/settings.json`, com chaves planas no formato `namespace:chave`. Aceita `$ENV:VAR[:fallback]` em qualquer string. Existe override por bloco e por conexão: o mesmo `term:fontsize` vale no settings global, em `connections[<nome>]` e em `block.meta`, nessa ordem de precedência.
- Defaults embarcados: `term:cursor "block"`, `term:cursorblink false`, `term:copyonselect true`, `term:trimtrailingwhitespace true`, `term:bellsound false`, `term:bellindicator true`, `term:osc52 "always"`, `window:tilegapsize 3`, `window:magnifiedblockopacity 0.6`, `window:magnifiedblocksize 0.95`, `window:confirmclose true`, `window:savelastwindow true`, `app:confirmquit true`, `app:focusfollowscursor "off"`, `app:tabbar "top"`, `autoupdate:intervalms 3600000`.
- No código (`frontend/app/view/term/term.tsx`, `term-model.ts`): `fontSize 12` (aceita 4–64), `fontFamily "Hack"`, `scrollback 2000` (limite 0–50000), `drawBoldTextInBrightColors false`, `allowTransparency true`, `overviewRuler {width:6}`, WebGL ligado salvo se `term:disablewebgl`.
- Opções que interessam ao Turno:
  - `term:shiftenternewline`: Shift+Enter manda `\u001b\n`, útil para o Claude Code interativo.
  - `term:allowbracketedpaste`.
  - `term:localshellpath` / `term:localshellopts`.
  - `term:transparency` (default 0.5).
  - `app:ctrlvpaste`: Ctrl+V cola no Windows.
  - `tab:confirmclose`.
  - O menu de contexto do terminal tem um submenu de tamanho de fonte de 6 a 18 px, gravado por bloco.

### 1.3 Tabby: abas de settings em YAML

Fonte: `tabby-core/src/configDefaults*.yaml`, `tabby-terminal/src/config.ts`, `*SettingsTab.component.pug`.

- As abas são Application/Window, Appearance, Color scheme, Terminal, Hotkeys, Profiles & connections, SSH, Plugins, Vault e Config sync. O Terminal se divide em **Rendering / Keyboard / Mouse / Clipboard / Sound / Startup / Windows**.
- Defaults do terminal: `frontend 'xterm-webgl'`, `fontSize 14`, `fontWeight 400`, `fontWeightBold 700`, `linePadding 0`, `bell 'off'` (off/visual/audible), `bracketedPaste true`, `ligatures false`, `cursor 'block'`, `cursorBlink true`, `rightClick 'menu'` (no Windows `'clipboard'`), `pasteOnMiddleClick true` (Windows `false`), `copyOnSelect false` (Windows `true`), `copyAsHTML true`, `scrollOnInput true`, `altIsMeta false`, `wordSeparator ' ()[]{}\'"'`, `warnOnMultilinePaste true`, `scrollbackLines 25000`, `drawBoldTextInBrightColors true`, `sixel true`, `minimumContrastRatio 4`, `trimWhitespaceOnPaste true`, `detectProgress true`.
- Fonte por plataforma: Windows `Consolas`, mac `Menlo`, Linux `Liberation Mono`. Tem `fallbackFont` e `Custom CSS`.
- Window: `theme 'Follow the color scheme'`, `frame thin`, `opacity 1.0`, `spaciness 1` (densidade), `tabsLocation top`, `lastTabClosesWindow false`, `recoverTabs true`, `paneResizeStep 0.1`, `hacks.disableGPU false`.

### 1.4 Proposta de Settings para o Turno

Formato sugerido: painel com navegação lateral, busca no topo, metadados de busca como no Orca e persistência no `settings.json` atual (chaves planas, merge com defaults).

| Seção | Opção | Default sugerido |
|---|---|---|
| **Geral** | Pasta de rotinas | `~/rotinas` (já existe) |
| | Abrir ao iniciar o Windows | `false` (já existe) |
| | Minimizar para a bandeja ao fechar | `true` (rotinas precisam continuar rodando) |
| | Manter o PC acordado: Off / Durante runs / Sempre | `Durante runs` |
| | Idioma | `pt-BR` |
| **Aparência** | Tema: system / dark / light, mais um tema escuro e um claro escolhidos separadamente | `system`, `turno-dark`, `turno-light` |
| | Fonte da UI | `Geist` embarcada, fallback `Segoe UI` |
| | Zoom da UI | `100%` |
| | Densidade | `normal` |
| **Terminal** | Família / tamanho / peso / peso negrito / line height | `Cascadia Mono` / 14 / 400 / 700 / 1.0 |
| | Ligaduras: auto / on / off | `auto` |
| | Cursor: block / bar / underline + piscar | `block`, `true` |
| | GPU: auto / on / off | `auto` |
| | Scrollback | `10000` |
| | Copiar ao selecionar | `false` |
| | Clique direito cola | `true` no Windows |
| | Shell padrão (lista detectada) | `pwsh` → `powershell` |
| | Shift+Enter quebra linha (`\u001b\n`, valor do Wave) | `true` |
| | Avisar ao colar várias linhas | `true` |
| | Bell: off / visual / som | `visual` |
| | Opacidade do painel inativo | `0.9` |
| | Perguntar antes de fechar terminal ocupado | `true` |
| **Agentes / Runs** | Executável `claude` (auto ou caminho) | auto |
| | Modo de permissão padrão: perguntar / aceitar edições / auto / acesso total | por rotina; ad-hoc = `perguntar` |
| | Mostrar raciocínio (`--thinking-display summarized`) | `true` |
| | Fila de follow-ups durante o turno | `true` |
| | Retenção de logs de runs | `30 dias` |
| **Chat (transcript)** | Tamanho do texto / do código / largura máxima / contraste | 14 / 12 / 860px / padrão |
| | Ferramentas recolhidas por padrão | `true` |
| **Notificações** | Ao terminar run, ao falhar, ao pedir permissão | `true` / `true` / `true` |
| | Suprimir quando a janela está focada | `true` |
| | ntfy (servidor/tópico) | já existe |
| **Atalhos** | Lista editável (seção 6) | |
| **Avançado** | Abrir `settings.json` / pasta de dados / exportar diagnóstico | |

---

## 2. Temas

### 2.1 O que cada app traz

- **Orca** (`src/shared/terminal-themes/*.ts`, tipo `ITheme` do xterm): 30 temas de terminal.
  - Escuros: Ghostty Default Style Dark, Tango Dark, Homebrew, Snazzy, Dracula, One Dark, Nord, Monokai, Tokyo Night, Gruvbox Dark, Catppuccin Mocha, Solarized Dark, Material Dark, Ayu Dark, Nightfox, Kanagawa, Rose Pine, Everforest Dark, Palenight, Horizon Dark, Night Owl.
  - Claros: Builtin Tango Light, Solarized Light, One Light, Catppuccin Latte, GitHub Light, Rose Pine Dawn, Gruvbox Light, Tokyo Night Light, Everforest Light.
  - Importa temas do Ghostty, do Warp e de YAML. Tem "Color Overrides" por cor.
  - A UI é neutra no estilo shadcn: `.dark` com `--background #0a0a0a`, `--card #171717`, `--muted #262626`, `--muted-foreground #a1a1a1`, `--border rgb(255 255 255/.07)`, `--destructive #ff6568`, `--status-success #86efac`, `--status-warning #eab308`. O light usa `#fff`, `#f5f5f5`, `#737373`, `#e5e5e5`, `#e40014`, `#15803d` e `#ca8a04`. O accent vem de um seletor de cor.
  - Ajuste que vale copiar: no tema dark padrão o Orca troca a seleção do Ghostty (`#3e4451`) por `#5a7898`, porque a original some sobre blocos cinza das TUIs de agente.
  - No Tango Light, `yellow`, `cyan` e `white` foram escurecidos (`#8e7700`, `#05727e`, `#6a6a6a`) para manter legível a saída colorida do Claude.
- **Wave** (`pkg/wconfig/defaultconfig/termthemes.json`): 7 temas, Default Dark, One Dark Pro, Dracula, Monokai, Campbell, Warm Yellow e Rose Pine. Além das 16 cores, usa as chaves extras `gray` e `cmdtext`. A UI é escura fixa: `--main-bg-color rgb(34,34,34)`, `--main-text-color #f7f7f7`, `--secondary-text-color rgb(195,200,194)`, `--border-color rgba(255,255,255,.16)`, `--accent-color rgb(88,193,66)`, `--error-color rgb(229,77,46)`, `--warning-color rgb(224,185,86)`, `--success-color rgb(78,154,6)`.
- **Tabby**: o padrão é "Tabby Default" (bg `#171717`, fg `#cacaca`) mais "Tabby Default Light", e há **191 esquemas comunitários** em `tabby-community-color-schemes/schemes/`. A ideia mais interessante é o tema de UI **"Follow the color scheme"** (`tabby-core/src/services/themes.service.ts`), que **deriva a UI inteira da paleta do terminal**:
  - `primary = colors[accent]`, `warning = colors[3]`, `danger = colors[1]`, `success = colors[2]`, `info = colors[4]`
  - `--theme-bg-more` / `--theme-bg-less` saem de `lighten`/`darken` do background
  - depois aplica `minimumContrastRatio` (4) a cada par bg/fg e corrige o fg quando falta contraste

  Com isso o Turno pode aceitar qualquer tema de terminal importado sem desenhar os tokens de UI à mão.

### 2.2 Seis temas prontos no formato do Turno (`src/shared/themes.ts`)

O formato segue `UiTokens` + `TermPalette` do Turno. A paleta `term` vem **exatamente** do Orca. Nos temas que o Orca só tem para o terminal (Dracula, Nord, Catppuccin, Tokyo Night), os tokens `ui` usam as cores oficiais de cada paleta: Catppuccin base/mantle/crust/surface0-2/overlay, Nord nord0-nord15, Tokyo Night bg/bg_dark/bg_highlight/comment. O token `run` (azul de "rodando") usa o azul/ciano do próprio tema.

```json
[
  {
    "id": "orca-dark",
    "name": "Orca Escuro (Ghostty)",
    "dark": true,
    "ui": {
      "bg": "#0a0a0a", "surface": "#171717", "surface2": "#1f1f1f", "surface3": "#262626",
      "border": "#ffffff12", "borderStrong": "#ffffff26",
      "text": "#fafafa", "muted": "#a1a1a1", "faint": "#737373",
      "accent": "#1447e6", "ok": "#86efac", "run": "#81a2be", "warn": "#eab308", "err": "#ff6568"
    },
    "term": {
      "background": "#282c34", "foreground": "#ffffff", "cursor": "#ffffff", "cursorAccent": "#282c34",
      "selectionBackground": "#5a7898",
      "black": "#1d1f21", "red": "#cc6666", "green": "#b5bd68", "yellow": "#f0c674",
      "blue": "#81a2be", "magenta": "#b294bb", "cyan": "#8abeb7", "white": "#c5c8c6",
      "brightBlack": "#666666", "brightRed": "#d54e53", "brightGreen": "#b9ca4a", "brightYellow": "#e7c547",
      "brightBlue": "#7aa6da", "brightMagenta": "#c397d8", "brightCyan": "#70c0b1", "brightWhite": "#eaeaea"
    }
  },
  {
    "id": "orca-light",
    "name": "Orca Claro (Tango)",
    "dark": false,
    "ui": {
      "bg": "#ffffff", "surface": "#fafafa", "surface2": "#f5f5f5", "surface3": "#ebebeb",
      "border": "#e5e5e5", "borderStrong": "#d4d4d4",
      "text": "#0a0a0a", "muted": "#737373", "faint": "#a1a1a1",
      "accent": "#171717", "ok": "#15803d", "run": "#3465a4", "warn": "#ca8a04", "err": "#e40014"
    },
    "term": {
      "background": "#ffffff", "foreground": "#2e3434", "cursor": "#2e3434", "cursorAccent": "#ffffff",
      "selectionBackground": "#accef7",
      "black": "#2e3436", "red": "#cc0000", "green": "#4e9a06", "yellow": "#8e7700",
      "blue": "#3465a4", "magenta": "#75507b", "cyan": "#05727e", "white": "#6a6a6a",
      "brightBlack": "#555753", "brightRed": "#ef2929", "brightGreen": "#1b7a1b", "brightYellow": "#6d5a00",
      "brightBlue": "#204a87", "brightMagenta": "#ad7fa8", "brightCyan": "#034b50", "brightWhite": "#3d3d3d"
    }
  },
  {
    "id": "dracula",
    "name": "Dracula",
    "dark": true,
    "ui": {
      "bg": "#282a36", "surface": "#21222c", "surface2": "#2f3241", "surface3": "#383a4a",
      "border": "#343746", "borderStrong": "#44475a",
      "text": "#f8f8f2", "muted": "#a9abbd", "faint": "#6272a4",
      "accent": "#bd93f9", "ok": "#50fa7b", "run": "#8be9fd", "warn": "#f1fa8c", "err": "#ff5555"
    },
    "term": {
      "background": "#282a36", "foreground": "#f8f8f2", "cursor": "#f8f8f2", "cursorAccent": "#282a36",
      "selectionBackground": "#44475a",
      "black": "#21222c", "red": "#ff5555", "green": "#50fa7b", "yellow": "#f1fa8c",
      "blue": "#bd93f9", "magenta": "#ff79c6", "cyan": "#8be9fd", "white": "#f8f8f2",
      "brightBlack": "#6272a4", "brightRed": "#ff6e6e", "brightGreen": "#69ff94", "brightYellow": "#ffffa5",
      "brightBlue": "#d6acff", "brightMagenta": "#ff92df", "brightCyan": "#a4ffff", "brightWhite": "#ffffff"
    }
  },
  {
    "id": "nord",
    "name": "Nord",
    "dark": true,
    "ui": {
      "bg": "#2e3440", "surface": "#3b4252", "surface2": "#434c5e", "surface3": "#4c566a",
      "border": "#3b4252", "borderStrong": "#4c566a",
      "text": "#eceff4", "muted": "#d8dee9", "faint": "#7b88a1",
      "accent": "#88c0d0", "ok": "#a3be8c", "run": "#81a1c1", "warn": "#ebcb8b", "err": "#bf616a"
    },
    "term": {
      "background": "#2e3440", "foreground": "#d8dee9", "cursor": "#d8dee9", "cursorAccent": "#2e3440",
      "selectionBackground": "#434c5e",
      "black": "#3b4252", "red": "#bf616a", "green": "#a3be8c", "yellow": "#ebcb8b",
      "blue": "#81a1c1", "magenta": "#b48ead", "cyan": "#88c0d0", "white": "#e5e9f0",
      "brightBlack": "#4c566a", "brightRed": "#bf616a", "brightGreen": "#a3be8c", "brightYellow": "#ebcb8b",
      "brightBlue": "#81a1c1", "brightMagenta": "#b48ead", "brightCyan": "#8fbcbb", "brightWhite": "#eceff4"
    }
  },
  {
    "id": "catppuccin-mocha",
    "name": "Catppuccin Mocha",
    "dark": true,
    "ui": {
      "bg": "#1e1e2e", "surface": "#181825", "surface2": "#313244", "surface3": "#45475a",
      "border": "#313244", "borderStrong": "#45475a",
      "text": "#cdd6f4", "muted": "#a6adc8", "faint": "#6c7086",
      "accent": "#cba6f7", "ok": "#a6e3a1", "run": "#89b4fa", "warn": "#f9e2af", "err": "#f38ba8"
    },
    "term": {
      "background": "#1e1e2e", "foreground": "#cdd6f4", "cursor": "#f5e0dc", "cursorAccent": "#1e1e2e",
      "selectionBackground": "#585b70",
      "black": "#45475a", "red": "#f38ba8", "green": "#a6e3a1", "yellow": "#f9e2af",
      "blue": "#89b4fa", "magenta": "#f5c2e7", "cyan": "#94e2d5", "white": "#bac2de",
      "brightBlack": "#585b70", "brightRed": "#f38ba8", "brightGreen": "#a6e3a1", "brightYellow": "#f9e2af",
      "brightBlue": "#89b4fa", "brightMagenta": "#f5c2e7", "brightCyan": "#94e2d5", "brightWhite": "#a6adc8"
    }
  },
  {
    "id": "tokyo-night",
    "name": "Tokyo Night",
    "dark": true,
    "ui": {
      "bg": "#1a1b26", "surface": "#16161e", "surface2": "#1f2335", "surface3": "#292e42",
      "border": "#15161e", "borderStrong": "#3b4261",
      "text": "#c0caf5", "muted": "#a9b1d6", "faint": "#565f89",
      "accent": "#7aa2f7", "ok": "#9ece6a", "run": "#7dcfff", "warn": "#e0af68", "err": "#f7768e"
    },
    "term": {
      "background": "#1a1b26", "foreground": "#c0caf5", "cursor": "#c0caf5", "cursorAccent": "#1a1b26",
      "selectionBackground": "#33467c",
      "black": "#15161e", "red": "#f7768e", "green": "#9ece6a", "yellow": "#e0af68",
      "blue": "#7aa2f7", "magenta": "#bb9af7", "cyan": "#7dcfff", "white": "#a9b1d6",
      "brightBlack": "#414868", "brightRed": "#f7768e", "brightGreen": "#9ece6a", "brightYellow": "#e0af68",
      "brightBlue": "#7aa2f7", "brightMagenta": "#bb9af7", "brightCyan": "#7dcfff", "brightWhite": "#c0caf5"
    }
  }
]
```

Paletas extras (só `term`, copiadas do Orca) para quem quiser mais opções:

- **One Dark**: bg `#282c34`, fg `#abb2bf`, cursor `#528bff`, sel `#3e4451`; ANSI `#282c34 #e06c75 #98c379 #e5c07b #61afef #c678dd #56b6c2 #abb2bf` / bright `#5c6370 #e06c75 #98c379 #e5c07b #61afef #c678dd #56b6c2 #ffffff`.
- **Gruvbox Dark**: bg `#282828`, fg `#ebdbb2`, sel `#504945`; ANSI `#282828 #cc241d #98971a #d79921 #458588 #b16286 #689d6a #a89984` / bright `#928374 #fb4934 #b8bb26 #fabd2f #83a598 #d3869b #8ec07c #ebdbb2`.
- **GitHub Light**: bg `#ffffff`, fg `#24292e`, cursor `#044289`, sel `#c8c8fa`; ANSI `#24292e #d73a49 #28a745 #dbab09 #0366d6 #5a32a3 #0598bc #6a737d` / bright `#959da5 #cb2431 #22863a #b08800 #005cc5 #5a32a3 #3192aa #d1d5da`.
- **One Light**: bg `#fafafa`, fg `#383a42`, cursor `#526fff`, sel `#e5e5e6`; ANSI `#383a42 #e45649 #50a14f #c18401 #4078f2 #a626a4 #0184bc #a0a1a7` / bright `#696c77 #e45649 #50a14f #c18401 #4078f2 #a626a4 #0184bc #fafafa`.
- **Campbell** (Windows Terminal, via Wave): bg `#0C0C0C`, fg `#CCCCCC`, sel `#3A96DD77`; ANSI `#0C0C0C #C50F1F #13A10E #C19C00 #0037DA #881798 #3A96DD #CCCCCC` / bright `#767676 #E74856 #16C60C #F9F1A5 #3B78FF #B4009E #61D6D6 #F2F2F2`.
- **Tabby Default**: bg `#171717`, fg `#cacaca`, cursor `#bbbbbb`; ANSI `#000000 #ff615a #b1e969 #ebd99c #5da9f6 #e86aff #82fff7 #dedacf` / bright `#313131 #f58c80 #ddf88f #eee5b2 #a5c7ff #ddaaff #b7fff9 #ffffff`.

---

## 3. Fontes

| | UI | Terminal | Embarcadas |
|---|---|---|---|
| **Orca** | `Geist` (variável 100–900) → `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. `--font-mono: 'SF Mono', SFMono-Regular, ui-monospace, 'Cascadia Code', Menlo, Consolas, 'Liberation Mono', monospace` | Win `Cascadia Mono`, 14px, peso 500/700, line height 1, ligaduras `auto`, cursor block piscando, opacidade do cursor configurável | `Geist-Variable.woff2` e `SymbolsNerdFontMono-Regular.woff2`, registrada como `'Orca Nerd Font Symbols'` e usada como fallback de ícones Nerd Font no terminal |
| **Wave** | `Inter` 14px (`--base-font`), header `700 11px Inter` | `Hack` 12px (`--fixed-font: normal 12px/normal "Hack", monospace`), cursor block sem piscar | `inter-variable.woff2`, `hacknerdmono-{regular,bold,italic,bolditalic}.ttf`, JetBrains Mono (200/400/700) |
| **Tabby** | tema Bootstrap | Win `Consolas` 14px, peso 400/700, `linePadding 0`, `ligatures false`, cursor block piscando, `fallbackFont` | — |

A lista do Orca que decide se a ligadura liga no modo "auto" (`src/shared/terminal-ligatures.ts`, compara pela primeira família da string): fira code, fira mono, jetbrains mono, cascadia code, cascadia mono, iosevka, victor mono, hasklig, monoid, operator mono, dank mono, mononoki, pragmatapro, recursive, monolisa, commit mono, geist mono, maple mono, departure mono. Para ligaduras no xterm é preciso o `@xterm/addon-ligatures`, que o Orca usa.

O Orca usa `FontAutocomplete.tsx`, que sugere as fontes instaladas, para escolher a família.

**Para o Turno:** embarcar `Geist` (UI) e `Symbols Nerd Font Mono` (fallback). Default de terminal `"Cascadia Mono", "Symbols Nerd Font Mono", Consolas, monospace`, porque Cascadia já vem no Windows 11. Ligaduras em `auto`, peso 400/700 e line height 1.0.

---

## 4. Terminal: comportamento

### 4.1 Comparativo

| Recurso | Orca | Wave | Tabby |
|---|---|---|---|
| Copy-on-select | off | **on** | off (Windows **on**) |
| Clique direito | cola no Windows (Ctrl+clique direito abre menu) | menu | Windows `clipboard` (cola), outros `menu` |
| Colar com botão do meio | só Linux (primary selection) | — | on, exceto Windows/Linux |
| Scrollback | 5000 | 2000 (máx. 50000) | 25000 |
| Bell | notificação off por padrão | indicador na aba on, som off | off / visual / audível + piscar a barra de tarefas |
| OSC 52 (TUI escreve no clipboard) | on | `always` (ou `focus`) | — |
| Aviso de colagem multilinha | — | — | on |
| Bracketed paste | xterm padrão | opção `term:allowbracketedpaste` | on |
| Trim ao copiar | `terminalCopyTrimsGutter` (indentação comum) | `term:trimtrailingwhitespace` | `trimWhitespaceOnPaste` |
| Shift+Enter | — | `term:shiftenternewline` → `\u001b\n` | `insert-new-line` Alt+Shift+Enter |
| WebGL | auto com fallback | on (desligável) | `xterm-webgl` |
| Separadores de palavra | configurável | — | `' ()[]{}\'"'` |
| Confirmar fechamento de terminal ocupado | on | `tab:confirmclose` off | — |

### 4.2 Detecção de shell no Windows

**Orca**:
- O menu "+" mostra **PowerShell, CMD Prompt, Git Bash, WSL** (`tab-bar-windows-shell-options.ts`).
- Os valores canônicos são `powershell.exe | pwsh.exe | cmd.exe | wsl.exe | git-bash`. O mapa aceita `powershell`, `pwsh`, `cmd` e `wsl` sem extensão, sem nunca juntar pwsh com powershell.
- PowerShell 7: `src/main/pwsh.ts` roda `pwsh.exe -Version` com timeout de 5s (síncrono) ou 30s (warm-up) e guarda o resultado negativo em cache por 30s. A opção "PowerShell Version" fica em `auto`.
- Git Bash (`src/main/git-bash.ts`):
  1. Para cada raiz em `%ProgramFiles%`, `%ProgramW6432%`, `%ProgramFiles(x86)%` e `%LOCALAPPDATA%`, tenta `Git\bin\bash.exe`, `Git\usr\bin\bash.exe`, `Programs\Git\bin\bash.exe` e `Programs\Git\usr\bin\bash.exe`.
  2. Varre o `PATH`. Se o segmento termina em `...\Git\cmd` ou `PortableGit\cmd`, usa `..\bin\bash.exe`. Se termina em `...\Git`, usa `bin\bash.exe`.
  3. Valida com `isGitForWindowsBashPath` para nunca pegar `System32\bash.exe`, que é o WSL.
- A família de quoting vem de `resolveWindowsShellStartupFamily`: `cmd.exe` usa quoting de cmd; `wsl`/`bash` são POSIX; o resto é PowerShell.

**Wave** (`pkg/util/shellutil/shellutil.go`):
- Shell padrão no Windows: `exec.LookPath("pwsh")`, depois `LookPath("powershell")`, e por fim `"powershell.exe"`.
- Git Bash: procura no PATH, ignorando `system32` e aceitando só diretórios com `git`; depois tenta `%USERPROFILE%\scoop\apps\git\current\bin\bash.exe`, `%LOCALAPPDATA%\programs\git\bin\bash.exe` e `C:\Program Files\Git\bin\bash.exe`. O usuário pode sobrescrever com `term:gitbashpath`.
- A integração com pwsh é injetada via `wavepwsh.ps1`.

**Tabby** (`tabby-electron/src/shells/*`), o mais completo:
- **PowerShell Core**: registro `HKLM` e `HKCU` em `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\pwsh.exe`; depois `%USERPROFILE%\AppData\Local\Microsoft\WindowsApps\pwsh.exe`, `%ProgramFiles%\PowerShell\7\pwsh.exe` e `%ProgramFiles(x86)%\PowerShell\7\pwsh.exe`. Args `-nologo`.
- **Windows PowerShell**: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, args `-nologo`.
- **CMD**: `cmd.exe` (stock) e "CMD (clink)", que roda `cmd.exe /k <clink> inject`.
- **WSL**: lê o registro `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss`. Cria um perfil "WSL / Default distro" e um perfil `WSL / <DistributionName>` por distro com `%windir%\system32\wsl.exe -d <nome>`. Há fallback para `%windir%\system32\bash.exe`.
- **Git Bash**: registro `HKLM`/`HKCU` `Software\GitForWindows`, valor `InstallPath`, executa `<InstallPath>\bin\bash.exe --login -i`.
- Também detecta Cygwin 32/64, MSYS2, Cmder e o prompt de desenvolvedor do Visual Studio.
- **OS default**: o primeiro provedor com resultado na ordem `[pwsh, wsl, stock]`; dentro da lista vence o último item.

**Recomendação para o Turno:** combinar o registro do Tabby (pwsh App Paths, GitForWindows InstallPath, Lxss por distro) com os fallbacks de caminho e PATH do Orca, e validar que o Git Bash não é `System32\bash.exe`. Detectar uma vez no main ao iniciar, guardar em cache e expor `listShells()` via IPC. Default: pwsh, depois powershell. Para o PTY de agentes, sempre `-NoLogo`.

---

## 5. Transcript de agente no Orca ("Chat UI" / native chat) — PRIORIDADE

### 5.1 Arquitetura

- O Orca **não monta a linha de comando à mão**. Usa `query()` do `@anthropic-ai/claude-agent-sdk` com `prompt` = **AsyncIterable de `SDKUserMessage`**, ou seja, um processo `claude` vivo por chat, com stdin stream-json aberto (`src/main/claude/claude-stream-json-connection.ts`).
- Opções base (`claude-structured-launch-resolution.ts`):

```ts
export const CLAUDE_STRUCTURED_BASE_OPTIONS = {
  includePartialMessages: true,                       // --include-partial-messages (deltas de streaming)
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  settingSources: ['user', 'project', 'local'],       // --setting-sources user,project,local
  supportedDialogKinds: [],
  extraArgs: { 'replay-user-messages': null }         // --replay-user-messages (eco = ACK do envio)
}
// pathToClaudeCodeExecutable = o claude instalado do usuário (não o binário do SDK)
// resume: <sessionId> quando já existe transcript; senão sessionId: <uuid> (sessão nova com id fixo)
```

- Flags que o `query()` gera sozinho: `-p --input-format stream-json --output-format stream-json --verbose`, e **`--permission-prompt-tool=stdio`** quando há um callback `canUseTool`.
- Leitura do raciocínio: o Orca passa **`--thinking-display summarized`** quando a versão do CLI suporta (`claude-structured-launch-flags.ts`). O comentário explica que, sem isso, o CLI manda blocos de thinking vazios nesse modo de lançamento. Ele não passa `--thinking`, para respeitar quem desligou o thinking.
- Modos de permissão (`CLAUDE_PERMISSION_MODES`): `ask → 'default'`, `accept-edits → 'acceptEdits'`, `auto → 'auto'`. "full-access" vira a flag `--dangerously-skip-permissions`, e não `permissionMode`, porque binários antigos rejeitam o bypass tipado.
- Flags reservadas ao transporte, que o usuário não pode sobrescrever: `print, input-format, output-format, verbose, resume, continue, session-id, fork-session, resume-session-at, permission-mode, dangerously-skip-permissions, permission-prompt-tool, allowedTools, disallowedTools, replay-user-messages, include-partial-messages, setting-sources, system-prompt*, append-system-prompt*`.
- Env: nunca herda o `process.env` inteiro, para não vazar `ANTHROPIC_*`. Constrói o env do filho e remove `CLAUDE_CONFIG_DIR` herdado. A variável `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS` habilita eventos `system:session_state_changed`.

### 5.2 Formato EXATO da entrada stream-json (stdin)

Uma mensagem por linha, JSON + `\n`.

**Mensagem do usuário** (`claude-structured-dispatch.ts`, o mesmo que o Orca envia):

```json
{"type":"user","uuid":"6b0e…","message":{"role":"user","content":[{"type":"text","text":"rode os testes"}]},"parent_tool_use_id":null,"session_id":"<id da sessão>"}
```

- `message` é um `MessageParam` da Messages API. `content` pode ser string ou array de blocos (`text`, `image` com `{"type":"base64","media_type":"image/png","data":…}`, `document`, `tool_result`).
- Limites de imagem no Orca: 5 MB por imagem, 20 imagens, 20 MB no total.
- `uuid` é gerado pelo cliente. Com `--replay-user-messages`, o CLI devolve no stdout a mesma mensagem `type:"user"` com esse `uuid` (`isReplay: true`). O Orca usa esse eco como prova de que o envio foi aceito.
- O tipo do SDK aceita também `priority?: 'now' | 'next' | 'later'` e `isSynthetic`.
- **Follow-up durante um turno** ("Steer" no Orca): basta escrever outra linha `type:"user"` no stdin; o CLI enfileira. Para retirar uma mensagem ainda na fila existe `cancel_async_message` por uuid.

**Pedidos de controle do cliente para o CLI** (envelope do SDK):

```json
{"type":"control_request","request_id":"req_1_ab12cd","request":{"subtype":"interrupt"}}
{"type":"control_request","request_id":"req_2_…","request":{"subtype":"set_permission_mode","mode":"acceptEdits"}}
{"type":"control_request","request_id":"req_3_…","request":{"subtype":"initialize"}}
{"type":"control_request","request_id":"orca-model-discovery","request":{"subtype":"list_models"}}
```

- `interrupt` aceita `"cancel_queued": true`.
- Outros subtypes usados pelo SDK/Orca: `set_model`, `set_max_thinking_tokens` (com `thinking_display`), `apply_flag_settings`, `stop_task`, `get_settings`, `get_context_usage` (o `/context`), `mcp_message`.
- Resposta do CLI: `{"type":"control_response","response":{"subtype":"success","request_id":"…","response":{…}}}` (ou `subtype:"error"`).
- O Orca usa `initialize` e `list_models` em processos curtos para descobrir os comandos `/` e a lista de modelos sem gastar turno. Nesses probes passa `--strict-mcp-config --settings '{"disableAllHooks":true}'`.
- Timeout padrão do Orca para controles: 30s.

### 5.3 Pedidos de permissão (`--permission-prompt-tool stdio`)

O CLI escreve no stdout:

```json
{"type":"control_request","request_id":"…","request":{
  "subtype":"can_use_tool","tool_name":"Bash","input":{"command":"npm test"},
  "tool_use_id":"toolu_…","permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"npm test:*"}],"behavior":"allow","destination":"session"}],
  "decision_reason":"…","blocked_path":"…","title":"…","display_name":"…","description":"…"}}
```

O cliente responde no stdin:

```json
{"type":"control_response","response":{"subtype":"success","request_id":"<mesmo id>","response":
  {"behavior":"allow","updatedInput":{"command":"npm test"},"toolUseID":"toolu_…"}}}
```

- **"Permitir nesta sessão"**: `{"behavior":"allow","updatedInput":…,"updatedPermissions":<as permission_suggestions recebidas>}`.
- **Negar**: `{"behavior":"deny","message":"User denied this action.","toolUseID":"…"}`. Opcional `"interrupt":true` para parar o turno.
- Se o pedido perdeu a validade (turno interrompido), o CLI pode mandar `{"type":"control_cancel_request","request_id":"…"}`. Nesse caso a UI fecha o card.
- Decisões no Orca (`claude-structured-prompt-replies.ts`): `allow`, `allowForSession`, `deny`, `cancel`.
- Mensagens de negação que o Orca usa:
  - Plano rejeitado (ExitPlanMode): *"The user asked you to keep planning. Revise the plan and call ExitPlanMode again."*
  - Plano dispensado: *"The user dismissed this plan without approving it. End your turn and wait…"*
- **AskUserQuestion** chega pelo mesmo `can_use_tool` (tool `AskUserQuestion`). A resposta é `allow` com `updatedInput: {...input, answers: {<questionId>: "label escolhido" | ["a","b"]}}`. O Orca renderiza isso como card de perguntas, com Submit, campo "Other" e multiSelect.

### 5.4 Saída (stdout): tipos de frame que o Orca trata

Fonte: `src/main/native-chat/agent-session-wire/claude-stream-json-frame-schema.ts`, SDK 0.3.251 / Claude Code 2.1.258.

- Mensagens: `assistant`, `user` (tool_result e replays), `result` (`success`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries`).
- `system:init`.
- Streaming (`--include-partial-messages`): `stream_event` com `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop` e `ping`.
- `system:*`: `compact_boundary`, `status`, `api_retry`, `hook_started`, `hook_progress`, `hook_response`, `task_started`, `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed`, `thinking_tokens`, `session_state_changed`, `permission_denied`, `local_command_output`, `notification`, `files_persisted`, `memory_recall`, `informational`, `model_refusal_fallback`.
- Outros: `tool_progress`, `tool_use_summary`, `auth_status`, `rate_limit_event`, `prompt_suggestion`, `conversation_reset`, `command_lifecycle`.
- `parent_tool_use_id != null` identifica um frame de **subagente** (Task), que o Orca agrupa sob a chamada-pai (`claude-subagent-linkage.ts`).
- Frames desconhecidos vão para `unhandled-provider-frame.ts` em vez de aparecerem como JSON cru.

### 5.5 Como a UI renderiza (`src/renderer/src/components/native-chat/`)

- **Mensagem do usuário** (`NativeChatUserMessageRow`, `NativeChatUserMessageFold`): balão com fundo `--chat-user-surface` (mistura de 7% do fg sobre o canvas no dark) e borda `--chat-user-border`. Mensagens longas ficam dobradas ("mostrar mais"). Tem botão copiar e ação "Rewind" (voltar a partir daqui).
- **Raciocínio** (`NativeChatReasoningRow` + `NativeChatReasoningDisclosure`):
  - Linha recolhida com ícone `brain` e o título "Thought for 12s", "Thought" ou "Reasoning".
  - Chevron que só aparece no hover e gira 90° quando aberto.
  - Corpo em markdown com tom "faint", `text-sm`, `max-h-80 overflow-y-auto`: limitado e rolável, para não crescer sem fim durante o streaming.
  - O estado aberto/fechado fica num `disclosure-store` por chave, então sobrevive à virtualização.
- **Ferramentas** (`NativeChatToolRun`, `NativeChatToolLine`, `shared/native-chat-tool-*.ts`):
  - Chamadas consecutivas formam um **"tool run"** com uma frase-resumo por categoria. No passado: "Read 3 files", "Ran 2 commands", "Edited 1 file", "Searched 4 times", "Listed 1 directory", "Searched the web 2 times", "Used 1 integration", "Ran 1 agent", "Updated the plan", "Used 3 tools". No presente, enquanto roda: "Reading 3 files", "Running 2 commands" etc.
  - Cada linha do run tem um verbo por estado: `Running/Ran`, `Reading/Read/Tried to read`, `Editing/Edited/Tried to edit`, `Searching/Searched`, `Listing/Listed`, `Fetching/Fetched`, `Subagent`. O alvo é o nome do arquivo (basename) ou o comando resumido; o caminho completo fica no tooltip.
  - Categorias: Bash → command; Read → read; Edit/Write/MultiEdit → fileChange; Grep/Glob → search; LS → listFiles; WebFetch/WebSearch; mcp__* → mcpToolCall; Task → subAgentActivity; TodoWrite → todoList.
  - Ao **expandir** uma linha (disclosure lembrado por chave): edições aparecem como **diff** (`NativeChatDiffView`, gerado do `input` do Edit); o comando completo aparece com syntax highlight; a saída aparece num `<pre>` `max-h-64` rolável, com borda `--chat-code-border` e fundo `--chat-code-surface`, truncada por `truncateToolDetail`, e **em vermelho se `is_error`**. O resultado é desenhado dentro da linha da chamada (pareado pelo `tool_use_id`), nunca como uma linha "Result" separada.
  - TodoWrite vira uma lista de tarefas acoplada (`NativeChatDockedTaskList`). Subagentes viram uma seção recolhível (`NativeChatSubagentRun`).
- **Texto do assistente**: markdown com streaming suave (`NativeChatPacedMarkdown`), blocos de código com botão copiar e caminhos de arquivo clicáveis.
- **Status do turno** (`NativeChatWorkingStatus`, `NativeChatTurnActivityLine`): linha "trabalhando…" com o que está acontecendo agora e um anel de uso de contexto (`NativeChatContextUsageRing`, via `get_context_usage`).
- **Composer** (`NativeChatComposer*`):
  - Textarea auto-expansível. Enter envia, Shift+Enter quebra linha, e o tratamento de IME evita enviar no meio de uma composição.
  - Botão Enviar vira **Parar** durante o turno.
  - `/` abre o autocomplete de comandos e skills, vindo do `initialize`. `@` faz referência a arquivos.
  - Anexar ou colar imagem. Pílulas de modelo, esforço e modo de permissão (`NativeChatPermissionModePicker`), aplicadas ao vivo via `set_model` / `set_permission_mode`.
  - O rascunho persiste em IndexedDB.
- **Fila de follow-ups** (`NativeChatQueuedMessageCard`, setting `nativeChatQueueFollowUps: true`): o que se envia durante o turno vira card na fila, com ações **Send** ("enviar agora") e **Steer** (injetar no turno em andamento), editar e apagar. Estados: "Paused", "Sending…".
- **Permissão** (`NativeChatApprovalCard`): card inline no transcript com título (ex.: "Run command"), o comando ou diff, e botões Allow / Allow for session / Deny, mais o Cancel do card. Perguntas usam `NativeChatStructuredQuestionCard`.
- **Retomada**: depois de reiniciar o app, o Orca oferece "Resume work on restart" (`NativeChatResumeOnRestartModal`) e relança com `resume: <sessionId>`.

### 5.6 Follow-up: stdin vivo × `--resume`

- **Processo vivo com `--input-format stream-json`** (o que o Orca faz e o Turno já começou a fazer): follow-ups são linhas novas no stdin, o interrupt sai por `control_request`, e há permissões interativas e troca de modelo ou modo ao vivo. É o melhor para runs ad-hoc e para quando a UI está aberta.
- **`--resume <session_id>`** com um processo novo: para continuar uma run **já terminada** (rotina agendada que acabou, app reiniciado). O `session_id` vem do `system:init` ou do `result`. O Orca guarda o leaf uuid e decide sozinho entre `resume` (transcript existe) e `sessionId` (id novo fixo).
- Para o Turno: rotina agendada roda com stdin stream-json e escreve só a primeira mensagem. Ao abrir a run na UI, se o processo ainda vive, o follow-up vai pelo stdin; se morreu, relança com `--resume <id>` + stdin stream-json e mantém o mesmo transcript na tela.

---

## 6. Atalhos de teclado

### 6.1 Orca: registry tipado + editor visual + arquivo

- Registry em `src/shared/keybindings/definitions-core-*.ts`. Cada item tem `{id, title, group, scope, searchKeywords, defaultBindings: {darwin,linux,win32}, conflictGroup}`. Os escopos são `global | tabs | terminal | browser | editor | fileExplorer | composer | chat | settings`.
- Overrides do usuário ficam em `~/.orca/keybindings.json`, com ações para abrir no VS Code ou Cursor, revelar no explorador e "Reload from Disk".
- O pane **Shortcuts** tem:
  - busca "Search command or keys" (procura por nome **ou** pela combinação);
  - filtros de status;
  - em cada linha, botões "Change shortcut", "Add shortcut" (vários bindings por ação) e remover;
  - um gravador ("Press keys…", "Listening for shortcut", Escape cancela);
  - aviso de conflito;
  - **"Shortcuts in Terminal: Orca first / Terminal first"**, que decide quem intercepta primeiro quando o terminal está focado.
- Defaults no Windows (Mod = Ctrl):

| Ação | Atalho |
|---|---|
| Go to File | Ctrl+P |
| Switch worktree | Ctrl+Shift+J |
| Toggle Sidebar / Right Sidebar | Ctrl+B / Ctrl+L |
| New terminal tab / Close tab / Reopen closed | Ctrl+T / Ctrl+W / Ctrl+Shift+T |
| Next / previous tab (todos os tipos) | Ctrl+Shift+] / Ctrl+Shift+[ |
| Tab recente | Ctrl+Tab |
| Next / prev terminal tab | Ctrl+PageDown / Ctrl+PageUp |
| Select Tab 1–9 | Alt+1…9 |
| Select Workspace 1–9 | Ctrl+1…9 |
| Split right / down | Ctrl+Shift+D / Alt+Shift+D |
| Focus next / prev pane | Ctrl+] / Ctrl+[ |
| Maximize pane | Ctrl+Shift+Enter |
| Close pane | Ctrl+W |
| Copy / Paste no terminal | Ctrl+Shift+C ou Ctrl+C com seleção / Ctrl+V, Ctrl+Shift+V, Shift+Insert |
| Select all / Search / Clear | Ctrl+Shift+A / Ctrl+F / Ctrl+K |
| Zoom in / out / reset | Ctrl+= / Ctrl+- / Ctrl+0 |
| Find in chat | Ctrl+F |
| Force reload | Ctrl+Shift+R |
| Open Settings | sem atalho (para não roubar Ctrl+, de TUIs) |

### 6.2 Wave

- Docs em `docs/docs/keybindings.mdx`. No Windows/Linux "Cmd" vira **Alt**.
- Alt+T nova aba; Alt+N novo bloco; Alt+D split à direita; Alt+Shift+D split abaixo.
- Chords `Ctrl+Shift+S` + seta para split direcional, com 2s para a segunda tecla.
- Alt+W fecha bloco; Alt+Shift+W fecha aba; Alt+M magnify; Ctrl+Shift+1–9 vai para o bloco N.
- Segurar Ctrl+Shift mostra o número de cada bloco por cima. `Ctrl+Shift+setas` ou `h/j/k/l` navega entre blocos.
- Terminal: Ctrl+Shift+C/V, Ctrl+V (só Windows), Alt+K limpa, Alt+F busca, Shift+Home/End, Shift+PgUp/PgDn.
- Não há editor de atalhos; dá para desligar grupos (`app:disablectrlshiftarrows`).

### 6.3 Tabby

- Defaults em YAML por plataforma.
- Windows:
  - abas: Ctrl+Shift+W fecha, Ctrl+Shift+Z reabre, Ctrl+Shift+R renomeia, Ctrl+Tab / Ctrl+Shift+Right próxima, Alt+1…0 aba N;
  - splits: Ctrl+Shift+S direita, Ctrl+Shift+D abaixo;
  - painéis: Ctrl+Alt+setas navega, Ctrl+Alt+Enter maximiza, segurar Ctrl+Shift reorganiza;
  - perfis e comandos: Ctrl+Shift+E profile selector, Ctrl+Shift+P command palette;
  - F11 / Alt+Enter tela cheia.
- Terminal no Windows: Ctrl+Shift+C/V, Shift+Insert, Ctrl+Shift+A, Ctrl+Shift+F, Ctrl+=/−/0 zoom, Alt+Shift+Enter nova linha, Ctrl+PgUp/PgDn topo/fim.
- **UI de hotkeys** (`hotkeySettingsTab.component.pug`): busca "Search hotkeys"; cada linha tem o nome da ação (tooltip com o id, clique copia) e um `multi-hotkey-input` com vários atalhos por ação, cada um com X para remover e "+" para gravar num modal. `detectDuplicates` marca conflitos em vermelho. Suporta sequências do tipo `Ctrl-K, Ctrl-S`.

### 6.4 Atalhos sugeridos para o Turno (Windows)

| Ação | Atalho |
|---|---|
| Paleta de comandos | Ctrl+Shift+P |
| Nova run ad-hoc | Ctrl+N |
| Novo terminal | Ctrl+T |
| Split direita / abaixo | Alt+Shift+= / Alt+Shift+- (já existem) |
| Maximizar / fechar painel | Ctrl+Shift+M / Ctrl+Shift+W (já existem) |
| Focar painel próximo / anterior | Ctrl+] / Ctrl+[ |
| Ir para painel N | Alt+1…9 |
| Rotinas / Histórico / Settings | Ctrl+1 / Ctrl+2 / Ctrl+, |
| Buscar no terminal ou transcript | Ctrl+F |
| Parar run (interrupt) | Esc no transcript; Ctrl+. global |
| Enviar follow-up / nova linha | Enter / Shift+Enter |
| Copiar / colar no terminal | Ctrl+Shift+C ou Ctrl+C com seleção / Ctrl+V, Ctrl+Shift+V, Shift+Insert |
| Zoom UI | Ctrl+= / Ctrl+- / Ctrl+0 |
| Recolher/expandir todas as ferramentas | Ctrl+Shift+E |

Modelo de dados igual ao do Orca: `defaultBindings` por plataforma e overrides em `%APPDATA%\turno\keybindings.json`. A política "Turno first / Terminal first" vale para quando o foco está no xterm.

---

## 7. O que trazer para o Turno (ranking)

1. **Protocolo stream-json completo no runner.** Somar ao que já existe (`-p --input-format stream-json --output-format stream-json --verbose`):
   - `--include-partial-messages`, para streaming de texto e thinking;
   - `--replay-user-messages`, cujo eco com `uuid` serve de ACK do envio;
   - `--thinking-display summarized`, para o raciocínio vir legível;
   - `--permission-prompt-tool stdio` nas runs ad-hoc, para cards de permissão;
   - `uuid` gerado pelo Turno em cada mensagem `type:"user"`;
   - parar via `{"type":"control_request","request_id":…,"request":{"subtype":"interrupt"}}` antes de cair no `taskkill /T`.
2. **Card de permissão inline**: tratar `control_request/can_use_tool` e responder `control_response` com `allow` / `allow` + `updatedPermissions` (sessão) / `deny`. Fechar o card ao receber `control_cancel_request`. Renderizar AskUserQuestion como formulário (`updatedInput.answers`).
3. **Transcript no estilo Orca**:
   - raciocínio recolhido ("Pensou por 12s"), com corpo limitado a `max-h-80`;
   - ferramentas agrupadas em "tool runs" com frase-resumo ("Leu 3 arquivos, rodou 2 comandos"), cada linha expansível mostrando diff, comando e saída (`max-h-64`, vermelha se erro);
   - estado de disclosure guardado por chave;
   - subagentes agrupados por `parent_tool_use_id`.
4. **Composer de follow-up com fila**: Enter envia e Shift+Enter quebra linha. O botão vira Parar. Mensagens enviadas durante o turno ficam em fila, com "Enviar agora" e "Steer". Se o processo morreu, relançar com `--resume <session_id>` no mesmo painel.
5. **Settings com busca**: registry de opções com `title/description/keywords`, painel lateral (Geral, Aparência, Terminal, Agentes, Chat, Notificações, Atalhos, Avançado), preview ao vivo do terminal e flags `DefaultedFor…` para migrar defaults.
6. **Tema de terminal separado por modo** (dark/light), na linha do Orca. Opcionalmente, **UI derivada da paleta** como no "Follow the color scheme" do Tabby, com checagem de contraste mínimo 4:1. Adicionar `orca-dark`/`orca-light` e a seleção ajustada `#5a7898`.
7. **Detecção de shells no Windows**: registro (pwsh App Paths, GitForWindows InstallPath, Lxss por distro), caminhos e PATH como no Orca, validando que não é `System32\bash.exe`. Menu "+" com PowerShell 7, Windows PowerShell, CMD, Git Bash e cada distro WSL.
8. **Comportamento do terminal**: clique direito cola no Windows (Ctrl+clique direito abre menu), Shift+Enter → `\u001b\n` (valor do Wave) para o Claude interativo, aviso de colagem multilinha, OSC 52 ligado, trim da indentação comum ao copiar, opacidade 0.9 nos painéis inativos, confirmação antes de fechar terminal com processo rodando, scrollback de 10k.
9. **Fontes**: embarcar Geist (UI) e Symbols Nerd Font Mono como fallback. Terminal com Cascadia Mono 14, ligaduras `auto` pela lista do Orca (`@xterm/addon-ligatures`) e WebGL `auto` com fallback para DOM.
10. **Editor de atalhos**: registry tipado por plataforma, `keybindings.json` de override, gravador com Escape, vários atalhos por ação, detecção de conflito (Tabby) e política "Turno first / Terminal first" (Orca).
11. **Notificações e energia**: avisar ao terminar, falhar ou pedir permissão; não notificar com a janela focada; "manter acordado durante runs".
12. **Probes baratos** para popular os menus sem gastar turno: `initialize` lista os comandos `/` e as skills, `list_models` lista os modelos. Rodar com `--strict-mcp-config --settings '{"disableAllHooks":true}'`.
