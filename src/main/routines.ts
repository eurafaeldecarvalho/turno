import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, watch, FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { Cron } from 'croner'

export const MAX_MIN = 10080 // 7 dias

// Mensagem do croner quando a expressao nao vale (undefined = valida).
const cronError = (expr: string): string | undefined => {
  try {
    new Cron(expr, { paused: true })
    return undefined
  } catch (e) {
    return (e as Error).message
  }
}
const validTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
import { WEEKDAYS, type Routine, type RoutineConfig, type RoutineDraft } from '../shared/types'

export const ROUTINE_FILE = 'ROUTINE.md'
const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

// Rotinas antigas usavam nomes em portugues: continuam valendo.
const PT_DAYS: Record<string, string> = { dom: 'sun', seg: 'mon', ter: 'tue', qua: 'wed', qui: 'thu', sex: 'fri', sab: 'sat', 'sáb': 'sat' }
const PT_NOTIFY: Record<string, string> = { falhas: 'failures', sempre: 'always', nunca: 'never' }
const day = z.preprocess((v) => (typeof v === 'string' ? (PT_DAYS[v.toLowerCase()] ?? v.toLowerCase()) : v), z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']))

const schema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  schedule: z
    .object({
      days: z.array(day).default([...WEEKDAYS]),
      times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM')).default([]),
      cron: z
        .string()
        .optional()
        .superRefine((v, ctx) => {
          const err = v?.trim() ? cronError(v.trim()) : undefined
          if (err) ctx.addIssue({ code: 'custom', message: `invalid cron: ${err}` })
        }),
    })
    .default({ days: [...WEEKDAYS], times: [] }),
  timezone: z.string().refine(validTimezone, 'unknown time zone (use an IANA name like America/Sao_Paulo)').default('America/Sao_Paulo'),
  profile: z.string().default('claude-max'),
  model: z.string().default('sonnet'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  permission_mode: z.enum(['manual', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions']).default('dontAsk'),
  allowed_tools: z.array(z.string()).default([]),
  chrome: z.boolean().default(false),
  locks: z.array(z.string()).default([]),
  lock_policy: z.enum(['skip', 'queue']).default('queue'),
  // teto de 7 dias: acima de ~35 mil min o setTimeout do Node estoura e dispara em 1 ms (run morria na hora)
  timeout_min: z.number().int().positive().max(MAX_MIN, 'at most 10080 (7 days)').default(60),
  idle_timeout_min: z.number().int().positive().max(MAX_MIN, 'at most 10080 (7 days)').default(15),
  budget_usd: z.number().positive().optional(),
  abort: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('cost_usd'), limit: z.number().positive() }),
        z.object({ kind: z.literal('steps'), limit: z.number().int().positive() }),
        z.object({ kind: z.literal('duration_min'), limit: z.number().positive() }),
        z.object({ kind: z.literal('session_limit') }),
        z.object({ kind: z.literal('weekly_limit') }),
      ]),
    )
    .optional(),
  sandbox: z.enum(['none', 'docker', 'wsl']).default('none'),
  isolation: z.enum(['none', 'worktree']).default('none'),
  triggers: z.array(z.object({ kind: z.literal('watch'), path: z.string().min(1) })).optional(),
  catchup: z.boolean().default(true),
  catchup_window_h: z.number().positive().max(720, 'at most 720 (30 days)').default(12),
  precheck: z.string().optional(),
  notify: z.preprocess((v) => (typeof v === 'string' ? (PT_NOTIFY[v] ?? v) : v), z.enum(['failures', 'always', 'never'])).default('failures'),
  mcp: z.array(z.string()).optional(),
  strict_mcp: z.boolean().optional(),
  // conta depois do trim (bloco YAML `|` acrescenta uma quebra de linha no fim), igual a UI e ao cardText
  context_card: z.string().refine((s) => s.trim().length <= 2000, 'at most 2000 characters').optional(),
  account_pool: z.boolean().optional(),
})

export function defaultConfig(): RoutineConfig {
  return schema.parse({ name: 'New routine' }) as RoutineConfig
}

// Valida/preenche defaults de um config parcial (usado por recipes e pela importacao do frontmatter).
export function parseConfig(input: unknown): RoutineConfig {
  return schema.parse(input) as RoutineConfig
}

