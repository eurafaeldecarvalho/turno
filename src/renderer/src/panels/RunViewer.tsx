import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { toast } from '../Toast'
import { Markdown } from '../markdown'
import { onSettings } from '../appearance'
import type { IDockviewPanelProps } from 'dockview-react'
import type { RunEvent, RunRecord } from '../../../shared/types'
import { useStore, isActive } from '../store'
import { STATUS_LABEL, TRIGGER_LABEL, duration, plural, statusTone, totalDuration, when } from '../fmt'
import { openRoutine, openRun, openTerminal } from '../layout'
import { IconStop, IconTerminal, IconRoutine, IconSend, IconChevron } from '../icons'

// ---------- dados: conversa = cadeia de runs (original + follow-ups) ----------

function useThread(headId: string) {
  const storeRuns = useStore((s) => s.runs)
  const [chain, setChain] = useState<RunRecord[]>([])
  const [events, setEvents] = useState<Record<string, RunEvent[]>>({})

  useEffect(() => {
    let alive = true
    const buffer: RunEvent[] = []
    let loaded = false
    const off = window.turno.run.onEvent((ev) => {
      if (!loaded) return void buffer.push(ev)
      setEvents((m) => (m[ev.runId] && !m[ev.runId].some((x) => x.seq === ev.seq) ? { ...m, [ev.runId]: [...m[ev.runId], ev] } : m))
    })
    void (async () => {
      const runs = await window.turno.run.thread(headId)
      const loadedEvents: Record<string, RunEvent[]> = {}
      for (const r of runs) loadedEvents[r.id] = await window.turno.run.events(r.id)
      if (!alive) return
      for (const ev of buffer) {
        const list = loadedEvents[ev.runId]
        if (list && !list.some((x) => x.seq === ev.seq)) list.push(ev)
      }
      loaded = true
      setChain(runs)
      setEvents(loadedEvents)
    })()
    return () => {
      alive = false
      off()
    }
  }, [headId])

  // Status das runs vem do store (atualizado ao vivo).
  const runs = chain.map((r) => storeRuns.find((x) => x.id === r.id) ?? r)
  return { runs, events }
}

// ---------- blocos da conversa ----------

type Tool = { call: RunEvent; result?: RunEvent }
type Block =
  | { t: 'event'; ev: RunEvent; dur?: number }
  | { t: 'tools'; items: Tool[] }
  | { t: 'perm'; ev: RunEvent; reply?: RunEvent }

// Chamadas de ferramenta seguidas viram um grupo com frase-resumo.
function toBlocks(evs: RunEvent[]): Block[] {
  const out: Block[] = []
  const byRef = new Map<string, Tool>()
  const perms = new Map<string, Extract<Block, { t: 'perm' }>>()
  for (const ev of evs) {
    if (ev.kind === 'tool_call') {
      const tool: Tool = { call: ev }
      if (ev.ref) byRef.set(ev.ref, tool)
      const last = out.at(-1)
      if (last?.t === 'tools') last.items.push(tool)
      else out.push({ t: 'tools', items: [tool] })
    } else if (ev.kind === 'tool_result' && ev.ref && byRef.has(ev.ref)) {
      byRef.get(ev.ref)!.result = ev
    } else if (ev.kind === 'permission') {
      const b = { t: 'perm' as const, ev }
      if (ev.ref) perms.set(ev.ref, b)
      out.push(b)
    } else if (ev.kind === 'permission_reply' && ev.ref && perms.has(ev.ref)) {
      perms.get(ev.ref)!.reply = ev
    } else out.push({ t: 'event', ev })
  }
  // "Pensou por Ns" = do bloco de pensamento ate o proximo evento.
  for (const b of out) {
    if (b.t !== 'event' || b.ev.kind !== 'thinking') continue
    const next = evs[evs.indexOf(b.ev) + 1]
    if (next) b.dur = Math.max(0, Math.round((Date.parse(next.ts) - Date.parse(b.ev.ts)) / 1000))
  }
  return out
}

