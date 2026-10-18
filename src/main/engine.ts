import { spawn, execFile } from 'node:child_process'
import { Cron } from 'croner'
import type { FSWatcher } from 'node:fs'
import type { Routine, RunRecord, RunRequest, RunTrigger } from '../shared/types'
import { cronExpressions, loadRoutines, runsBetween, watchRoutines } from './routines'
import { getArmedAt, getRun, hasRunFor, insertRun, lastRuns, setArmed, updateRun } from './db'
import { acquireWait, tryAcquire } from './locks'
import { changed, isRoutineRunning, newRunId, readRequest, sendToRun, startRun } from './runner'
import { childEnv } from './env'

// Agendador: carrega as pastas, cria um cron por horario e dispara rotinas com travas e prechecks.
let routines: Routine[] = []
let jobs: Cron[] = []
let watcher: FSWatcher | undefined
let root = ''
let onRoutinesChanged: (rs: Routine[]) => void = () => {}

const QUEUE_WAIT_MS = 45 * 60_000

export function getRoutines(): Routine[] {
  const last = lastRuns()
  return routines.map((r) => ({ ...r, lastRun: last.get(r.id) }))
}

export function findRoutine(id: string): Routine | undefined {
  return routines.find((r) => r.id === id)
}

export function startEngine(dir: string, onChanged: (rs: Routine[]) => void): void {
  onRoutinesChanged = onChanged
  setRoot(dir)
}

export function setRoot(dir: string): void {
  root = dir
  watcher?.close()
  reload()
  watcher = watchRoutines(root, reload)
}

export function reload(): void {
  routines = loadRoutines(root)
  jobs.forEach((j) => j.stop())
  jobs = []
  for (const r of routines) {
    if (r.error) continue
    if (!r.config.enabled) {
      setArmed(r.id, null)
      continue
    }
    // "Armada" = desde quando a rotina esta ligada; catch-up nunca roda horarios anteriores a isso.
    if (!getArmedAt(r.id)) setArmed(r.id, new Date().toISOString())
    for (const expr of cronExpressions(r.config)) {
      jobs.push(
        new Cron(expr, { timezone: r.config.timezone }, () => {
          const at = new Date()
          at.setSeconds(0, 0)
          void runRoutine(r.id, 'cron', at.toISOString())
        }),
      )
    }
  }
  onRoutinesChanged(getRoutines())
}

// Ao iniciar o app e ao acordar o PC: roda UMA vez o horario perdido mais recente dentro da janela.
export function catchUp(): void {
  const now = new Date()
  for (const r of routines) {
    if (r.error || !r.config.enabled || !r.config.catchup) continue
    const armed = getArmedAt(r.id)
    if (!armed) continue
    const windowStart = new Date(Math.max(now.getTime() - r.config.catchup_window_h * 3_600_000, Date.parse(armed)))
    const missed = runsBetween(r.config, windowStart, new Date(now.getTime() - 60_000))
    const latest = missed.at(-1)
    if (latest && !hasRunFor(r.id, latest.toISOString())) void runRoutine(r.id, 'catchup', latest.toISOString())
  }
}

function skip(r: Routine, trigger: RunTrigger, scheduledAt: string | undefined, reason: string, existing?: string): void {
  const runId = existing ?? newRunId()
  if (existing) updateRun(runId, { status: 'skipped', skip_reason: reason, ended_at: new Date().toISOString() })
  else
    insertRun({
      id: runId,
      routine: r.id,
      trigger,
      status: 'skipped',
      scheduled_at: scheduledAt ?? null,
      profile: r.config.profile,
      model: r.config.model,
      cwd: r.dir,
      skip_reason: reason,
    })
  changed(runId)
  onRoutinesChanged(getRoutines())
}

function requiredLocks(r: Routine): string[] {
  const s = new Set(r.config.locks)
  if (r.config.chrome) s.add('chrome')
  if (r.config.profile === 'qwen-local') s.add('gpu')
  return [...s]
}

async function ollamaUp(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/version', { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

async function ensureOllama(): Promise<boolean> {
  if (await ollamaUp()) return true
  spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: childEnv() }).unref()
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    if (await ollamaUp()) return true
  }
  return false
}

function claudeLoggedIn(): Promise<boolean> {
  return new Promise((res) =>
    execFile('claude', ['auth', 'status'], { env: childEnv(), timeout: 30_000, windowsHide: true }, (err, out) => {
      try {
        res(!err && JSON.parse(out).loggedIn === true)
      } catch {
        res(false)
      }
    }),
  )
}

function runPrecheck(cmd: string, cwd: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, { cwd, shell: true, windowsHide: true, env: childEnv() })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    const t = setTimeout(() => p.kill(), 5 * 60_000)
    p.on('close', (code) => {
      clearTimeout(t)
      res({ ok: code === 0, out: out.trim().slice(-300) })
    })
  })
}