// dias + horarios -> uma expressao cron por horario. "cron" avancado tem prioridade.
export function cronExpressions(c: RoutineConfig): string[] {
  if (c.schedule.cron?.trim()) return [c.schedule.cron.trim()]
  if (!c.schedule.times.length || !c.schedule.days.length) return []
  const dow = c.schedule.days
    .map((d) => WEEKDAYS.indexOf(d))
    .sort((a, b) => a - b)
    .join(',')
  return [...new Set(c.schedule.times)].map((t) => {
    const [h, m] = t.split(':').map(Number)
    return `${m} ${h} * * ${dow}`
  })
}

export function nextRuns(c: RoutineConfig, n = 5, from = new Date()): Date[] {
  const all = cronExpressions(c).flatMap((expr) => new Cron(expr, { timezone: c.timezone }).nextRuns(n, from))
  return all.sort((a, b) => a.getTime() - b.getTime()).slice(0, n)
}

// Horarios agendados entre `from` (exclusive) e `to` (inclusive).
export function runsBetween(c: RoutineConfig, from: Date, to: Date): Date[] {
  return cronExpressions(c)
    .flatMap((expr) => new Cron(expr, { timezone: c.timezone }).nextRuns(500, from))
    .filter((d) => d <= to)
    .sort((a, b) => a.getTime() - b.getTime())
}

function salvage(fm: unknown, issues: { path: PropertyKey[] }[]): RoutineConfig | undefined {
  if (!fm || typeof fm !== 'object' || issues.some((i) => !i.path.length)) return undefined
  const copy = structuredClone(fm) as Record<string, unknown>
  const drops: { arr: unknown[]; i: number }[] = []
  for (const { path } of issues) {
    // desce ate o pai do campo com erro; em lista tira so o item, em objeto so a chave
    let parent: unknown = copy
    for (const k of path.slice(0, -1)) parent = parent && typeof parent === 'object' ? (parent as Record<string, unknown>)[String(k)] : undefined
    const last = path[path.length - 1]
    if (Array.isArray(parent) && typeof last === 'number') drops.push({ arr: parent, i: last })
    else if (parent && typeof parent === 'object') delete (parent as Record<string, unknown>)[String(last)]
  }
  drops.sort((x, y) => y.i - x.i).forEach(({ arr, i }) => arr.splice(i, 1))
  // "enabled: no" e afins (YAML le como texto): na duvida a rotina fica DESLIGADA, nunca no padrao true
  if (issues.some((i) => String(i.path[0]) === 'enabled')) copy.enabled = false
  const r = schema.safeParse(copy)
  return r.success ? (r.data as RoutineConfig) : undefined
}

export function parseRoutine(dir: string, id: string): Routine {
  const raw = readFileSync(join(dir, ROUTINE_FILE), 'utf8').replace(/^﻿/, '')
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const base = { id, dir, prompt: '', nextRuns: [] as string[], mtimeMs: statSync(join(dir, ROUTINE_FILE)).mtimeMs }
  const fallback = (): RoutineConfig => ({ ...defaultConfig(), name: id, enabled: false })
  if (!m) return { ...base, config: fallback(), error: 'ROUTINE.md has no frontmatter (--- ... ---)' }
  const prompt = m[2].trim()
  let fm: unknown
  try {
    fm = parse(m[1]) ?? {}
  } catch (e) {
    return { ...base, config: fallback(), prompt, error: `invalid YAML: ${(e as Error).message}` }
  }
  const r = schema.safeParse(fm)
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    // Mantem tudo o que validou e descarta so os campos com erro: o editor abre com os valores reais
    // (antes caia no padrao e o 1o auto save sobrescrevia nome, dias e horarios do arquivo).
    return { ...base, config: salvage(fm, r.error.issues) ?? fallback(), prompt, error: msg }
  }
  const config = r.data as RoutineConfig
  const routine: Routine = { ...base, config, prompt }
  if (!prompt) routine.error = 'empty prompt (write it below the frontmatter)'
  try {
    routine.nextRuns = config.enabled ? nextRuns(config).map((d) => d.toISOString()) : []
  } catch (e) {
    routine.error = `invalid schedule: ${(e as Error).message}`
  }
  return routine
}