export function fmtSecs(s: number): string {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const CATS: Array<{ test: (n: string) => boolean; one: string; many: (n: number) => string; doing: string }> = [
  { test: (n) => n === 'Bash' || n === 'PowerShell', one: 'ran 1 command', many: (n) => `ran ${n} commands`, doing: 'running command' },
  { test: (n) => n === 'Read', one: 'read 1 file', many: (n) => `read ${n} files`, doing: 'reading' },
  { test: (n) => /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n), one: 'edited 1 file', many: (n) => `edited ${n} files`, doing: 'editing' },
  { test: (n) => n === 'Grep' || n === 'Glob', one: 'searched once', many: (n) => `searched ${n} times`, doing: 'searching' },
  { test: (n) => n === 'WebFetch' || n === 'WebSearch', one: 'checked the web', many: (n) => `checked the web ${n} times`, doing: 'checking the web' },
  { test: (n) => n.startsWith('mcp__claude-in-chrome__') || n.startsWith('mcp__Claude_Browser__'), one: 'used the browser', many: (n) => `used the browser ${n} times`, doing: 'in the browser' },
  { test: (n) => n === 'Agent' || n === 'Task', one: 'ran 1 subagent', many: (n) => `ran ${n} subagents`, doing: 'subagent working' },
  { test: (n) => n === 'TodoWrite', one: 'updated the tasks', many: () => 'updated the tasks', doing: 'updating tasks' },
  { test: (n) => n === 'ToolSearch', one: 'loaded tools', many: () => 'loaded tools', doing: 'loading tools' },
  { test: (n) => n.startsWith('mcp__'), one: 'used 1 integration', many: (n) => `used ${n} integrations`, doing: 'using integration' },
]

// Respostas/erros vindos do main: aceita os valores antigos (pt) gravados no banco e os novos (en).
const isErr = (r?: RunEvent): boolean => !!r && (r.summary.startsWith('[erro]') || r.summary.startsWith('[error]'))
const REPLY_DENIED = new Set(['negado', 'denied'])
const REPLY_CANCELLED = new Set(['cancelado', 'cancelled'])
const REPLY_LABEL: Record<string, string> = { negado: 'denied', cancelado: 'cancelled', permitido: 'allowed', 'permitido nesta sessão': 'allowed for this session' }

function toolName(t: Tool): string {
  return t.call.summary.split('  ')[0]
}

