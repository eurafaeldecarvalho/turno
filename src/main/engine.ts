import { spawn } from 'node:child_process'
import { Cron } from 'croner'
import { watch, type FSWatcher } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { debounce, watchShouldSkip } from './triggers'
import type { Connection, Routine, RunRecord, RunRequest, RunTrigger } from '../shared/types'
import { cronExpressions, loadRoutines, runsBetween, watchRoutines } from './routines'
import { duePausedRuns, getArmedAt, getRun, hasRunFor, insertRun, lastRuns, setArmed, threadOf, updateRun } from './db'
import { policiesFromConfig, priorCost } from './abort'
import { acquireWait, release, tryAcquire } from './locks'
import { changed, isRoutineRunning, newRunId, readRequest, sendToRun, startRun } from './runner'
import { childEnv } from './env'
import { findConnection, getConnection, requireConnection } from './providers'
import { getSettings } from './settings'

// Rotina num endpoint (ex. Ollama) roda o modelo da conexao: e o que fica registrado na run.
function effectiveModel(r: Routine): string {
  const c = findConnection(getSettings(), r.config.profile)
  return c?.kind === 'endpoint' && c.model ? c.model : r.config.model
}
import { claudeStatus } from './provider-auth'

const connOf = (profile: string): Connection => getConnection(getSettings(), profile)

// Agendador: carrega as pastas, cria um cron por horario e dispara rotinas com travas e prechecks.
let routines: Routine[] = []
let jobs: Cron[] = []
let watcher: FSWatcher | undefined
let fileWatchers: FSWatcher[] = [] // watchers dos gatilhos file-watch das rotinas
let root = ''
let onRoutinesChanged: (rs: Routine[]) => void = () => {}

const QUEUE_WAIT_MS = 45 * 60_000
const WATCH_COOLDOWN_MS = 30_000 // janela apos uma run em que o file-watch ignora mudancas (anti-loop por self-write)

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
  // Verifica periodicamente se alguma run pausada por limite ja pode retomar (o reset pode cair com o app aberto).
  setInterval(() => void resumePaused(), 120_000)
}

// Retoma runs pausadas por limite de assinatura cujo reset ja passou (--resume automatico).
export async function resumePaused(): Promise<void> {
  for (const run of duePausedRuns(new Date().toISOString())) {
    // Reivindica ANTES do await (zera resume_at): um 2o tick de resumePaused nao pega a mesma run -> sem retomada dupla.
    updateRun(run.id, { resume_at: null })
    changed(run.id)
    try {
      await followUp(run.id, 'Usage limit reset. Continue the task you were working on.')
    } catch (e) {
      const msg = String((e as Error).message)
      if (/lock busy/i.test(msg)) {
        // Transitorio (outra rotina segura o lock): reagenda pra tentar de novo em 5min, sem perder a run.
        updateRun(run.id, { resume_at: new Date(Date.now() + 5 * 60_000).toISOString() })
      } else {
        // Permanente (ex. connection removida): encerra com motivo em vez de ficar 'paused' pra sempre.
        updateRun(run.id, { status: 'failed', skip_reason: `nao retomou: ${msg}`, ended_at: new Date().toISOString() })
      }
      changed(run.id)
    }
  }
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
  fileWatchers.forEach((w) => w.close())
  fileWatchers = []
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
    // Gatilhos file-watch: dispara a rotina (debounced) quando o caminho muda. Caminho relativo = dentro da pasta da rotina.
    for (const t of r.config.triggers ?? []) {
      if (t.kind !== 'watch') continue
      const target = isAbsolute(t.path) ? t.path : join(r.dir, t.path)
      const fire = debounce(() => {
        const rr = findRoutine(r.id)
        if (!rr || rr.error || !rr.config.enabled) return // rotina removida/com erro/desabilitada
        if (isRoutineRunning(r.id)) return // nao enfileira durante a run
        // Pula se a ultima run esta nao-terminal (pausada por limite tem ended_at=null) ou terminou ha < cooldown
        // (a propria run escreve no path observado -> sem isso, a ultima escrita re-dispara em LOOP / duplica no resume).
        if (watchShouldSkip(lastRuns().get(r.id), Date.now(), WATCH_COOLDOWN_MS)) return
        void runRoutine(r.id, 'watch').catch(() => {})
      }, 1000)
      const mk = (recursive: boolean): void => {
        const w = watch(target, recursive ? { recursive: true } : undefined, () => fire())
        w.on('error', () => {}) // sem listener, um erro do watcher (path removido) derruba o main
        fileWatchers.push(w)
      }
      try {
        mk(true)
      } catch {
        try {
          mk(false) // fallback sem recursive
        } catch {
          /* caminho invalido/inexistente: ignora o trigger */
        }
      }
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
  void resumePaused() // reset do limite pode ter passado enquanto o app estava fechado/dormindo
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
      model: effectiveModel(r),
      cwd: r.dir,
      skip_reason: reason,
    })
  changed(runId)
  onRoutinesChanged(getRoutines())
}

