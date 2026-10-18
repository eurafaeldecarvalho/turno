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

export const THEMES: Theme[] = [
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
]

export const themeById = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]