function runSummary(items: Tool[]): string {
  const counts = new Map<number, number>()
  let other = 0
  for (const t of items) {
    const i = CATS.findIndex((c) => c.test(toolName(t)))
    if (i < 0) other++
    else counts.set(i, (counts.get(i) ?? 0) + 1)
  }
  const parts = [...counts].sort((a, b) => a[0] - b[0]).map(([i, n]) => (n === 1 ? CATS[i].one : CATS[i].many(n)))
  if (other) parts.push(other === 1 ? 'used 1 tool' : `used ${other} tools`)
  const s = parts.join(', ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function Collapsible({ head, children, open: initial = false, className = '' }: { head: ReactNode; children: ReactNode; open?: boolean; className?: string }) {
  const [open, setOpen] = useState(initial)
  return (
    <div className={`coll ${open ? 'open' : ''} ${className}`}>
      <button className="coll-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <IconChevron size={12} className="chev" />
        {head}
      </button>
      {open && <div className="coll-body">{children}</div>}
    </div>
  )
}

// texto do agente logo antes (o erro final costuma repetir a mesma frase)
const prevTextOf = (blocks: Block[], j: number): string | undefined => {
  const p = blocks[j - 1]
  return p?.t === 'event' && p.ev.kind === 'text' ? p.ev.summary : undefined
}

function EventBlock({ ev, dur, prevText }: { ev: RunEvent; dur?: number; prevText?: string }) {
  switch (ev.kind) {
    case 'prompt':
      return (
        <Collapsible className="msg-prompt" head={<span>Routine prompt <span className="muted">· {ev.summary.length} characters</span></span>}>
          <pre className="pre">{ev.summary}</pre>
        </Collapsible>
      )
    case 'user':
      return (
        <div className="msg-user">
          <div className="bubble">{ev.summary}</div>
        </div>
      )
    case 'text':
      return <Markdown className="msg-agent" text={ev.summary} />
    case 'thinking': {
      const first = ev.summary.split('\n')[0].slice(0, 140)
      const head = dur ? `Thought for ${fmtSecs(dur)}` : 'Thought'
      // Pensamento curto cabe inteiro no resumo: sem expandir (antes repetia a mesma frase).
      if (first === ev.summary.trim()) return <div className="msg-thinking coll-flat">{head} <span className="muted">— {first}</span></div>
      return (
        <Collapsible className="msg-thinking" head={<span>{head} <span className="muted think-preview">— {first}{ev.summary.length > first.length ? '…' : ''}</span></span>}>
          <Markdown className="thinking-text" text={ev.summary} />
        </Collapsible>
      )
    }
    case 'final':
      return (
        <div className={`msg-final ${ev.detail ? 'err' : ''}`}>
          <span>{ev.summary.replace(/ · 0s(?= ·|$)/, '')}</span>
          {ev.detail && ev.detail.trim() !== prevText?.trim() && <pre className="pre">{ev.detail}</pre>}
        </div>
      )
    case 'retry':
    case 'stderr':
      return <div className="msg-sys warn">{ev.summary}</div>
    case 'init':
    case 'exit':
      return <div className="msg-sys">{ev.summary}</div>
    case 'start':
      return (
        <Collapsible className="msg-sys" head={<span>command</span>}>
          <pre className="pre">{ev.summary}</pre>
        </Collapsible>
      )
    default:
      return <div className="msg-sys">{ev.summary}</div>
  }
}

function ToolBlock({ call, result }: Tool) {
  const [name, ...rest] = call.summary.split('  ')
  const err = isErr(result)
  return (
    <Collapsible
      className={`msg-tool ${err ? 'err' : ''} ${result ? '' : 'pending'}`}
      head={
        <span className="tool-head">
          <span className="tool-name">{name}</span>
          <span className="tool-arg">{rest.join('  ')}</span>
          {!result && <span className="spinner sm" />}
        </span>
      }
    >
      {call.detail && (
        <>
          <div className="tool-label">input</div>
          <pre className="pre">{call.detail}</pre>
        </>
      )}
      {result && (
        <>
          <div className="tool-label">result</div>
          <pre className="pre">{result.detail ?? result.summary}</pre>
        </>
      )}
    </Collapsible>
  )
}

function ToolRun({ items }: { items: Tool[] }) {
  if (items.length === 1) return <ToolBlock {...items[0]} />
  const pending = items.some((t) => !t.result)
  const errors = items.filter((t) => isErr(t.result)).length
  return (
    <Collapsible
      className="msg-toolrun"
      open={pending}
      head={
        <span className="tool-head">
          <span>{runSummary(items)}</span>
          {errors > 0 && <span className="pill pill-err">{errors} with errors</span>}
          {pending && <span className="spinner sm" />}
        </span>
      }
    >
      <div className="toolrun-list">
        {items.map((t, i) => (
          <ToolBlock key={i} {...t} />
        ))}
      </div>
    </Collapsible>
  )
}

function PermissionCard({ ev, reply, live }: { ev: RunEvent; reply?: RunEvent; live: boolean }) {
  const [busy, setBusy] = useState(false)
  let info: { tool?: string; input?: unknown; description?: string; canSession?: boolean } = {}
  try {
    info = JSON.parse(ev.detail ?? '{}')
  } catch {
    /* sem detalhe */
  }
  const answer = async (d: 'allow' | 'allow_session' | 'deny'): Promise<void> => {
    setBusy(true)
    await window.turno.run.permission(ev.runId, ev.ref!, d)
    setBusy(false)
  }
  const done = !!reply || !live
  return (
    <div className={`perm-card ${done ? 'done' : ''}`}>
      <div className="perm-title">
        <span>🔐 Permission request: <b>{ev.summary.split('  ')[0]}</b></span>
        {reply && <span className={`pill ${REPLY_DENIED.has(reply.summary) ? 'pill-err' : REPLY_CANCELLED.has(reply.summary) ? '' : 'pill-ok'}`}>{REPLY_LABEL[reply.summary] ?? reply.summary}</span>}
        {!reply && !live && <span className="pill">no answer</span>}
      </div>
      {info.description && <div className="muted small">{info.description}</div>}
      <pre className="pre">{typeof info.input === 'object' ? JSON.stringify(info.input, null, 2) : ev.summary}</pre>
      {!done && (
        <div className="row">
          <button className="btn primary small" disabled={busy} onClick={() => void answer('allow')}>Allow</button>
          {info.canSession && (
            <button className="btn small" disabled={busy} onClick={() => void answer('allow_session')}>Allow for this session</button>
          )}
          <button className="btn danger small" disabled={busy} onClick={() => void answer('deny')}>Deny</button>
        </div>
      )}
    </div>
  )
}

function LiveLine({ since }: { since: string | null }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = since ? Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000)) : 0
  return (
    <div className="msg-live">
      <span className="spinner sm" /> working for {fmtSecs(secs)}…
    </div>
  )
}