export function buildPrompt(r: Routine, trigger: RunTrigger, scheduledAt?: string): string {
  const quando = new Date().toLocaleString('pt-BR', { timeZone: r.config.timezone })
  const agendado = scheduledAt ? new Date(scheduledAt).toLocaleString('pt-BR', { timeZone: r.config.timezone }) : '-'
  return [
    `[Turno] Execução da rotina "${r.config.name}" (${trigger}). Agora: ${quando}. Horário agendado: ${agendado}.`,
    'Ninguém está acompanhando esta execução: não faça perguntas nem peça confirmação; siga as instruções e, em caso de dúvida, registre e siga em frente.',
    '',
    r.prompt,
  ].join('\n')
}

export async function runRoutine(id: string, trigger: RunTrigger, scheduledAt?: string): Promise<string | undefined> {
  const r = findRoutine(id)
  if (!r) throw new Error(`rotina "${id}" não encontrada`)
  if (r.error) throw new Error(`rotina com erro: ${r.error}`)
  // Mesmo horario ja tratado (cron atrasado depois de acordar + catch-up): ignora em silencio.
  if (scheduledAt && hasRunFor(id, scheduledAt)) return undefined
  if (isRoutineRunning(id)) return void skip(r, trigger, scheduledAt, 'execução anterior ainda rodando')

  // Registra ja como "na fila" para o historico mostrar e o dedupe por horario funcionar.
  const runId = newRunId()
  insertRun({
    id: runId,
    routine: id,
    trigger,
    status: 'queued',
    scheduled_at: scheduledAt ?? null,
    profile: r.config.profile,
    model: r.config.model,
    cwd: r.dir,
  })
  changed(runId)

  if (r.config.profile === 'qwen-local' && !(await ensureOllama()))
    return void skip(r, trigger, scheduledAt, 'Ollama fora do ar (tentei iniciar e não subiu)', runId)
  if (r.config.profile === 'claude-max' && !(await claudeLoggedIn()))
    return void skip(r, trigger, scheduledAt, 'Claude Code sem login (rode "claude" e faça /login)', runId)
  if (r.config.precheck) {
    const p = await runPrecheck(r.config.precheck, r.dir)
    if (!p.ok) return void skip(r, trigger, scheduledAt, `precheck saiu com erro: ${p.out || 'sem saída'}`, runId)
  }

  const locks = requiredLocks(r)
  let busy: string | undefined
  if (r.config.lock_policy === 'skip' || trigger === 'manual') {
    const b = tryAcquire(locks, runId)
    busy = b && `trava ocupada: ${b}`
  } else busy = await acquireWait(locks, runId, QUEUE_WAIT_MS)
  if (busy) return void skip(r, trigger, scheduledAt, busy, runId)

  startRun({
    runId,
    routine: id,
    trigger,
    scheduledAt,
    timeoutMin: r.config.timeout_min,
    idleTimeoutMin: r.config.idle_timeout_min,
    req: {
      profile: r.config.profile,
      prompt: buildPrompt(r, trigger, scheduledAt),
      cwd: r.dir,
      model: r.config.model,
      effort: r.config.effort,
      permissionMode: r.config.permission_mode,
      allowedTools: r.config.allowed_tools,
      chrome: r.config.chrome,
    },
  })
  onRoutinesChanged(getRoutines())
  return runId
}

export function routineOf(run: RunRecord): Routine | undefined {
  return run.routine ? findRoutine(run.routine) : undefined
}

// Nova mensagem do usuario: vai direto para a run se ela ainda roda; senao continua a conversa com --resume.
export async function followUp(runId: string, text: string): Promise<{ runId: string; mode: 'live' | 'followup' }> {
  if (sendToRun(runId, text)) return { runId, mode: 'live' }
  const run = getRun(runId)
  if (!run) throw new Error('execução não encontrada')
  if (!run.session_id) throw new Error('esta execução não tem sessão para continuar (ela chegou a iniciar?)')
  const base: RunRequest = readRequest(runId) ?? { profile: run.profile as RunRequest['profile'], prompt: '', cwd: run.cwd ?? undefined }
  const r = run.routine ? findRoutine(run.routine) : undefined
  const locks = r ? requiredLocks(r) : base.chrome ? ['chrome'] : []
  const newId = newRunId()
  const busy = tryAcquire(locks, newId)
  if (busy) throw new Error(`trava ocupada: ${busy} — tente quando a outra rotina terminar`)
  insertRun({
    id: newId,
    routine: run.routine,
    trigger: 'followup',
    status: 'queued',
    profile: base.profile,
    model: base.model ?? null,
    cwd: base.cwd ?? null,
    parent_id: run.id,
  })
  startRun({
    runId: newId,
    routine: run.routine ?? undefined,
    trigger: 'followup',
    timeoutMin: r?.config.timeout_min ?? 60,
    idleTimeoutMin: r?.config.idle_timeout_min ?? 15,
    req: { ...base, prompt: text, resume: run.session_id },
  })
  return { runId: newId, mode: 'followup' }
}
