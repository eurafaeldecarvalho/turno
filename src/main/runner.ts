import { setWorkingCount } from './awake'
import { spawn, ChildProcess, execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { mkdirSync, createWriteStream, existsSync, readFileSync, rmSync, writeFileSync, WriteStream } from 'node:fs'
import { join } from 'node:path'
import type { RunEvent, RunEventKind, RunRecord, RunRequest, RunStatus, RunTrigger } from '../shared/types'
import { childEnv } from './env'
import { getRun, insertRun, pruneRuns, updateRun } from './db'
import { release } from './locks'
import { getSettings } from './settings'
import { effectiveModel, requireConnection, resolveProviderEnv } from './providers'
import { evaluateThresholds, matchedRateLimit, parseRateLimit, type AbortPolicy } from './abort'
import { wrapForSandbox } from './sandbox'
import { connectionToken } from './secrets'
import { IS_WIN, homeDir } from './platform'

// Mata a arvore de processos do run, por plataforma. Windows: taskkill /T. POSIX: mata o grupo (-pid).
function killTree(pid: number): void {
  if (IS_WIN) {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {})
  } else {
    try {
      process.kill(-pid, 'SIGKILL') // grupo inteiro (child foi spawnado detached)
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* ja morreu */
      }
    }
  }
}

export function buildArgs(req: RunRequest, model?: string): string[] {
  // stream-json na entrada: o processo aceita novas mensagens do usuario enquanto roda.
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages']
  // Sem isso os blocos de pensamento chegam vazios neste modo (achado no codigo do Orca).
  args.push('--thinking-display', 'summarized')
  if (req.resume) args.push('--resume', req.resume)
  if (model) args.push('--model', model)
  if (req.effort) args.push('--effort', req.effort)
  const mode = req.permissionMode ?? 'dontAsk'
  args.push('--permission-mode', mode)
  // "manual" = Perguntar: o pedido vira um cartao na UI (control_request can_use_tool pelo stdio).
  // Nos demais modos, o que nao estiver liberado e negado em vez de ficar esperando.
  if (mode === 'manual') args.push('--permission-prompt-tool', 'stdio')
  else if (mode !== 'bypassPermissions') args.push('--permission-prompts', 'none')
  if (req.allowedTools?.length) args.push('--allowedTools', ...req.allowedTools)
  args.push(req.chrome ? '--chrome' : '--no-chrome')
  return args
}

function trunc(s: string, n = 300): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + '…' : one
}

type Summ = { kind: RunEventKind; summary: string; detail?: string; ref?: string }

const cap = (t: string, n: number): string => (t.length > n ? t.slice(0, n) + '\n…' : t)

// Converte uma linha do stream-json do Claude Code em eventos para a UI (texto, pensamento, ferramentas).
export function summarize(line: string): Summ[] {
  let e: any
  try {
    e = JSON.parse(line)
  } catch {
    return line.trim() ? [{ kind: 'text', summary: trunc(line) }] : []
  }
  if (e.type === 'system' && e.subtype === 'init') {
    const mcp = (e.mcp_servers ?? []).map((m: any) => `${m.name}:${m.status}`).join(', ')
    return [{ kind: 'init', summary: `model ${e.model} · ${e.tools?.length ?? 0} tools · permission ${e.permissionMode}${mcp ? ` · mcp ${mcp}` : ''}` }]
  }
  if (e.type === 'system' && e.subtype === 'api_retry') return [{ kind: 'retry', summary: trunc(JSON.stringify(e)) }]
  if (e.type === 'result') {
    const cost = typeof e.total_cost_usd === 'number' ? ` · ≈$${e.total_cost_usd.toFixed(4)}` : ''
    const ok = !e.is_error && e.subtype === 'success'
    return [{
      kind: 'final',
      summary: `${ok ? 'turn completed' : `ended with an error (${e.subtype})`} · ${e.num_turns} steps · ${Math.round((e.duration_ms ?? 0) / 1000)}s${cost}`,
      detail: ok ? undefined : cap(String(e.result ?? ''), 4000),
    }]
  }
  const content = e.message?.content
  if (!Array.isArray(content)) return []
  const out: Summ[] = []
  for (const b of content) {
    if (e.type === 'assistant' && b.type === 'text' && b.text?.trim()) out.push({ kind: 'text', summary: cap(b.text.trim(), 20000) })
    else if (b.type === 'thinking' && b.thinking?.trim()) out.push({ kind: 'thinking', summary: cap(b.thinking.trim(), 20000) })
    else if (b.type === 'redacted_thinking') out.push({ kind: 'thinking', summary: '(thinking hidden by the model)' })
    else if (b.type === 'tool_use') {
      const input = b.input ?? {}
      const file = input.file_path ?? input.notebook_path
      const preview = input.command ?? (file ? String(file).split(/[\\/]/).pop() : undefined) ?? input.url ?? input.pattern ?? input.description ?? input.prompt ?? JSON.stringify(input)
      out.push({ kind: 'tool_call', summary: `${b.name}  ${trunc(String(preview), 160)}`, detail: cap(JSON.stringify(input, null, 2), 8000), ref: b.id })
    } else if (b.type === 'tool_result') {
      const c = typeof b.content === 'string' ? b.content : (b.content ?? []).map((x: any) => (x.type === 'text' ? x.text : `[${x.type}]`)).join('\n')
      out.push({ kind: 'tool_result', summary: (b.is_error ? '[erro] ' : '') + trunc(c, 200), detail: cap(c, 8000), ref: b.tool_use_id })
    }
  }
  return out
}