// "held by <run id>": vira link para a run que segurava o lock.
// Erro no ROUTINE.md acima da conversa. Some quando o arquivo e corrigido: o foco que estava nele nao cai no <body>.
function FileErrorBanner({ id, name, error }: { id: string; name: string; error: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    return () => {
      // cleanup de layout roda antes do no sair do DOM
      if (!el || !el.contains(document.activeElement)) return
      const dialog = el.closest<HTMLElement>('[role="dialog"]')
      const conv = el.closest('.runview')?.querySelector<HTMLElement>('.conversation')
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return
        if (conv?.isConnected) conv.focus({ preventScroll: true })
        else if (dialog?.isConnected) dialog.focus({ preventScroll: true })
        else window.dispatchEvent(new Event('turno:focus-active-panel'))
      })
    }
  }, [])
  return (
    <div ref={ref} className="banner banner-err conv-file-err" role="status">
      <div className="banner-pre">Error in ROUTINE.md: {error}</div>
      <button className="link" onClick={() => openRoutine(id, name, true)}>Configure</button>
    </div>
  )
}

function SkipReason({ text }: { text: string }) {
  const m = /^(.*?held by )(\d{4}-\d{2}-\d{2}T[\w-]+)(.*)$/.exec(text)
  const holder = useStore((s) => (m ? s.runs.find((x) => x.id === m[2]) : undefined))
  const name = useStore((s) => (holder?.routine ? s.routines.find((x) => x.id === holder.routine)?.config.name ?? holder.routine : undefined))
  if (!m) return <>{text}</>
  // mesmo texto do History: nome da rotina e hora da run que segurava o lock
  const who = holder ? (holder.routine ? (name ?? holder.routine) : 'ad hoc') : undefined
  const label = holder ? `${who} · ${when(holder.started_at ?? holder.ended_at)}` : 'that run'
  return (
    <>
      {m[1]}
      <button className="link" onClick={() => openRun(m[2], who ?? 'Run')}>{label}</button>
      {m[3]}
    </>
  )
}

// Resposta ainda nao enviada, por conversa: fechar a run (Esc, ← Runs, clique fora) e voltar recupera o texto.
// Store com assinatura: a aba do dock e o modal da mesma run mostram o mesmo rascunho, sempre o da run atual.
const replyDrafts = new Map<string, string>()
const draftSubs = new Set<() => void>()
function setReplyDraft(id: string, v: string): void {
  if (v) replyDrafts.set(id, v)
  else replyDrafts.delete(id)
  draftSubs.forEach((f) => f())
}
const useReplyDraft = (id: string): string =>
  useSyncExternalStore(
    (cb) => (draftSubs.add(cb), () => draftSubs.delete(cb)),
    () => replyDrafts.get(id) ?? '',
  )

// ---------- conversa ----------