function requiredLocks(r: Routine): string[] {
  const s = new Set(r.config.locks)
  if (r.config.chrome) s.add('chrome')
  // Provedor com servidor local (bootCommand) disputa a GPU: trava exclusiva.
  if (connOf(r.config.profile).bootCommand) s.add('gpu')
  return [...s]
}

async function endpointUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

// Sobe o servidor local do provedor (ex. `ollama serve`) se ele tiver bootCommand/healthUrl e nao estiver de pe.
// Provedor remoto (sem bootCommand) nao tem o que subir: segue direto.
async function ensureProvider(conn: Connection): Promise<boolean> {
  if (!conn.bootCommand || !conn.healthUrl) return true
  if (await endpointUp(conn.healthUrl)) return true
  // shell:true (como no precheck): aceita caminho com espaco (ex. "C:\Program Files\...") sem quebrar no split.
  spawn(conn.bootCommand, { detached: true, stdio: 'ignore', windowsHide: true, shell: true, env: childEnv() }).unref()
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    if (await endpointUp(conn.healthUrl)) return true
  }
  return false
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
  const fmt = (d: Date): string => d.toLocaleString('en-US', { timeZone: r.config.timezone, dateStyle: 'medium', timeStyle: 'short' })
  const scheduled = scheduledAt ? fmt(new Date(scheduledAt)) : '-'
  return [
    `[Turno] Run of routine "${r.config.name}" (${trigger}). Now: ${fmt(new Date())}. Scheduled for: ${scheduled}.`,
    'Nobody is watching this run: do not ask questions or wait for confirmation. Follow the instructions and, when in doubt, note it and move on.',
    '',
    r.prompt,
  ].join('\n')
}