export interface StartOptions {
  req: RunRequest
  routine?: string
  trigger: RunTrigger
  scheduledAt?: string
  timeoutMin?: number
  idleTimeoutMin?: number
  policies?: AbortPolicy[] // politicas de parada (custo/passos/duracao/limite de sessao/semanal)
  priorCostUsd?: number // custo ja gasto nos segmentos anteriores (resume): mantem o teto cost_usd CUMULATIVO
  sandbox?: import('../shared/types').SandboxMode // 'none' (default) roda sem sandbox
  runId?: string // ja inserido como 'queued' pelo agendador
  parentId?: string // run anterior da mesma conversa (follow-up)
}

interface Active {
  child: ChildProcess
  stopReason?: RunStatus
  stopDetail?: string // motivo textual do abort (policy que bateu) -> vai pro result/skip_reason
  pauseUntil?: string // ISO; quando setado, a run termina como 'paused' e sera retomada no reset
  sent: number
  results: number
  emit: (kind: RunEventKind, text: string, ref?: string) => void
  permissions: Map<string, any>
  killTimer?: ReturnType<typeof setTimeout>
}

function writeLine(a: Active, obj: unknown): void {
  if (a.child.stdin && !a.child.stdin.writableEnded) a.child.stdin.write(JSON.stringify(obj) + '\n')
}

function writeUser(a: Active, text: string): void {
  a.sent++
  writeLine(a, { type: 'user', uuid: randomUUID(), message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: '' })
}

export type PermissionDecision = 'allow' | 'allow_session' | 'deny'