export function loadRoutines(root: string): Routine[] {
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, ROUTINE_FILE)))
    .map((d) => parseRoutine(join(root, d.name), d.name))
    .sort((a, b) => a.config.name.localeCompare(b.config.name, 'pt-BR'))
}

export function serialize(config: RoutineConfig, prompt: string): string {
  const clean: Record<string, unknown> = { ...config }
  if (!config.precheck) delete clean.precheck
  if (config.budget_usd == null) delete clean.budget_usd
  if (clean.sandbox === 'none') delete clean.sandbox // padrao: nao suja o arquivo
  if (clean.isolation === 'none') delete clean.isolation
  // campos novos so aparecem no arquivo quando usados
  if (!config.mcp?.length) delete clean.mcp
  if (!config.strict_mcp) delete clean.strict_mcp
  if (!config.context_card?.trim()) delete clean.context_card
  if (!config.account_pool) delete clean.account_pool
  clean.schedule = config.schedule.cron
    ? { days: config.schedule.days, times: config.schedule.times, cron: config.schedule.cron }
    : { days: config.schedule.days, times: config.schedule.times }
  return `---\n${stringify(clean, { lineWidth: 0 })}---\n\n${prompt.trim()}\n`
}

// Chave do conteudo de uma rotina (o editor manda a que conhece; o save compara com o disco).
export const contentKey = (r: { config: RoutineConfig; prompt: string }): string => JSON.stringify([r.config, r.prompt])

export function saveRoutine(root: string, draft: RoutineDraft): string {
  if (!ID_RE.test(draft.id)) throw new Error('folder name: use only lowercase letters, numbers and hyphens')
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(draft.id)) throw new Error(`folder name: "${draft.id}" is reserved by Windows; pick another`)
  const r = schema.safeParse(draft.config)
  if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  const dir = join(root, draft.id)
  // compare-and-swap: o arquivo mudou no disco desde que o editor o leu (outro editor) -> nao sobrescreve
  if (draft.originalId && existsSync(join(root, draft.originalId, ROUTINE_FILE))) {
    const cur = parseRoutine(join(root, draft.originalId), draft.originalId)
    if (draft.expectContent != null && contentKey(cur) !== draft.expectContent) throw new Error('ROUTINE.md changed on disk')
    // arquivo com erro so e regravado pelo editor (que mostra o que vai substituir); rename/toggle gravariam os padroes por cima
    if (draft.expectContent == null && cur.error) throw new Error(`ROUTINE.md has an error; fix it in Configure first (${cur.error})`)
  }
  if (draft.originalId && draft.originalId !== draft.id && existsSync(dir)) throw new Error(`a routine named "${draft.id}" already exists`)
  if (!draft.originalId && existsSync(join(dir, ROUTINE_FILE))) throw new Error(`a routine named "${draft.id}" already exists`)
  try {
    if (draft.originalId && draft.originalId !== draft.id) renameSync(join(root, draft.originalId), dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, ROUTINE_FILE), serialize(r.data as RoutineConfig, draft.prompt))
  } catch (e) {
    // erro do sistema em texto curto (sem o caminho inteiro)
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') throw new Error('ROUTINE.md is read-only or in use by another program')
    if (code === 'ENOSPC') throw new Error('the disk is full')
    throw e
  }
  return dir
}

export function setRoutineEnabled(root: string, id: string, enabled: boolean): void {
  const r = parseRoutine(join(root, id), id)
  if (r.error && !r.prompt) throw new Error(r.error)
  saveRoutine(root, { id, originalId: id, config: { ...r.config, enabled }, prompt: r.prompt })
}

// fs.watch recursivo funciona no Windows; debounce porque editores gravam em varias etapas.
export function watchRoutines(root: string, onChange: () => void): FSWatcher {
  let t: ReturnType<typeof setTimeout> | undefined
  return watch(root, { recursive: true }, (_ev, file) => {
    if (file && /(^|[\\/])(runs|memory)[\\/]?/.test(String(file))) return
    clearTimeout(t)
    t = setTimeout(onChange, 300)
  })
}