export async function runRoutine(id: string, trigger: RunTrigger, scheduledAt?: string): Promise<string | undefined> {
  const r = findRoutine(id)
  if (!r) throw new Error(`routine "${id}" not found`)
  if (r.error) throw new Error(`routine has an error: ${r.error}`)
  // Mesmo horario ja tratado (cron atrasado depois de acordar + catch-up): ignora em silencio.
  if (scheduledAt && hasRunFor(id, scheduledAt)) return undefined
  if (isRoutineRunning(id)) return void skip(r, trigger, scheduledAt, 'previous run still in progress')

  // Registra ja como "na fila" para o historico mostrar e o dedupe por horario funcionar.
  const runId = newRunId()
  insertRun({
    id: runId,
    routine: id,
    trigger,
    status: 'queued',
    scheduled_at: scheduledAt ?? null,
    profile: r.config.profile,
    model: effectiveModel(r),
    cwd: r.dir,
  })
  changed(runId)

  // Connection inexistente (removida/typo no frontmatter): PULA com motivo. Nunca cai no provedor pago em silencio.
  const conn = findConnection(getSettings(), r.config.profile)
  if (!conn) return void skip(r, trigger, scheduledAt, `connection "${r.config.profile}" nao existe (verifique em Conexoes)`, runId)
  if (conn.bootCommand && !(await ensureProvider(conn)))
    return void skip(r, trigger, scheduledAt, `${conn.name} is not running (tried to start it, it did not come up)`, runId)
  if (conn.kind === 'claude' && !(await claudeStatus()))
    return void skip(r, trigger, scheduledAt, 'Claude Code is not logged in (run "claude" and use /login)', runId)
  if (r.config.precheck) {
    const p = await runPrecheck(r.config.precheck, r.dir)
    if (!p.ok) return void skip(r, trigger, scheduledAt, `precheck failed: ${p.out || 'no output'}`, runId)
  }

  const locks = requiredLocks(r)
  let busy: string | undefined
  if (r.config.lock_policy === 'skip' || trigger === 'manual') {
    const b = tryAcquire(locks, runId)
    busy = b && `lock busy: ${b}`
  } else busy = await acquireWait(locks, runId, QUEUE_WAIT_MS)
  if (busy) return void skip(r, trigger, scheduledAt, busy, runId)

  // startRun pode lancar (ex. connection removida na janela de await acima): libera o lock ja adquirido
  // e marca a run como skipped, em vez de vazar o lock (travaria runs futuros) e deixar a run presa em 'queued'.
  try {
    startRun({
      runId,
      routine: id,
      trigger,
      scheduledAt,
      timeoutMin: r.config.timeout_min,
      idleTimeoutMin: r.config.idle_timeout_min,
      policies: policiesFromConfig(r.config),
      sandbox: r.config.sandbox,
      isolation: r.config.isolation,
      req: {
        profile: r.config.profile,
        prompt: buildPrompt(r, trigger, scheduledAt),
        cwd: r.dir,
        model: effectiveModel(r),
        effort: r.config.effort,
        permissionMode: r.config.permission_mode,
        allowedTools: r.config.allowed_tools,
        chrome: r.config.chrome,
      },
    })
  } catch (e) {
    release(runId)
    return void skip(r, trigger, scheduledAt, `nao iniciou: ${(e as Error).message}`, runId)
  }
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
  if (!run) throw new Error('run not found')
  if (!run.session_id) throw new Error('this run has no session to continue (did it start?)')
  // run.cwd e o cwd EFETIVO da run: a worktree do Turno quando a run isolada foi preservada (resume por limite,
  // ou terminou com mudancas), senao o repo principal (inclui worktree ja removida pelo teardown, mapeada de volta).
  // request.json guarda o cwd ORIGINAL (r.dir) -> usa-lo faria o resume rodar FORA da worktree, no dir principal.
  const saved = readRequest(runId)
  const base: RunRequest = saved
    ? { ...saved, cwd: run.cwd ?? saved.cwd }
    : { profile: run.profile as RunRequest['profile'], prompt: '', cwd: run.cwd ?? undefined }
  // Connection da run original pode ter sido removida: falha cedo (antes do insert) em vez de cair no provedor pago.
  requireConnection(getSettings(), base.profile)
  const r = run.routine ? findRoutine(run.routine) : undefined
  const locks = r ? requiredLocks(r) : base.chrome ? ['chrome'] : []
  const newId = newRunId()
  const busy = tryAcquire(locks, newId)
  if (busy) throw new Error(`lock busy: ${busy}. Try again when the other routine finishes`)
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
  // startRun pode lancar (ex. isolation=worktree cuja worktree sumiu e o cwd nao e mais repo git): libera o lock
  // e marca a run como failed, em vez de vazar o lock e deixar a run presa em 'queued' (mesmo padrao do runRoutine).
  try {
    startRun({
      runId: newId,
      routine: run.routine ?? undefined,
      trigger: 'followup',
      timeoutMin: r?.config.timeout_min ?? 60,
      idleTimeoutMin: r?.config.idle_timeout_min ?? 15,
      policies: r ? policiesFromConfig(r.config) : [],
      priorCostUsd: priorCost(threadOf(run.id)), // teto de custo cumulativo pela conversa (anti-overspend no resume)
      sandbox: r?.config.sandbox,
      isolation: r?.config.isolation, // follow-up de rotina isolada roda em worktree (continua na preservada ou recria)
      req: { ...base, prompt: text, resume: run.session_id },
    })
  } catch (e) {
    release(newId)
    updateRun(newId, { status: 'failed', skip_reason: `nao iniciou: ${(e as Error).message}`, ended_at: new Date().toISOString() })
    changed(newId)
    throw e
  }
  return { runId: newId, mode: 'followup' }
}