export function Conversation({ runId, compact, onHeadChange }: { runId: string; compact?: boolean; onHeadChange?: (id: string) => void }) {
  const [head, setHead] = useState(runId)
  useEffect(() => setHead(runId), [runId])
  const { runs, events } = useThread(head)
  const routines = useStore((s) => s.routines)
  const [follow, setFollow] = useState(true)
  // rascunho da conversa (chave = run raiz: o mesmo em qualquer follow-up aberto e em qualquer tela)
  const draftKey = runId
  const draft = useReplyDraft(draftKey)
  const setDraft = (v: string): void => setReplyDraft(draftKey, v)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const listRef = useRef<HTMLDivElement>(null)
  // caixa de resposta cresce com o texto ate o teto do CSS (200px), depois rola
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fitComposer = (): void => {
    const el = composerRef.current
    // aba escondida (fora do DOM / largura 0): medir daria 0; mede quando aparecer
    if (!el || !el.isConnected || !el.clientWidth) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 200)}px`
  }
  useLayoutEffect(fitComposer, [draft, runs.length])
  // largura ou fonte mudou (painel redimensionado, aba mostrada de novo, Interface size): mede de novo
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return
      w = el.clientWidth
      fitComposer()
    })
    ro.observe(el)
    const off = onSettings(() => requestAnimationFrame(fitComposer)) // Interface size / fonte
    return () => (ro.disconnect(), off())
  }, [runs.length > 0])

  const last = runs.at(-1)
  const first = runs[0]
  // Abriu um follow-up antigo: existe um mais novo continuando desta run.
  const newer = useStore((s) => {
    // segue a cadeia de follow-ups ate o fim: "View latest" leva direto ao mais novo
    let cur = last ? s.runs.find((r) => r.parent_id === last.id) : undefined
    for (let next = cur; next; next = s.runs.find((r) => r.parent_id === next!.id)) cur = next
    return cur
  })
  // Troca de conta (ranking): a run parou no limite e o main ja continuou a conversa numa filha. Segue sozinho para
  // ela — senao as permissoes da continuacao ficam invisiveis e responder aqui abriria um 2o --resume da mesma sessao.
  const rotatedTo = useStore((s) => (last?.status === 'rate_limited' ? s.runs.find((r) => r.parent_id === last.id) : undefined))
  useEffect(() => {
    if (!rotatedTo) return
    setHead(rotatedTo.id)
    onHeadChange?.(rotatedTo.id)
  }, [rotatedTo?.id])
  const routine = routines.find((r) => r.id === (last?.routine ?? first?.routine))
  const total = runs.reduce((n, r) => n + (events[r.id]?.length ?? 0), 0)
  const blocksByRun = useMemo(() => runs.map((r) => ({ run: r, blocks: toBlocks(events[r.id] ?? []) })), [runs, events])

  useEffect(() => {
    if (follow) listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [total, follow])
  // Ctrl+A em qualquer ponto da run (inclusive logo ao abrir, com o foco no dialogo) seleciona so a conversa
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const list = listRef.current
      const t = e.target as HTMLElement | null
      if (!list || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a' || t?.closest?.('input, textarea, .xterm')) return
      const scope = list.closest('.modal') ?? list.closest('.runview')
      if (!scope || !t || !(scope.contains(t) || t === document.body)) return
      if (t === document.body && !list.closest('.modal')) return
      e.preventDefault()
      const range = document.createRange()
      range.selectNodeContents(list.querySelector('.conv-inner') ?? list)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [])
  // Aba aberta escondida: a altura era 0 no primeiro scroll. Quando o painel aparece, desce ate o fim.
  const followRef = useRef(follow)
  const savedTop = useRef(0)
  followRef.current = follow
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    let h = el.clientHeight
    const ro = new ResizeObserver(() => {
      if (el.clientHeight && followRef.current) el.scrollTo({ top: el.scrollHeight })
      else if (!h && el.clientHeight) el.scrollTo({ top: savedTop.current }) // aba escondida e mostrada de novo
      h = el.clientHeight
    })
    ro.observe(el)
    // aba movida para outro grupo: volta ao fim (se acompanhava) ou a posicao em que estava
    const onMoved = (): void => {
      if (!el.isConnected || !el.clientHeight) return
      el.scrollTo({ top: followRef.current ? el.scrollHeight : savedTop.current })
    }
    window.addEventListener('turno:panels-moved', onMoved)
    return () => (ro.disconnect(), window.removeEventListener('turno:panels-moved', onMoved))
  }, [!!last])

  if (!last) return <div className="panel-empty">Loading run…</div>
  const tone = statusTone(last.status)
  const live = isActive(last)
  const canSend = live || !!last.session_id

  async function send(): Promise<void> {
    const text = draft.trim()
    if (!text || !last) return
    setSending(true)
    setError(undefined)
    try {
      const r = await window.turno.run.send(last.id, text)
      setDraft('')
      setFollow(true)
      if (r.mode === 'followup') {
        setHead(r.runId)
        onHeadChange?.(r.runId)
      }
    } catch (e) {
      setError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setSending(false)
    }
  }

  const resume = (): void =>
    openTerminal('right', {
      cwd: last.cwd ?? undefined,
      profile: last.profile, // preserva a connection real (custom inclusive); nao colapsa em claude-max
      initialCommand: `claude --resume ${last.session_id}`,
    }, `resume · ${routine?.config.name ?? 'session'}`)

  return (
    <div className="runview">
      <header className="run-head">
        <span className={`dot dot-${tone}`} />
        <div className="run-head-main">
          <div className="run-title">
            {routine ? routine.config.name : first.routine ?? 'Ad hoc run'}
            <span className={`pill pill-${tone}`}>{STATUS_LABEL[last.status]}</span>
          </div>
          <div className="muted small">
            {TRIGGER_LABEL[first.trigger]} · {last.model ?? 'default'} · {when(first.started_at ?? first.ended_at)}
            {first.started_at && (runs.length > 1 ? ` · ${totalDuration(runs)} total` : ` · ${duration(last)}`)}
            {runs.length > 1 && ` · ${plural(runs.length - 1, 'follow-up')}`}
          </div>
        </div>
        <div className="run-actions">
          {routine && !live && ['failed', 'aborted', 'timeout', 'idle_timeout', 'rate_limited'].includes(last.status) && (
            <button
              className="btn ghost"
              disabled={!!routine.error}
              title={routine.error ? `Fix the routine first: ${routine.error}` : 'Run this routine again'}
              onClick={() => void window.turno.run.startRoutine(routine.id).catch((e) => toast(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'))}
            >
              ↻ Run again
            </button>
          )}
          {routine && !compact && (
            <button className="btn ghost" data-focus-key={`run-configure:${routine.config.name}`} onClick={() => openRoutine(routine.id, routine.config.name, true)}>
              <IconRoutine /> Configure
            </button>
          )}
          {last.session_id && !live && (
            <button className="btn ghost" onClick={resume} title="Opens interactive Claude Code in this session">
              <IconTerminal /> Open in terminal
            </button>
          )}
          {live && (
            <button className="btn danger" onClick={() => void window.turno.run.stop(last.id)}>
              <IconStop /> Stop
            </button>
          )}
        </div>
      </header>

      {routine?.error && !compact && (
        <div className="conv-pinned">
          <div className="conv-inner">
            <FileErrorBanner id={routine.id} name={routine.config.name} error={routine.error} />
          </div>
        </div>
      )}

      <div
        className="conversation"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a' || (e.target as HTMLElement).closest('textarea, input')) return
          e.preventDefault()
          const sel = window.getSelection()
          const range = document.createRange()
          range.selectNodeContents(e.currentTarget.querySelector('.conv-inner') ?? e.currentTarget)
          sel?.removeAllRanges()
          sel?.addRange(range)
        }}
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          // salto para 0 sem o usuario (DOM reinserido ao mover a aba) nao conta como rolagem dele
          if (el.scrollTop === 0 && savedTop.current > 200 && !el.matches(':hover') && document.activeElement !== el) return
          savedTop.current = el.scrollTop
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
        }}
      >
        <div className="conv-inner">
          {blocksByRun.map(({ run, blocks }, i) => (
            <div key={run.id} className="conv-run">
              {i > 0 && <div className="conv-sep"><span>follow-up · {when(run.started_at)}</span></div>}
              {run.skip_reason && <div className="banner banner-warn">{run.status === 'skipped' ? 'Skipped: ' : ''}<SkipReason text={run.skip_reason} /></div>}
              {blocks.map((b, j) =>
                b.t === 'tools' ? (
                  <ToolRun key={j} items={b.items} />
                ) : b.t === 'perm' ? (
                  <PermissionCard key={j} ev={b.ev} reply={b.reply} live={isActive(run)} />
                ) : (
                  <EventBlock key={j} ev={b.ev} dur={b.dur} prevText={prevTextOf(blocks, j)} />
                ),
              )}
            </div>
          ))}
          {live && <LiveLine since={last.started_at} />}
          {!live && last.started_at && last.ended_at && last.status !== 'skipped' && (
            <div className="msg-sys">
              {last.status === 'ok' ? 'Worked for' : last.status === 'stopped' || last.status === 'aborted' ? 'Stopped after' : 'Failed after'} {fmtSecs(Math.round((Date.parse(last.ended_at) - Date.parse(last.started_at)) / 1000))}
            </div>
          )}
          {total === 0 && !live && <div className="muted pad">No events recorded.</div>}
        </div>
      </div>

      <div className="composer">
        {error && <div className="banner banner-err">{error}</div>}
        {newer && (
          <div className="banner banner-warn composer-newer">
            This conversation continued in a newer follow-up.{' '}
            <button className="link" onClick={() => (setHead(newer.id), onHeadChange?.(newer.id), listRef.current?.focus({ preventScroll: true }))}>View latest</button>
          </div>
        )}
        <div className="composer-box">
          <textarea
            ref={composerRef}
            rows={2}
            value={draft}
            disabled={!canSend || sending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={
              !canSend
                ? 'This run has no session to continue.'
                : live
                  ? 'Message the agent now (delivered after the current step)…'
                  : 'Continue the conversation (resumes the same session)…'
            }
          />
          <button className="btn primary send" disabled={!draft.trim() || !canSend || sending} onClick={() => void send()} aria-label="Send">
            <IconSend size={15} />
          </button>
        </div>
        {canSend && (
          <div className="composer-hint muted small">
            Enter sends · Shift+Enter new line · {live ? 'live in the current run' : 'creates a follow-up with --resume'}
          </div>
        )}
      </div>
    </div>
  )
}

export function RunViewer({ params, api }: IDockviewPanelProps<{ runId: string }>) {
  return <Conversation runId={params.runId} onHeadChange={(id) => api.updateParameters({ runId: id })} />
}

// Painel da rotina: mostra a execução atual/última e acompanha as próximas automaticamente.
export function RoutineSession({ params }: IDockviewPanelProps<{ routineId: string }>) {
  const routine = useStore((s) => s.routines.find((r) => r.id === params.routineId))
  const lastId = routine?.lastRun?.id
  const [shown, setShown] = useState(lastId)
  // Quando uma execução NOVA da rotina começa (não follow-up desta conversa), passa a mostrá-la.
  useEffect(() => {
    const lr = routine?.lastRun
    if (!lastId || !lr) return
    // Nova execução da rotina, ou continuação desta mesma conversa: acompanha.
    if (lr.trigger !== 'followup' || lr.parent_id === shown || !shown) setShown(lastId)
  }, [lastId])

  if (!routine) return <div className="panel-empty">Routine not found.</div>
  if (!shown)
    return (
      <div className="welcome">
        <h1>{routine.config.name}</h1>
        <p className="muted">Has not run yet. {routine.nextRuns[0] ? `Next run ${when(routine.nextRuns[0])}.` : ''}</p>
        {routine.error && <div className="banner banner-err welcome-err"><div className="banner-pre">This routine has an error: {routine.error}</div></div>}
        <div className="welcome-actions">
          <button className="btn primary" disabled={!!routine.error} title={routine.error ? 'Fix the error in Configure first' : undefined} onClick={() => void window.turno.run.startRoutine(routine.id)}>Run now</button>
          <button className="btn" onClick={() => openRoutine(routine.id, routine.config.name, true)}>Configure</button>
        </div>
      </div>
    )
  return <Conversation runId={shown} onHeadChange={setShown} />
}
