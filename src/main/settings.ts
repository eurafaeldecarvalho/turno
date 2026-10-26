import { app } from 'electron'
import { join } from 'node:path'
import { readJson, reportBadShape, writeJsonAtomic } from './jsonStore'
import { THEMES } from '../shared/themes'
import type { Settings } from '../shared/types'
import { DEFAULT_CONNECTIONS } from './providers'
import { savedShell } from './platform'
import { existsSync } from 'node:fs'

const file = (): string => join(app.getPath('userData'), 'settings.json')

export const TERMINAL_DEFAULTS: Settings['terminal'] = {
  fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.2,
  letterSpacing: 0,
  fontWeight: 'normal',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  copyOnSelect: true,
  rightClickPaste: true,
  defaultShell: '', // vazio = shell padrao do sistema; o usuario troca se quiser
  drawBoldInBright: true,
  cursorWidth: 1,
  minimumContrastRatio: 1,
  padding: 8,
  ligatures: false,
  windowOpacity: 1,
}

const defaults = (): Settings => ({
  keepAwake: 'auto',
  routinesDir: join(app.getPath('home'), 'rotinas'),
  agentStartDir: '',
  openAtLogin: false,
  ntfyTopic: '',
  ntfyServer: 'https://ntfy.sh',
  theme: 'turno-dark',
  uiFontFamily: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  uiFontSize: 13,
  onboardedAt: '',
  seenVersion: '',
  terminal: TERMINAL_DEFAULTS,
  connections: DEFAULT_CONNECTIONS,
})

let cache: Settings | undefined
let blocked = false // o arquivo existe mas nao foi lido: nao grava por cima

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
// Mesmo tipo do padrao (string/number/boolean/objeto/lista); o resto volta ao padrao.
function sameShape(v: unknown, def: unknown): boolean {
  if (Array.isArray(def)) return Array.isArray(v)
  if (isObj(def)) return isObj(v)
  return typeof v === typeof def
}
const nonEmpty = (v: unknown): boolean => typeof v === 'string' && !!v.trim()
const validConn = (c: unknown): boolean =>
  isObj(c) && nonEmpty(c.id) && nonEmpty(c.name) && (c.kind === 'claude' || (c.kind === 'endpoint' && nonEmpty(c.baseUrl) && nonEmpty(c.model)))
const oneOf = (...xs: unknown[]) => (v: unknown): boolean => xs.includes(v)
const range = (min: number, max: number) => (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
// valores aceitos (mesmas faixas dos controles em Settings); fora disso o campo volta ao padrao
const VALID: Record<string, (v: unknown) => boolean> = {
  keepAwake: oneOf('on', 'auto', 'off'),
  theme: (v) => THEMES.some((t) => t.id === v),
  uiFontSize: range(11, 16),
}
const VALID_TERM: Record<string, (v: unknown) => boolean> = {
  fontSize: range(8, 28),
  lineHeight: range(1, 2),
  letterSpacing: range(-2, 4),
  padding: range(0, 40),
  cursorWidth: range(1, 5),
  minimumContrastRatio: range(1, 21),
  scrollback: range(1000, 100000),
  windowOpacity: range(0.3, 1),
  fontWeight: oneOf('normal', '500', '600'),
  cursorStyle: oneOf('block', 'bar', 'underline'),
  defaultShell: (v) => typeof v === 'string',
  fontFamily: nonEmpty,
}

// Le e limpa: campos com tipo errado (ou conexoes invalidas) somem; devolve quais foram descartados.
function clean(saved: Record<string, unknown>): { s: Partial<Settings>; bad: string[] } {
  const def = defaults() as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const bad: string[] = []
  for (const [k, v] of Object.entries(saved)) {
    if (!(k in def)) out[k] = v // campo desconhecido (versao nova): mantem
    else if (!sameShape(v, def[k]) || (VALID[k] && !VALID[k](v))) bad.push(k)
    else if (k === 'terminal') {
      const t: Record<string, unknown> = {}
      for (const [tk, tv] of Object.entries(v as Record<string, unknown>)) {
        if (tk in TERMINAL_DEFAULTS && (!sameShape(tv, (TERMINAL_DEFAULTS as unknown as Record<string, unknown>)[tk]) || (VALID_TERM[tk] && !VALID_TERM[tk](tv)))) bad.push(`terminal.${tk}`)
        else t[tk] = tv
      }
      out[k] = t
    } else if (k === 'connections') {
      const list = (v as unknown[]).filter(validConn)
      if (list.length !== (v as unknown[]).length) bad.push('connections')
      out[k] = list.length ? list : DEFAULT_CONNECTIONS
    } else out[k] = v
  }
  return { s: out as Partial<Settings>, bad }
}

function load(): void {
  const r = readJson<unknown>(file())
  blocked = !r.ok
  let saved: Partial<Settings> = {}
  if (r.ok && r.data !== undefined) {
    if (!isObj(r.data)) blocked = !reportBadShape(file(), ['the whole file'])
    else {
      const c = clean(r.data)
      saved = c.s
      // quem ja usava o Turno (settings.json de antes da introducao) nao ve a introducao, so as novidades
      if (!('onboardedAt' in r.data)) saved = { ...saved, onboardedAt: 'existing' }
      if (c.bad.length && !reportBadShape(file(), c.bad)) blocked = true
    }
  }
  const terminal = { ...TERMINAL_DEFAULTS, ...(saved.terminal ?? {}) }
  const env = { platform: process.platform, shellEnv: process.env.SHELL, pathEnv: process.env.PATH, exists: existsSync }
  terminal.defaultShell = savedShell(terminal.defaultShell, env)
  cache = { ...defaults(), ...saved, terminal }
}

// settings.json lido de verdade (nao os padroes de quando estava travado): quem apaga/cria coisas a partir dele checa antes
export function settingsReadable(): boolean {
  getSettings()
  return !blocked
}

export function getSettings(): Settings {
  if (!cache) load()
  // Testes/smoke apontam para outra pasta sem mexer no settings.json.
  if (process.env.TURNO_ROUTINES_DIR) return { ...cache!, routinesDir: process.env.TURNO_ROUTINES_DIR }
  return cache!
}

export function setSettings(patch: Partial<Settings>): Settings {
  if (blocked) {
    // nao deu para ler antes: tenta de novo. Destravou = a tela esta com os padroes, nao com o arquivo real;
    // aplicar o patch (secoes inteiras, ex. terminal/connections) apagaria valores reais. Recarrega e pede para refazer.
    load()
    if (blocked) throw new Error('settings.json is in use by another program; the change was not saved')
    throw new Error('settings.json could be read again and was reloaded; make the change again')
  }
  const cur = getSettings()
  const next = { ...cache!, ...patch, terminal: { ...cur.terminal, ...(patch.terminal ?? {}) } }
  writeJsonAtomic(file(), next) // falhou = nada muda na memoria (a mudanca nao vale depois)
  cache = next
  return getSettings()
}
