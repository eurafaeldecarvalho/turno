// Temas do Turno: tokens da interface + paleta ANSI do terminal (xterm ITheme).
export interface UiTokens {
  bg: string
  surface: string
  surface2: string
  surface3: string
  border: string
  borderStrong: string
  text: string
  muted: string
  faint: string
  accentText?: string // accent com contraste de texto (derivado)
  okText?: string
  warnText?: string
  errText?: string
  runText?: string
  accent: string
  ok: string
  run: string
  warn: string
  err: string
}

export interface TermPalette {
  background: string
  foreground: string
  cursor: string
  cursorAccent?: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface Theme {
  id: string
  name: string
  dark: boolean
  ui: UiTokens
  term: TermPalette
}

const ansi = (a: string[]) => ({
  black: a[0], red: a[1], green: a[2], yellow: a[3], blue: a[4], magenta: a[5], cyan: a[6], white: a[7],
  brightBlack: a[8], brightRed: a[9], brightGreen: a[10], brightYellow: a[11], brightBlue: a[12], brightMagenta: a[13], brightCyan: a[14], brightWhite: a[15],
})

// Mistura linear de duas cores hex de 6 digitos (t=0 => a, t=1 => b).
const toRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')
const mix = (a: string, b: string, t: number): string => {
  const [r1, g1, b1] = toRgb(a)
  const [r2, g2, b2] = toRgb(b)
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

// Contraste WCAG entre duas cores (1..21).
const luminance = (hex: string): number => {
  const [r, g, b] = toRgb(hex).map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

// Deriva os tokens da UI a partir da paleta do terminal, mantendo o mesmo "peso" visual em todos os temas.
// Evita escrever 14 cores de UI a mao por tema (DRY): a paleta ANSI autoritativa manda, a UI acompanha.
// Se a cor "bright" coincidir com o texto (ex. Solarized, onde bright* sao tons de cinza = fg),
// cai na cor base, que tem contraste. Evita accent/estado invisiveis.
// Cor de status precisa ter cor: se a variante "bright" e igual ao texto ou um cinza (Solarized), usa a normal.
const grey = (hex: string): boolean => {
  const [r, g, b] = toRgb(hex)
  return Math.max(r, g, b) - Math.min(r, g, b) < 40
}
const distinct = (c: string, fg: string, base: string): string => (c.toLowerCase() === fg.toLowerCase() || grey(c) ? base : c)

const deriveUi = (p: TermPalette, dark: boolean): UiTokens => {
  const { background: bg, foreground: fg } = p
  return {
    bg,
    surface: mix(bg, fg, dark ? 0.05 : 0.04),
    surface2: mix(bg, fg, dark ? 0.09 : 0.07),
    surface3: mix(bg, fg, dark ? 0.14 : 0.11),
    border: mix(bg, fg, dark ? 0.13 : 0.14),
    borderStrong: mix(bg, fg, dark ? 0.22 : 0.24),
    text: fg,
    muted: mix(fg, bg, 0.35),
    faint: mix(fg, bg, 0.55),
    accent: distinct(dark ? p.brightBlue : p.blue, fg, p.blue),
    ok: distinct(dark ? p.brightGreen : p.green, fg, p.green),
    run: distinct(dark ? p.brightBlue : p.blue, fg, p.blue),
    warn: distinct(dark ? p.brightYellow : p.yellow, fg, p.yellow),
    err: distinct(dark ? p.brightRed : p.red, fg, p.red),
  }
}

// Monta um tema a partir da paleta do terminal; a UI e derivada.
const mk = (id: string, name: string, dark: boolean, bg: string, fg: string, cursor: string, sel: string, a: string[]): Theme => {
  const term: TermPalette = { background: bg, foreground: fg, cursor, cursorAccent: bg, selectionBackground: sel, ...ansi(a) }
  return { id, name, dark, term, ui: deriveUi(term, dark) }
}

const RAW_THEMES: Theme[] = [
  {
    id: 'orca-dark',
    name: 'Orca Dark',
    dark: true,
    ui: {
      bg: '#0a0a0a', surface: '#171717', surface2: '#1f1f1f', surface3: '#262626', border: '#262626', borderStrong: '#333333',
      text: '#fafafa', muted: '#a1a1a1', faint: '#737373', accent: '#3b6cf6', ok: '#86efac', run: '#81a2be', warn: '#eab308', err: '#ff6568',
    },
    term: {
      background: '#0a0a0a', foreground: '#ffffff', cursor: '#ffffff', cursorAccent: '#0a0a0a', selectionBackground: '#5a7898',
      ...ansi(['#1d1f21', '#cc6666', '#b5bd68', '#f0c674', '#81a2be', '#b294bb', '#8abeb7', '#c5c8c6', '#666666', '#d54e53', '#b9ca4a', '#e7c547', '#7aa6da', '#c397d8', '#70c0b1', '#eaeaea']),
    },
  },
  {
    id: 'orca-light',
    name: 'Orca Light',
    dark: false,
    ui: {
      bg: '#ffffff', surface: '#fafafa', surface2: '#f5f5f5', surface3: '#ebebeb', border: '#e5e5e5', borderStrong: '#d4d4d4',
      text: '#0a0a0a', muted: '#737373', faint: '#a1a1a1', accent: '#171717', ok: '#15803d', run: '#3465a4', warn: '#ca8a04', err: '#e40014',
    },
    term: {
      background: '#ffffff', foreground: '#2e3434', cursor: '#2e3434', cursorAccent: '#ffffff', selectionBackground: '#accef7',
      ...ansi(['#2e3436', '#cc0000', '#4e9a06', '#8e7700', '#3465a4', '#75507b', '#05727e', '#6a6a6a', '#555753', '#ef2929', '#1b7a1b', '#6d5a00', '#204a87', '#ad7fa8', '#034b50', '#3d3d3d']),
    },
  },
  {
    id: 'turno-dark',
    name: 'Turno Dark',
    dark: true,
    ui: {
      bg: '#0a0a0b', surface: '#111113', surface2: '#18181b', surface3: '#202024', border: '#232327', borderStrong: '#2e2e33',
      text: '#e4e4e7', muted: '#8b8b94', faint: '#5c5c66', accent: '#f59e0b', ok: '#4ade80', run: '#60a5fa', warn: '#fbbf24', err: '#f87171',
    },
    term: {
      background: '#0a0a0b', foreground: '#e4e4e7', cursor: '#f59e0b', cursorAccent: '#0a0a0b', selectionBackground: '#3f3f4680',
      ...ansi(['#18181b', '#f87171', '#4ade80', '#fbbf24', '#60a5fa', '#c084fc', '#22d3ee', '#d4d4d8', '#52525b', '#fca5a5', '#86efac', '#fde68a', '#93c5fd', '#d8b4fe', '#67e8f9', '#fafafa']),
    },
  },
  {
    id: 'turno-light',
    name: 'Turno Light',
    dark: false,
    ui: {
      bg: '#ffffff', surface: '#f7f7f8', surface2: '#efeff1', surface3: '#e6e6ea', border: '#e4e4e7', borderStrong: '#d4d4d8',
      text: '#18181b', muted: '#52525b', faint: '#8b8b94', accent: '#d97706', ok: '#16a34a', run: '#2563eb', warn: '#b45309', err: '#dc2626',
    },
    term: {
      background: '#ffffff', foreground: '#27272a', cursor: '#d97706', cursorAccent: '#ffffff', selectionBackground: '#d4d4d880',
      ...ansi(['#27272a', '#dc2626', '#16a34a', '#a16207', '#2563eb', '#9333ea', '#0891b2', '#e4e4e7', '#71717a', '#ef4444', '#22c55e', '#ca8a04', '#3b82f6', '#a855f7', '#06b6d4', '#f4f4f5']),
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    dark: true,
    ui: {
      bg: '#282a36', surface: '#21222c', surface2: '#2f3241', surface3: '#383a4a', border: '#343746', borderStrong: '#44475a',
      text: '#f8f8f2', muted: '#a9abbd', faint: '#6272a4', accent: '#bd93f9', ok: '#50fa7b', run: '#8be9fd', warn: '#f1fa8c', err: '#ff5555',
    },
    term: {
      background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', cursorAccent: '#282a36', selectionBackground: '#44475a',
      ...ansi(['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2', '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']),
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    dark: true,
    ui: {
      bg: '#2e3440', surface: '#292e39', surface2: '#3b4252', surface3: '#434c5e', border: '#3b4252', borderStrong: '#4c566a',
      text: '#eceff4', muted: '#a6b0c3', faint: '#7b88a1', accent: '#88c0d0', ok: '#a3be8c', run: '#81a1c1', warn: '#ebcb8b', err: '#bf616a',
    },
    term: {
      background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', cursorAccent: '#2e3440', selectionBackground: '#434c5ecc',
      ...ansi(['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0', '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']),
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    dark: true,
    ui: {
      bg: '#1e1e2e', surface: '#181825', surface2: '#313244', surface3: '#45475a', border: '#313244', borderStrong: '#45475a',
      text: '#cdd6f4', muted: '#a6adc8', faint: '#7f849c', accent: '#cba6f7', ok: '#a6e3a1', run: '#89b4fa', warn: '#f9e2af', err: '#f38ba8',
    },
    term: {
      background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', cursorAccent: '#1e1e2e', selectionBackground: '#585b7080',
      ...ansi(['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de', '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8']),
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    dark: true,
    ui: {
      bg: '#1a1b26', surface: '#16161e', surface2: '#24283b', surface3: '#292e42', border: '#232433', borderStrong: '#3b4261',
      text: '#c0caf5', muted: '#a9b1d6', faint: '#565f89', accent: '#7aa2f7', ok: '#9ece6a', run: '#7dcfff', warn: '#e0af68', err: '#f7768e',
    },
    term: {
      background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', cursorAccent: '#1a1b26', selectionBackground: '#33467c',
      ...ansi(['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6', '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5']),
    },
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    dark: true,
    ui: {
      bg: '#282c34', surface: '#21252b', surface2: '#2c313a', surface3: '#353b45', border: '#2f343d', borderStrong: '#3e4451',
      text: '#dcdfe4', muted: '#abb2bf', faint: '#5c6370', accent: '#61afef', ok: '#98c379', run: '#56b6c2', warn: '#e5c07b', err: '#e06c75',
    },
    term: {
      background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', cursorAccent: '#282c34', selectionBackground: '#3e4451',
      ...ansi(['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf', '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff']),
    },
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    dark: false,
    ui: {
      bg: '#ffffff', surface: '#f6f8fa', surface2: '#eaeef2', surface3: '#d0d7de', border: '#d8dee4', borderStrong: '#d0d7de',
      text: '#1f2328', muted: '#59636e', faint: '#818b98', accent: '#0969da', ok: '#1a7f37', run: '#0969da', warn: '#9a6700', err: '#d1242f',
    },
    term: {
      background: '#ffffff', foreground: '#1f2328', cursor: '#0969da', cursorAccent: '#ffffff', selectionBackground: '#0969da33',
      ...ansi(['#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781', '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f']),
    },
  },
  // ---- Temas populares (paletas de fonte autoritativa: iTerm2-Color-Schemes / Windows Terminal) ----
  mk('gruvbox-dark', 'Gruvbox Dark', true, '#282828', '#ebdbb2', '#ebdbb2', '#665c54',
    ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984', '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2']),
  mk('gruvbox-light', 'Gruvbox Light', false, '#fbf1c7', '#3c3836', '#3c3836', '#d5c4a1',
    ['#fbf1c7', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#7c6f64', '#928374', '#9d0006', '#79740e', '#b57614', '#076678', '#8f3f71', '#427b58', '#3c3836']),
  mk('solarized-dark', 'Solarized Dark', true, '#002b36', '#839496', '#ffffff', '#073642',
    ['#002b36', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5', '#073642', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']),
  mk('solarized-light', 'Solarized Light', false, '#fdf6e3', '#657b83', '#002b36', '#268bd233',
    ['#002b36', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5', '#073642', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']),
  mk('monokai-pro', 'Monokai Pro', true, '#2d2a2e', '#fcfcfa', '#c1c0c0', '#5b595c',
    ['#2d2a2e', '#ff6188', '#a9dc76', '#ffd866', '#fc9867', '#ab9df2', '#78dce8', '#fcfcfa', '#727072', '#ff6188', '#a9dc76', '#ffd866', '#fc9867', '#ab9df2', '#78dce8', '#fcfcfa']),
  mk('one-light', 'One Light', false, '#f9f9f9', '#2a2c33', '#bbbbbb', '#d0dffc',
    ['#000000', '#de3e35', '#3f953a', '#d2b67c', '#2f5af3', '#950095', '#3f953a', '#bbbbbb', '#000000', '#de3e35', '#3f953a', '#d2b67c', '#2f5af3', '#a00095', '#3f953a', '#ffffff']),
  mk('github-dark', 'GitHub Dark', true, '#0d1117', '#e6edf3', '#2f81f7', '#58a6ff40',
    ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4', '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#ffffff']),
  mk('catppuccin-latte', 'Catppuccin Latte', false, '#eff1f5', '#4c4f69', '#dc8a78', '#1e66f533',
    ['#bcc0cc', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#5c5f77', '#acb0be', '#e7103f', '#46b02f', '#e49931', '#3878f6', '#ef95d7', '#19a1a8', '#6c6f85']),
  mk('catppuccin-frappe', 'Catppuccin Frappé', true, '#303446', '#c6d0f5', '#f2d5cf', '#626880',
    ['#51576d', '#e78284', '#a6d189', '#e5c890', '#8caaee', '#f4b8e4', '#81c8be', '#b5bfe2', '#626880', '#eda0a2', '#b9dba2', '#ecd7ae', '#adc2f3', '#f38ed8', '#98d2ca', '#a5adce']),
  mk('catppuccin-macchiato', 'Catppuccin Macchiato', true, '#24273a', '#cad3f5', '#f4dbd6', '#5b6078',
    ['#494d64', '#ed8796', '#a6da95', '#eed49f', '#8aadf4', '#f5bde6', '#8bd5ca', '#b8c0e0', '#5b6078', '#f2a7b2', '#bde3b0', '#f4e3c1', '#adc5f7', '#f493da', '#a5ded6', '#a5adcb']),
  mk('night-owl', 'Night Owl', true, '#011627', '#d6deeb', '#7e57c2', '#5f7e97',
    ['#011627', '#ef5350', '#22da6e', '#addb67', '#82aaff', '#c792ea', '#21c7a8', '#ffffff', '#575656', '#ef5350', '#22da6e', '#ffeb95', '#82aaff', '#c792ea', '#7fdbca', '#ffffff']),
  mk('ayu-dark', 'Ayu Dark', true, '#0b0e14', '#bfbdb6', '#e6b450', '#409fff',
    ['#11151c', '#ea6c73', '#7fd962', '#f9af4f', '#53bdfa', '#cda1fa', '#90e1c6', '#c7c7c7', '#686868', '#f07178', '#aad94c', '#ffb454', '#59c2ff', '#d2a6ff', '#95e6cb', '#ffffff']),
  mk('ayu-mirage', 'Ayu Mirage', true, '#1f2430', '#cccac2', '#ffcc66', '#409fff',
    ['#171b24', '#ed8274', '#87d96c', '#facc6e', '#6dcbfa', '#dabafa', '#90e1c6', '#c7c7c7', '#686868', '#f28779', '#d5ff80', '#ffd173', '#73d0ff', '#dfbfff', '#95e6cb', '#ffffff']),
  mk('rose-pine', 'Rosé Pine', true, '#191724', '#e0def4', '#e0def4', '#403d52',
    ['#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4', '#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4']),
  mk('everforest-dark', 'Everforest Dark', true, '#1e2326', '#d3c6aa', '#e69875', '#4c3743',
    ['#7a8478', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#f2efdf', '#a6b0a0', '#f85552', '#8da101', '#dfa000', '#3a94c5', '#df69ba', '#35a77c', '#fffbef']),
  mk('kanagawa-wave', 'Kanagawa Wave', true, '#1f1f28', '#dcd7ba', '#dcd7ba', '#2d4f67',
    ['#090618', '#c34043', '#76946a', '#c0a36e', '#7e9cd8', '#957fb8', '#6a9589', '#c8c093', '#727169', '#e82424', '#98bb6c', '#e6c384', '#7fb4ca', '#938aa9', '#7aa89f', '#dcd7ba']),
]

// Texto secundario (muted/faint) aparece em 11-12px na sidebar e na status bar: puxa para a cor do texto
// ate passar 4.6:1 sobre o fundo. Temas que ja passam nao mudam.
// Contra o pior dos fundos onde o texto aparece (pagina, cards, campos).
export const ensureContrast = (c: string, bgs: string[], text: string, min = 4.6): string => {
  const worst = (v: string): number => Math.min(...bgs.map((b) => contrast(v, b)))
  const target = Math.min(min, worst(text)) // tema cujo proprio texto nao chega la: empata com ele
  for (let k = 0; k <= 1; k += 0.02) {
    const v = mix(c, text, k)
    if (worst(v) >= target) return v
  }
  return text
}
export const THEMES: Theme[] = RAW_THEMES.map((t) => {
  const bgs = [t.ui.bg, t.ui.surface, t.ui.surface2, t.ui.surface3]
  // cor como TEXTO (pilulas, chips, "On"): legivel sobre os fundos e sobre o proprio tom (pilula = cor ~15% sobre
  // qualquer superficie). Vai para branco/preto, nao para o texto do tema: assim nao vira cinza (Solarized).
  const extreme = t.dark ? '#ffffff' : '#000000'
  const asText = (c: string): string => ensureContrast(c, [...bgs, ...bgs.map((b) => mix(b, c, 0.15))], extreme, 4.6)
  return {
    ...t,
    ui: {
      ...t.ui,
      muted: ensureContrast(t.ui.muted, bgs, t.ui.text),
      faint: ensureContrast(t.ui.faint, bgs, t.ui.text),
      accentText: asText(t.ui.accent),
      okText: asText(t.ui.ok),
      warnText: asText(t.ui.warn),
      errText: asText(t.ui.err),
      runText: asText(t.ui.run),
    },
  }
})

export const themeById = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]
