import { setWorkingCount } from './awake'
import { spawn, ChildProcess, execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { mkdirSync, createWriteStream, existsSync, readFileSync, rmSync, writeFileSync, WriteStream } from 'node:fs'
import { join } from 'node:path'
import type { ProfileId, RunEvent, RunEventKind, RunRecord, RunRequest, RunStatus, RunTrigger } from '../shared/types'
import { childEnv } from './env'
import { getRun, insertRun, pruneRuns, updateRun } from './db'
import { release } from './locks'

export const QWEN_MODEL = 'qwen3.6:35b'
export const PROFILE_ENV: Record<ProfileId, Record<string, string>> = {
  'claude-max': {},
  'qwen-local': {
    ANTHROPIC_BASE_URL: 'http://localhost:11434',
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: QWEN_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: QWEN_MODEL,
    ANTHROPIC_DEFAULT_SONNET_MODEL: QWEN_MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: QWEN_MODEL,
    CLAUDE_CODE_SUBAGENT_MODEL: QWEN_MODEL,
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: '131072',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    API_TIMEOUT_MS: '1800000',
  },
}

export function buildArgs(req: RunRequest): string[] {
  // stream-json na entrada: o processo aceita novas mensagens do usuario enquanto roda.
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages']
  // Sem isso os blocos de pensamento chegam vazios neste modo (achado no codigo do Orca).
  args.push('--thinking-display', 'summarized')
  if (req.resume) args.push('--resume', req.resume)
  const model = req.profile === 'qwen-local' ? QWEN_MODEL : req.model
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
    return [{ kind: 'init', summary: `modelo ${e.model} · ${e.tools?.length ?? 0} ferramentas · permissão ${e.permissionMode}${mcp ? ` · mcp ${mcp}` : ''}` }]
  }
  if (e.type === 'system' && e.subtype === 'api_retry') return [{ kind: 'retry', summary: trunc(JSON.stringify(e)) }]
  if (e.type === 'result') {
    const cost = typeof e.total_cost_usd === 'number' ? ` · ≈$${e.total_cost_usd.toFixed(4)}` : ''
    const ok = !e.is_error && e.subtype === 'success'
    return [{
      kind: 'final',
      summary: `${ok ? 'turno concluído' : `terminou com erro (${e.subtype})`} · ${e.num_turns} passos · ${Math.round((e.duration_ms ?? 0) / 1000)}s${cost}`,
      detail: ok ? undefined : cap(String(e.result ?? ''), 4000),
    }]
  }
  const content = e.message?.content
  if (!Array.isArray(content)) return []
  const out: Summ[] = []
  for (const b of content) {
    if (e.type === 'assistant' && b.type === 'text' && b.text?.trim()) out.push({ kind: 'text', summary: cap(b.text.trim(), 20000) })
    else if (b.type === 'thinking' && b.thinking?.trim()) out.push({ kind: 'thinking', summary: cap(b.thinking.trim(), 20000) })
    else if (b.type === 'redacted_thinking') out.push({ kind: 'thinking', summary: '(pensamento oculto pelo modelo)' })
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
  runId?: string // ja inserido como 'queued' pelo agendador
  parentId?: string // run anterior da mesma conversa (follow-up)
}

interface Active {
  child: ChildProcess
  stopReason?: RunStatus
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
      ? { behavior: 'deny', message: 'O usuário negou esta ação no Turno.', toolUseID: req.tool_use_id }
      : {
          behavior: 'allow',
          updatedInput: req.input,
          toolUseID: req.tool_use_id,
          ...(decision === 'allow_session' && req.permission_suggestions ? { updatedPermissions: req.permission_suggestions } : {}),
        }
  writeLine(a, { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
  const label = decision === 'deny' ? 'negado' : decision === 'allow_session' ? 'permitido nesta sessão' : 'permitido'
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
      model: req.profile === 'qwen-local' ? QWEN_MODEL : (req.model ?? null),
      cwd: req.cwd ?? null,
      parent_id: o.parentId ?? null,
    })
  changed(runId)

  // Guardado para continuar a conversa depois (follow-up com --resume).
  writeFileSync(join(dir, 'request.json'), JSON.stringify({ ...req, prompt: undefined }, null, 2))
  const args = buildArgs(req)
  emit('start', `claude ${args.join(' ')}  [perfil ${req.profile}${o.routine ? `, rotina ${o.routine}` : ''}]`)
  const child = spawn('claude', args, {
    cwd: req.cwd ?? process.env.USERPROFILE,
    env: childEnv({
      ...PROFILE_ENV[req.profile],
      TURNO_RUN_ID: runId,
      TURNO_RUN_DIR: dir,
      ...(o.scheduledAt ? { TURNO_SCHEDULED_AT: o.scheduledAt } : {}),
    }),
    windowsHide: true,
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
          emit('permission_reply', 'cancelado', { ref: e.request_id })
        }
        if (e.type === 'result') {
          result = e
          a.results++
          // Respondeu tudo que foi enviado: fecha a entrada e o processo termina.
          if (a.results >= a.sent) child.stdin?.end()
        }
      } catch {
        /* linha truncada */
      }
    }
    if (line.includes('"api_retry"') && /rate.?limit|429|overloaded/i.test(line)) rateLimited = true
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
    if (a.stopReason) status = a.stopReason
    else if (code === 0 && result && !result.is_error && result.subtype === 'success') status = 'ok'
    else if (rateLimited) status = 'rate_limited'
    else status = 'failed'
    emit('exit', err ? `falha ao iniciar: ${err}` : `processo terminou (exit=${code}) → ${status}`)
    const close = (s: WriteStream): void => void s.end()
    ;[raw, summary, errLog].forEach(close)
    updateRun(runId, {
      status,
      ended_at: new Date().toISOString(),
      exit_code: code,
      cost_usd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
      session_id: result?.session_id ?? null,
      result: result?.result ? String(result.result).slice(0, 20000) : (err ?? null),
    })
    const rec = getRun(runId)!
    emitChanged(rec)
    onFinished(rec)
    if (rec.routine)
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
      if (active.has(runId)) execFile('taskkill', ['/PID', String(a.child.pid), '/T', '/F'], () => res())
      else res()
    }
    a.killTimer = setTimeout(kill, 8000)
    a.child.once('close', () => {
      clearTimeout(a.killTimer)
      res()
    })
  })
}

export function forceKillAll(): void {
  for (const a of active.values()) if (a.child.pid) execFile('taskkill', ['/PID', String(a.child.pid), '/T', '/F'], () => {})
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