// Resposta do usuario a um cartao de permissao.
export function answerPermission(runId: string, requestId: string, decision: PermissionDecision): boolean {
  const a = active.get(runId)
  const req = a?.permissions.get(requestId)
  if (!a || !req) return false
  a.permissions.delete(requestId)
  const response =
    decision === 'deny'
      ? { behavior: 'deny', message: 'The user denied this action in Turno.', toolUseID: req.tool_use_id }
      : {
          behavior: 'allow',
          updatedInput: req.input,
          toolUseID: req.tool_use_id,
          ...(decision === 'allow_session' && req.permission_suggestions ? { updatedPermissions: req.permission_suggestions } : {}),
        }
  writeLine(a, { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
  const label = decision === 'deny' ? 'denied' : decision === 'allow_session' ? 'allowed for this session' : 'allowed'
  a.emit('permission_reply', label, requestId)
  return true
}

// Mensagem do usuario para uma run ainda rodando. Devolve false se ela ja terminou.
export function sendToRun(runId: string, text: string): boolean {
  const a = active.get(runId)
  if (!a || !a.child.stdin || a.child.stdin.writableEnded) return false
  a.emit('user', text)
  writeUser(a, text)
  return true
}

export function readRequest(runId: string): RunRequest | undefined {
  try {
    return JSON.parse(readFileSync(join(runsDir, runId, 'request.json'), 'utf8'))
  } catch {
    return undefined
  }
}

const active = new Map<string, Active>()
let counter = 0
let emitEvent: (ev: RunEvent) => void = () => {}
let emitChanged: (run: RunRecord) => void = () => {}
let onFinished: (run: RunRecord) => void = () => {}
let onPermission: (runId: string, tool: string, what: string) => void = () => {}
let runsDir = ''

export function initRunner(o: {
  runsDir: string
  onEvent: (ev: RunEvent) => void
  onChanged: (run: RunRecord) => void
  onFinished: (run: RunRecord) => void
  onPermission: (runId: string, tool: string, what: string) => void
}): void {
  runsDir = o.runsDir
  onPermission = o.onPermission
  emitEvent = o.onEvent
  emitChanged = o.onChanged
  onFinished = o.onFinished
}

export function newRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${++counter}`
}

export function isRoutineRunning(routine: string): boolean {
  for (const id of active.keys()) if (getRun(id)?.routine === routine) return true
  return false
}

export function activeCount(): number {
  return active.size
}

export function changed(id: string): void {
  const r = getRun(id)
  if (r) emitChanged(r)
}

// Quantos agentes trabalhando: o modulo awake decide se mantem o PC acordado.
function updateBlocker(): void {
  setWorkingCount(active.size)
}

export function startRun(o: StartOptions): string {
  const { req } = o
  // Guard central: recusa profile de connection inexistente (nunca cai no provedor pago em silencio).
  // Cobre runRoutine, followUp e adhoc, que todos passam por aqui.
  const conn = requireConnection(getSettings(), req.profile)
  const model = effectiveModel(conn, req.model)
  const runId = o.runId ?? newRunId()
  const dir = join(runsDir, runId)
  mkdirSync(dir, { recursive: true })
  const raw = createWriteStream(join(dir, 'events.ndjson'))
  const summary = createWriteStream(join(dir, 'turno-events.ndjson'))
  const errLog = createWriteStream(join(dir, 'stderr.log'))
  let seq = 0
  const emit = (kind: RunEventKind, text: string, extra: { detail?: string; ref?: string } = {}): void => {
    const ev: RunEvent = { runId, seq: seq++, ts: new Date().toISOString(), kind, summary: text, ...extra }
    summary.write(JSON.stringify(ev) + '\n')
    emitEvent(ev)
  }

  const now = new Date().toISOString()
  if (o.runId) updateRun(runId, { status: 'running', started_at: now })
  else
    insertRun({
      id: runId,
      routine: o.routine ?? null,
      trigger: o.trigger,
      status: 'running',
      scheduled_at: o.scheduledAt ?? null,
      profile: req.profile,
      model: model ?? null,
      cwd: req.cwd ?? null,
      parent_id: o.parentId ?? null,
    })
  changed(runId)

  // Guardado para continuar a conversa depois (follow-up com --resume).
  writeFileSync(join(dir, 'request.json'), JSON.stringify({ ...req, prompt: undefined }, null, 2))
  const args = buildArgs(req, model)
  const providerEnv: Record<string, string> = {
    ...resolveProviderEnv(conn, connectionToken(conn)),
    TURNO_RUN_ID: runId,
    TURNO_RUN_DIR: dir,
    ...(o.scheduledAt ? { TURNO_SCHEDULED_AT: o.scheduledAt } : {}),
  }
  // Sandbox (opt-in): repassa só ANTHROPIC_* + TURNO_RUN_ID (id, nao caminho) pro container/WSL.
  // TURNO_RUN_DIR e caminho do HOST e nao existe dentro do sandbox -> nao repassa. 'none' (default) nao altera nada.
  const sbKeys = Object.keys(providerEnv).filter((k) => k.startsWith('ANTHROPIC_') || k === 'TURNO_RUN_ID')
  const sb = wrapForSandbox('claude', args, o.sandbox ?? 'none', { cwd: req.cwd, env: sbKeys })
  emit('start', `${sb.cmd} ${sb.args.join(' ')}  [profile ${req.profile}${o.routine ? `, routine ${o.routine}` : ''}]`)
  const child = spawn(sb.cmd, sb.args, {
    cwd: req.cwd ?? homeDir(),
    env: childEnv({ ...providerEnv, ...(sb.env ?? {}) }),
    windowsHide: true,
    detached: !IS_WIN, // POSIX: child lidera um grupo de processos, p/ matar a arvore ao parar
  })
  const a: Active = { child, sent: 0, results: 0, emit: (k, t, ref) => emit(k, t, { ref }), permissions: new Map() }
  active.set(runId, a)
  updateBlocker()
  // Prompt via stdin (stream-json): evita o limite da linha de comando e permite mensagens extras.
  child.stdin?.on('error', () => {})
  emit(o.trigger === 'followup' ? 'user' : 'prompt', req.prompt)
  writeUser(a, req.prompt)

  let result: any
  let rateLimited = false
  const startedMs = Date.now()
  let lastSessionId: string | undefined // p/ retomar (--resume) se pausar por limite
  let maxCost = 0
  let maxSteps = 0
  const policies = o.policies ?? []
  const timers: Array<ReturnType<typeof setTimeout>> = []
  if (o.timeoutMin) timers.push(setTimeout(() => void stopRun(runId, 'timeout'), o.timeoutMin * 60_000))
  let idle: ReturnType<typeof setTimeout> | undefined
  const bumpIdle = (): void => {
    if (!o.idleTimeoutMin) return
    clearTimeout(idle)
    idle = setTimeout(() => void stopRun(runId, 'idle_timeout'), o.idleTimeoutMin * 60_000)
  }
  bumpIdle()

  createInterface({ input: child.stdout! }).on('line', (line) => {
    bumpIdle()
    raw.write(line + '\n')
    if (line.includes('"type":"result"') || line.includes('"type":"control_')) {
      try {
        const e = JSON.parse(line)
        if (e.type === 'control_request' && e.request?.subtype === 'can_use_tool') {
          a.permissions.set(e.request_id, e.request)
          const r = e.request
          const what = r.input?.command ?? r.input?.file_path ?? r.description ?? ''
          emit('permission', `${r.display_name ?? r.tool_name}  ${trunc(String(what), 200)}`, {
            ref: e.request_id,
            detail: JSON.stringify({ tool: r.tool_name, input: r.input, description: r.description, canSession: !!r.permission_suggestions?.length }, null, 2),
          })
          onPermission(runId, r.display_name ?? r.tool_name, String(what))
        } else if (e.type === 'control_cancel_request') {
          a.permissions.delete(e.request_id)
          emit('permission_reply', 'cancelled', { ref: e.request_id })
        }
        if (typeof e.session_id === 'string') lastSessionId = e.session_id
        if (e.type === 'result') {
          result = e
          a.results++
          if (typeof e.total_cost_usd === 'number') maxCost = Math.max(maxCost, e.total_cost_usd)
          if (typeof e.num_turns === 'number') maxSteps = Math.max(maxSteps, e.num_turns)
          // Avalia as policies de threshold (custo/passos/duracao) no limite de cada turno (best-effort).
          // Custo e CUMULATIVO pela conversa (priorCostUsd dos resumes) p/ o teto nao reiniciar a cada retomada.
          const t = evaluateThresholds({ costUsd: (o.priorCostUsd ?? 0) + maxCost, steps: maxSteps, durationMin: (Date.now() - startedMs) / 60_000 }, policies)
          if (t.abort) {
            a.stopDetail = t.reason
            void stopRun(runId, 'aborted')
          } else if (a.results >= a.sent) child.stdin?.end() // respondeu tudo: fecha a entrada
        }
      } catch {
        /* linha truncada */
      }
    }
    if (line.includes('"api_retry"') && /rate.?limit|429|overloaded/i.test(line)) rateLimited = true
    // Bateu o limite da assinatura (5h / semanal) DE VERDADE (status rejected): se a rotina pede pausar,
    // marca pra retomar no reset. Eventos 'allowed'/'allowed_warning' NAO param a run.
    if (!a.pauseUntil) {
      const rl = parseRateLimit(line)
      const kind = rl?.rejected ? matchedRateLimit(rl.rateLimitType, policies) : undefined
      if (kind) {
        const fallbackMs = Date.now() + (kind === 'weekly_limit' ? 7 * 24 : 5) * 3_600_000
        a.pauseUntil = new Date(rl!.resetsAt ? rl!.resetsAt * 1000 : fallbackMs).toISOString()
        a.stopDetail = `${kind === 'weekly_limit' ? 'limite semanal' : 'limite de sessao (5h)'} atingido; retoma ${a.pauseUntil}`
        void stopRun(runId, 'stopped')
      }
    }
    for (const x of summarize(line)) emit(x.kind, x.summary, { detail: x.detail, ref: x.ref })
  })
  child.stderr!.on('data', (d: Buffer) => {
    bumpIdle()
    errLog.write(d)
    emit('stderr', trunc(d.toString(), 500))
  })
  let finished = false
  const finish = (code: number | null, err?: string): void => {
    if (finished) return
    finished = true
    timers.forEach(clearTimeout)
    clearTimeout(idle)
    active.delete(runId)
    updateBlocker()
    release(runId)
    let status: RunStatus
    if (a.pauseUntil) status = 'paused'
    else if (a.stopReason) status = a.stopReason
    else if (code === 0 && result && !result.is_error && result.subtype === 'success') status = 'ok'
    else if (rateLimited) status = 'rate_limited'
    else status = 'failed'
    emit('exit', err ? `failed to start: ${err}` : `process exited (exit=${code}) → ${status}`)
    const close = (s: WriteStream): void => void s.end()
    ;[raw, summary, errLog].forEach(close)
    updateRun(runId, {
      status,
      // Run pausada nao "terminou": fica sem ended_at e com resume_at para o scheduler retomar no reset.
      ended_at: a.pauseUntil ? null : new Date().toISOString(),
      resume_at: a.pauseUntil ?? null,
      exit_code: code,
      cost_usd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
      session_id: result?.session_id ?? lastSessionId ?? null,
      result: a.stopDetail ?? (result?.result ? String(result.result).slice(0, 20000) : (err ?? null)),
    })
    const rec = getRun(runId)!
    emitChanged(rec)
    onFinished(rec)
    // Nao poda run pausada (ainda vai ser retomada). Poda so apos realmente terminar.
    if (rec.routine && !a.pauseUntil)
      for (const id of pruneRuns(rec.routine)) rmSync(join(runsDir, id), { recursive: true, force: true })
  }
  child.on('error', (e) => finish(null, e.message))
  child.on('close', (code) => finish(code))
  return runId
}

// Primeiro pede interrupcao limpa (control_request interrupt, como o Orca); se nao sair em 8s,
// taskkill /T derruba a arvore (no Windows child.kill() nao mata os netos: MCPs, node).
export function stopRun(runId: string, reason: RunStatus = 'stopped'): Promise<void> {
  const a = active.get(runId)
  if (!a?.child.pid) return Promise.resolve()
  a.stopReason ??= reason
  writeLine(a, { type: 'control_request', request_id: `turno-${randomUUID()}`, request: { subtype: 'interrupt' } })
  a.child.stdin?.end()
  return new Promise((res) => {
    const kill = (): void => {
      if (active.has(runId) && a.child.pid) killTree(a.child.pid)
      res()
    }
    a.killTimer = setTimeout(kill, 8000)
    a.child.once('close', () => {
      clearTimeout(a.killTimer)
      res()
    })
  })
}

export function forceKillAll(): void {
  for (const a of active.values()) if (a.child.pid) killTree(a.child.pid)
}

export async function stopAllRuns(): Promise<void> {
  await Promise.all([...active.keys()].map((id) => stopRun(id)))
}

export function readRunEvents(runId: string): RunEvent[] {
  const f = join(runsDir, runId, 'turno-events.ndjson')
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as RunEvent]
      } catch {
        return []
      }
    })
}
