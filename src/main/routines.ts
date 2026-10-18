import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, watch, FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { Cron } from 'croner'
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
      cron: z.string().optional(),
    })
    .default({ days: [...WEEKDAYS], times: [] }),
  timezone: z.string().default('America/Sao_Paulo'),
  profile: z.enum(['claude-max', 'qwen-local']).default('claude-max'),
  model: z.string().default('sonnet'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  permission_mode: z.enum(['manual', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions']).default('dontAsk'),
  allowed_tools: z.array(z.string()).default([]),
  chrome: z.boolean().default(false),
  locks: z.array(z.string()).default([]),
  lock_policy: z.enum(['skip', 'queue']).default('queue'),
  timeout_min: z.number().int().positive().default(60),
  idle_timeout_min: z.number().int().positive().default(15),
  catchup: z.boolean().default(true),
  catchup_window_h: z.number().positive().default(12),
  precheck: z.string().optional(),
  notify: z.preprocess((v) => (typeof v === 'string' ? (PT_NOTIFY[v] ?? v) : v), z.enum(['failures', 'always', 'never'])).default('failures'),
})

export function defaultConfig(): RoutineConfig {
  return schema.parse({ name: 'New routine' }) as RoutineConfig
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

export function parseRoutine(dir: string, id: string): Routine {
  const raw = readFileSync(join(dir, ROUTINE_FILE), 'utf8').replace(/^﻿/, '')
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const base = { id, dir, prompt: '', nextRuns: [] as string[] }
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
    return { ...base, config: fallback(), prompt, error: msg }
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
  clean.schedule = config.schedule.cron
    ? { days: config.schedule.days, times: config.schedule.times, cron: config.schedule.cron }
    : { days: config.schedule.days, times: config.schedule.times }
  return `---\n${stringify(clean, { lineWidth: 0 })}---\n\n${prompt.trim()}\n`
}

export function saveRoutine(root: string, draft: RoutineDraft): string {
  if (!ID_RE.test(draft.id)) throw new Error('folder name: use only lowercase letters, numbers and hyphens')
  const r = schema.safeParse(draft.config)
  if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  const dir = join(root, draft.id)
  if (draft.originalId && draft.originalId !== draft.id) {
    if (existsSync(dir)) throw new Error(`a routine named "${draft.id}" already exists`)
    renameSync(join(root, draft.originalId), dir)
  } else if (!draft.originalId && existsSync(join(dir, ROUTINE_FILE))) {
    throw new Error(`a routine named "${draft.id}" already exists`)
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, ROUTINE_FILE), serialize(r.data as RoutineConfig, draft.prompt))
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
