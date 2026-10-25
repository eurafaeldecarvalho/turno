import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as RMouseEvent, type ReactNode } from 'react'
import { FolderAgentDialog } from './FolderAgentDialog'
import { ackNeeds, needsYou, needsYouUnseen, STATUS_TEXT, usageText, useAgents, useAgentSessions } from './agentStore'
import { AgentButton } from './AgentButton'
import { toast } from './Toast'
import { createPortal } from 'react-dom'
import { menuKeyNav } from './modalStack'
import { useStore, isActive } from './store'
import { plural, scheduleSummary, statusTone, when, STATUS_LABEL } from './fmt'
import { openTasks, openHistory, openRoutine, openRoutineEditorModal, openTerminal, useOpenTabs, useRunsSeenAt, focusTab, closeTab, renameTab } from './layout'
import { openSettingsModal } from './SettingsModal'
import { openOnboarding, openWhatsNew } from './Onboarding'
import { IconHelp, IconCheck, IconChat, IconChevron, IconClock, IconClose, IconFanout, IconFolder, IconHistory, IconLink, IconMore, IconPlay, IconPlus, IconRoutine, IconSettings, IconSpark, IconStop, IconTerminal } from './icons'
import { addFolder, addTerminalItem, agentOf, closeItemTerminal, deleteFolder, deleteItem, getDragging, getItem, moveFolder, openItem, patchItem, renameFolder, saveItem, setDragging, toggleSection, useSidebar } from './sidebarStore'
import { dockApi, paramsOf, type OpenTab } from './layout'
import { setLive, useLive } from './liveTerms'
import { askConfirm } from './ConfirmDialog'
import { FolderDialog, ItemDialog } from './ItemDialog'
import type { AgentId, Connection, SidebarFolder, SidebarItem } from '../../shared/types'

// Deriva um label curto do LLM a partir da connection e model.
function llmLabel(connections: Connection[], profile: string, model: string): string {
  const conn = connections.find((c) => c.id === profile)
  if (conn?.kind === 'claude') return 'Claude'
  const m = (conn?.model ?? model ?? '').toLowerCase()
  const p = profile.toLowerCase()
  if (/qwen/i.test(m) || /qwen/i.test(p)) return 'Qwen'
  if (/codex/i.test(m) || /codex/i.test(p)) return 'Codex'
  if (/gemini/i.test(m) || /gemini/i.test(p)) return 'Gemini'
  if (/gpt|openai/i.test(m)) return 'OpenAI'
  if (/llama/i.test(m)) return 'Llama'
  if (/mistral/i.test(m)) return 'Mistral'
  if (/claude/i.test(m) || /claude/i.test(p)) return 'Claude'
  return conn?.name ?? 'Claude'
}

// 'claude-sonnet-4-5' → 'sonnet', 'claude-3-opus-20240229' → 'opus', custom → truncated
function shortModel(model: string): string {
  const m = model.replace(/^claude-/, '')
  const match = m.match(/\b(opus|sonnet|haiku|fable)\b/)
  if (match) return match[1]
  return m.split(/[-/:]/)[0]
}

// "Claude · sonnet · high": agente + modelo + esforco, so o que se souber.
const agentLine = (agent: string, model?: string | null, effort?: string): string =>
  [agent, model ? shortModel(model) || model : '', effort ?? ''].filter(Boolean).join(' · ')

// Nome curto do agent preset para os itens de pasta.
const AGENT_SHORT: Record<AgentId, string> = {
  claude: 'Claude',
  'claude-qwen': 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  'qwen-code': 'Qwen',
  opencode: 'OpenCode',
  custom: 'Custom',
}

// Clique simples espera um instante: se virar duplo clique (renomear), a acao do clique nao roda.
// Sem isso o 1o clique recolhia a pasta / abria o item (retomando a sessao do Claude) antes de renomear.
const DBL_MS = 240
function useSingleClick(action: () => void): (e: RMouseEvent) => void {
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const act = useRef(action)
  act.current = action
  useEffect(() => () => clearTimeout(t.current), [])
  return (e) => {
    clearTimeout(t.current)
    if (e.detail > 1) return
    t.current = setTimeout(() => act.current(), DBL_MS)
  }
}

// Nome editavel no lugar: duplo clique (ou F2) abre o campo; Enter salva, Esc cancela.
function InlineName({ value, onRename, className, startEdit, onEditStarted, lockedMsg }: {
  value: string
  onRename?: (v: string) => void
  className?: string
  startEdit?: boolean // pedido de edicao vindo de fora (menu "Rename")
  onEditStarted?: () => void
  lockedMsg?: string // por que o rename ficou indisponivel (ex. arquivo da rotina quebrou no meio da edicao)
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const done = useRef(false) // Enter ja gravou: o blur do campo saindo nao grava de novo
  const plain = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (onRename || !editing) return
    setEditing(false)
    if (lockedMsg) toast(lockedMsg, 'warn')
    requestAnimationFrame(() => plain.current?.closest('button')?.focus({ preventScroll: true }))
  }, [onRename])
  useEffect(() => {
    if (!startEdit) return
    setDraft(value)
    done.current = false
    setEditing(true)
    onEditStarted?.()
  }, [startEdit])
  if (!onRename) return <span ref={plain} className={className}>{value}</span>
  if (!editing)
    return (
      <span
        className={className}
        title={`${value}\nDouble-click to rename`}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setDraft(value)
          done.current = false
          setEditing(true)
        }}
      >
        {value}
      </span>
    )
  const refocus = (el: HTMLElement): void => {
    const row = el.closest('button')
    requestAnimationFrame(() => row?.isConnected && row.focus({ preventScroll: true }))
  }
  const commit = (el?: HTMLElement): void => {
    if (done.current) return
    done.current = true
    const v = draft.trim()
    if (v && v !== value) onRename(v)
    setEditing(false)
    if (el) refocus(el)
  }
  return (
    <input
      className="inline-rename"
      aria-label={`Rename ${value}`}
      autoFocus
      value={draft}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') (e.preventDefault(), commit(e.currentTarget))
        else if (e.key === 'Escape') ((done.current = true), setEditing(false), refocus(e.currentTarget))
      }}
      // O campo fica dentro do botao da linha: soltar Espaco/Enter ativaria o botao (abria o item,
      // retomando a sessao do Claude, ou recolhia a pasta). Bloqueia a ativacao.
      onKeyUp={(e) => {
        e.stopPropagation()
        if (e.key === ' ' || e.key === 'Enter') e.preventDefault()
      }}
    />
  )
}

function ItemOpenButton({ item, onF2, title, children }: { item: SidebarItem; onF2: () => void; title?: string; children: ReactNode }) {
  const open = useSingleClick(() => void openItem(item))
  return (
    <button className="routine-main" onClick={open} onKeyDown={(e) => e.key === 'F2' && (e.preventDefault(), onF2())} title={title}>
      {children}
    </button>
  )
}

function RoutineOpenButton({ onOpen, onKeyDown, title, children }: { onOpen: () => void; onKeyDown: (e: React.KeyboardEvent) => void; title?: string; children: ReactNode }) {
  const open = useSingleClick(onOpen)
  return (
    <button className="routine-main" onClick={open} onKeyDown={onKeyDown} title={title}>
      {children}
    </button>
  )
}

// Secao recolhivel da barra lateral (Rotinas e cada pasta).
function Section({ id, title, count, actions, children, folder, dropping, onRename, onContextMenu, rename, defaultClosed }: {
  id: string
  title: string
  onRename?: (v: string) => void
  count?: number
  actions?: ReactNode
  children: ReactNode
  folder?: boolean
  dropping?: boolean
  onContextMenu?: (e: RMouseEvent) => void
  rename?: { start: boolean; started: () => void }
  defaultClosed?: boolean
}) {
  const { collapsed } = useSidebar()
  const closed = collapsed[id] ?? !!defaultClosed
  const [f2, setF2] = useState(false)
  const delayedToggle = useSingleClick(() => toggleSection(id, closed))
  return (
    <section className={`side-section ${closed ? 'closed' : ''} ${dropping ? 'drop-target' : ''}`} data-folder-id={folder ? id : undefined}>
      <div className="section-head" onContextMenu={onContextMenu}>
        <button
          className="section-toggle"
          title={title}
          onClick={onRename ? delayedToggle : () => toggleSection(id, closed)}
          onKeyDown={(e) => onRename && e.key === 'F2' && (e.preventDefault(), setF2(true))}
          aria-expanded={!closed}
        >
          <IconChevron size={12} className="chev" />
          <InlineName
            className="section-title"
            value={title}
            onRename={onRename}
            startEdit={rename?.start || f2}
            onEditStarted={() => (setF2(false), rename?.started())}
          />
          {closed && count !== undefined && <span className="section-count">{count}</span>}
        </button>
        <span className="section-actions">{actions}</span>
      </div>
      {!closed && children}
    </section>
  )
}

function Menu({ items, label = 'More options', icon }: { items: Array<{ label: string; danger?: boolean; onClick: () => void }>; label?: string; icon?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const close = (e: MouseEvent): void => void (!ref.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node) && setOpen(false))
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return void (setOpen(false), trigger.current?.focus())
      menuKeyNav(e, list.current)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <span className="menu-wrap" ref={ref}>
      <button ref={trigger} className="icon-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon ?? <IconMore size={14} />}
      </button>
      {open &&
        createPortal(
        <div className="menu menu-floating" role="menu" ref={list} style={menuPos(trigger.current)}>
          {items.map((it, i) => [
            it.danger && i > 0 && !items[i - 1].danger && <div key={`sep-${i}`} className="menu-sep" role="separator" />,
            // foco volta ao gatilho antes da acao: um confirm aberto daqui devolve o foco para ele
            <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => (trigger.current?.focus(), setOpen(false), it.onClick())}>
              {it.label}
            </button>,
          ])}
        </div>,
          document.body,
        )}
    </span>
  )
}

// Posicao fixa abaixo do gatilho (ou acima, se nao couber): o menu nao fica preso na rolagem da sidebar.
function menuPos(t: HTMLElement | null): React.CSSProperties {
  if (!t) return {}
  const r = t.getBoundingClientRect()
  const up = window.innerHeight - r.bottom < 180
  return { position: 'fixed', right: Math.max(4, window.innerWidth - r.right), ...(up ? { top: 'auto', bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4, bottom: 'auto' }) }
}

type MenuItem = { label: string; danger?: boolean; onClick: () => void }

// Menu do botao direito: abre no ponteiro e fica dentro da janela.
function ContextMenu({ x, y, items, onClose, opener }: { x: number; y: number; items: MenuItem[]; onClose: () => void; opener?: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) })
  }, [x, y])
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const down = (e: MouseEvent): void => void (!ref.current?.contains(e.target as Node) && onClose())
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return void (onClose(), opener?.isConnected && opener.focus())
      menuKeyNav(e, ref.current)
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])
  return (
    <div ref={ref} className="menu context-menu" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => [
        it.danger && i > 0 && !items[i - 1].danger && <div key={`sep-${i}`} className="menu-sep" role="separator" />,
        <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => (opener?.isConnected && opener.focus(), onClose(), it.onClick())}>
          {it.label}
        </button>,
      ])}
    </div>
  )
}

const lastPart = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

type Dialog =
  | { t: 'folder'; folder?: SidebarFolder }
  | { t: 'agent-setup'; folder: SidebarFolder }
  | { t: 'item'; folderId: string; item?: SidebarItem }

// Pasta sob o ponteiro durante um arrasto de aba (funciona com drag HTML5 ou por ponteiro).
function folderAt(x: number, y: number): string | undefined {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  return el?.closest<HTMLElement>('[data-folder-id]')?.dataset.folderId
}

function useTerminalDrop(): string | undefined {
  const [hover, setHover] = useState<string>()
  useEffect(() => {
    const over = (e: DragEvent | PointerEvent): void => {
      if (!getDragging()) return
      const f = folderAt(e.clientX, e.clientY)
      setHover(f)
      if (f && 'dataTransfer' in e) {
        e.preventDefault() // permite soltar aqui
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move' // tem que bater com o effectAllowed do dockview
      }
    }
    const drop = (e: DragEvent | PointerEvent): void => {
      const d = getDragging()
      const f = d && folderAt(e.clientX, e.clientY)
      if (d && f) {
        e.preventDefault()
        e.stopPropagation()
        // Aba que ja e de um item: so muda o item de pasta.
        const linked = d.params.itemId ? getItem(d.params.itemId) : undefined
        if (linked) return void (saveItem(f, linked), setDragging(undefined), setHover(undefined), window.dispatchEvent(new Event('turno:redraw-terminals')))
        const itemId = addTerminalItem(f, d.params, d.title)
        requestAnimationFrame(() => {
          const row = document.querySelector<HTMLElement>(`[data-item-id="${itemId}"]`)
          row?.scrollIntoView({ block: 'nearest' })
          row?.querySelector<HTMLElement>('.routine-main')?.focus({ preventScroll: true })
        })
        const panel = dockApi()?.getPanel(d.id)
        panel?.api.updateParameters({ ...paramsOf(panel), itemId })
        if (panel) setLive(itemId, 'open')
      }
      setDragging(undefined)
      setHover(undefined)
      if (d) window.dispatchEvent(new Event('turno:redraw-terminals'))
    }
    const end = (): void => {
      if (getDragging()) window.dispatchEvent(new Event('turno:redraw-terminals'))
      setDragging(undefined)
      setHover(undefined)
    }
    window.addEventListener('dragover', over, true)
    window.addEventListener('pointermove', over, true)
    window.addEventListener('drop', drop, true)
    window.addEventListener('pointerup', drop, true)
    window.addEventListener('dragend', end, true)
    return () => {
      window.removeEventListener('dragover', over, true)
      window.removeEventListener('pointermove', over, true)
      window.removeEventListener('drop', drop, true)
      window.removeEventListener('pointerup', drop, true)
      window.removeEventListener('dragend', end, true)
    }
  }, [])
  return hover
}

// Referencia estavel: um `[]` novo a cada getSnapshot faz o useSyncExternalStore entrar em loop (React #185).
const NO_CONNECTIONS: never[] = []

export function Sidebar() {
  const { folders } = useSidebar()
  const [dialog, setDialog] = useState<Dialog>()
  // menu New (botao da sidebar ou "+" de um painel) pede uma pasta nova
  useEffect(() => {
    const f = (): void => setDialog({ t: 'folder' })
    window.addEventListener('turno:new-folder', f)
    return () => window.removeEventListener('turno:new-folder', f)
  }, [])
  const dropFolder = useTerminalDrop()
  const live = useLive()
  // terminais vivos (aba aberta ou escondida) dos itens de uma pasta: fechados ao excluir a pasta
  const runningIn = (f: SidebarFolder): number => f.items.filter((it) => live.get(it.id) === 'hidden').length // abas abertas continuam
  const [ctx, setCtx] = useState<{ x: number; y: number; items: MenuItem[]; opener?: HTMLElement | null }>()
  const closeCtx = useCallback(() => setCtx(undefined), [])
  const menuAt = (items: MenuItem[]) => (e: RMouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const src = e.currentTarget as HTMLElement
    setCtx({ x: e.clientX, y: e.clientY, items, opener: src.matches('button') ? src : src.querySelector<HTMLElement>('button') ?? src })
  }
  // Renomear pelo menu: liga o campo do nome certo ("folder:<id>", "item:<id>", "routine:<id>").
  const [renaming, setRenaming] = useState<string>()
  const renameProps = (key: string) => ({ startEdit: renaming === key, onEditStarted: () => setRenaming(undefined) })
  const routines = useStore((s) => s.routines)
  const runs = useStore((s) => s.runs)
  const connections = useStore((s) => s.settings?.connections ?? NO_CONNECTIONS)
  const running = runs.filter(isActive)
  const seenAt = useRunsSeenAt()
  // falhas das ultimas 24h que aconteceram DEPOIS da ultima vez que a pessoa abriu Runs (abrir Runs zera o badge)
  const problems = runs.filter((r) => {
    const t = Date.parse(r.ended_at ?? r.started_at ?? '0')
    return t > seenAt && Date.now() - t < 86_400_000 && !['ok', 'running', 'queued', 'skipped'].includes(r.status)
  })
  const openTabs = useOpenTabs()
  // agente + modelo + esforco da aba (rotina, run, terminal com agente); terminal comum nao tem linha
  const routineLine = (id: string | null | undefined): string | undefined => {
    const r = id ? routines.find((x) => x.id === id) : undefined
    if (!r) return undefined
    const conn = connections.find((c) => c.id === r.config.profile)
    const model = conn?.kind === 'endpoint' && conn.model ? conn.model : r.config.model
    return agentLine(llmLabel(connections, r.config.profile, model), model, r.config.effort)
  }
  const agentsSt = useAgents()
  const agentSessions = useAgentSessions()
  const tabLine = (tab: OpenTab): string | undefined => {
    if (tab.agentKey) {
      // aba de agente: status + conta atual (+ uso, quando o agente informa)
      const s = agentSessions.find((x) => x.key === tab.agentKey)
      if (!s) return undefined
      const acc = agentsSt.accounts.find((a) => a.id === s.accountId)
      return [STATUS_TEXT[s.status], acc?.label, usageText(agentsSt.usage[s.accountId])].filter(Boolean).join(' · ')
    }
    if (tab.kind === 'session') return routineLine(tab.routineId)
    if (tab.kind === 'run') {
      const run = runs.find((x) => x.id === tab.runId)
      if (!run) return undefined
      return routineLine(run.routine) ?? agentLine(llmLabel(connections, run.profile, run.model ?? ''), run.model)
    }
    if (tab.kind === 'terminal' && tab.profile) {
      const conn = connections.find((c) => c.id === tab.profile)
      const model = conn?.kind === 'endpoint' ? conn.model : /--model[ =](\S+)/.exec(tab.command ?? '')?.[1]
      return agentLine(llmLabel(connections, tab.profile, model ?? ''), model)
    }
    return tab.kind === 'terminal' && tab.agent ? 'Claude' : undefined
  }
  const activeTab = openTabs.find((t) => t.active)?.id
  useEffect(() => {
    if (activeTab) document.querySelector(`.sidebar [aria-current="page"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeTab])
  type IconComp = (p: { size?: number }) => React.ReactElement
  const KIND_ICON_SIDEBAR: Record<string, IconComp> = {
    terminal: IconTerminal as IconComp, routine: IconRoutine as IconComp, run: IconClock as IconComp,
    session: IconChat as IconComp, history: IconHistory as IconComp, adhoc: IconSpark as IconComp,
    fanout: IconFanout as IconComp, settings: IconSettings as IconComp,
    chat: IconChat as IconComp, tasks: IconCheck as IconComp,
  }

  return (
    <aside className="sidebar">
      <div className="brand drag">
        <img src="./icon.png" alt="" width={18} height={18} />
        <span>Turno</span>
      </div>

      {/* topo: um botao New (verbos) e os lugares do app (destinos, com contadores) */}
      <nav className="nav" aria-label="Workspace">
        <AgentButton />
        <button onClick={() => openTasks()}>
          <IconCheck /> Tasks
        </button>
        <button onClick={() => openHistory()}>
          <IconHistory /> Runs
          {running.length > 0 && <span className="count run" title="running now">{running.length}</span>}
          {problems.length > 0 && <span className="count err" title="failures in the last 24h">{problems.length}</span>}
        </button>
      </nav>

      <div className="side-scroll">
      <NeedsYou />
      <Section
        id="routines"
        title="Routines"
        count={routines.length}
        actions={
          <button className="icon-btn" title="New routine" aria-label="New routine" onClick={() => openRoutine(null, 'New routine')}>
            <IconPlus size={14} />
          </button>
        }
      >
      <ul className="routines">
        {routines.length === 0 && (
          <li className="empty muted small">
            No routines yet. Click <b>+</b> to create the first one.
          </li>
        )}
        {routines.map((r) => {
          const last = r.lastRun
          const active = isActive(last)
          const tone = r.error || !connections.some((c) => c.id === r.config.profile) ? 'err' : active ? 'run' : !r.config.enabled ? 'idle' : statusTone(last?.status)
          // conexao removida em Settings: a rotina e pulada; o subtitulo avisa em vez de parecer normal
          const noConn = !r.error && !connections.some((c) => c.id === r.config.profile)
          const sub = r.error
            ? 'error in ROUTINE.md'
            : noConn
              ? 'connection removed · pick one in Configure'
              : active
              ? 'running now'
              : !r.config.enabled
                ? `off · ${scheduleSummary(r.config)}`
                : r.nextRuns[0]
                  ? `next ${when(r.nextRuns[0])}`
                  : scheduleSummary(r.config)
          // endpoint (ex. Ollama) roda o modelo da conexao, nao o campo model da rotina
          const conn = connections.find((c) => c.id === r.config.profile)
          const effModel = conn?.kind === 'endpoint' && conn.model ? conn.model : r.config.model
          const runNow = async (): Promise<void> => {
            const id = await window.turno.run.startRoutine(r.id).catch(() => '')
            if (id) openRoutine(r.id, r.config.name)
          }
          const routineMenu: MenuItem[] = [
            { label: 'Open', onClick: () => openRoutine(r.id, r.config.name) },
            { label: 'Configure', onClick: () => openRoutineEditorModal(r.id) },
            ...(active
              ? [{ label: 'Stop', onClick: () => void window.turno.run.stop(last!.id) }]
              : r.error ? [] : [{ label: 'Run now', onClick: () => void runNow() }]),
            ...(r.error ? [] : [{ label: r.config.enabled ? 'Disable' : 'Enable', onClick: () => void window.turno.routines.setEnabled(r.id, !r.config.enabled) }]),
            ...(r.error ? [] : [{ label: 'Rename', onClick: () => setRenaming(`routine:${r.id}`) }]),
            { label: 'Open folder', onClick: () => void window.turno.routines.openFolder(r.id) },
            {
              label: 'Delete routine',
              danger: true,
              onClick: async () => {
                const ok = await askConfirm({ title: 'Delete routine', message: `Delete the routine "${r.config.name}"? Its folder goes to the Recycle Bin; past runs stay in the history.` })
                if (!ok) return
                await window.turno.routines.delete(r.id).catch((e) => alert(String(e?.message ?? e)))
                for (const pid of [`routine:${r.id}`, `session:${r.id}`]) dockApi()?.getPanel(pid)?.api.close()
                requestAnimationFrame(() => (!document.activeElement || document.activeElement === document.body) && window.dispatchEvent(new Event('turno:focus-active-panel')))
              },
            },
          ]
          return (
            <li key={r.id} className={`routine ${r.config.enabled ? '' : 'off'}`} onContextMenu={menuAt(routineMenu)}>
              <RoutineOpenButton onOpen={() => openRoutine(r.id, r.config.name)} onKeyDown={(e) => !r.error && e.key === 'F2' && (e.preventDefault(), setRenaming(`routine:${r.id}`))} title={r.error ? `Error in ROUTINE.md: ${r.error}` : r.config.description || r.config.name}>
                <span className={`dot dot-${tone}`} />
                <span className="routine-text">
                  <InlineName
                    className="routine-name"
                    value={r.config.name}
                    onRename={r.error ? undefined : (v) => void window.turno.routines.save({ id: r.id, originalId: r.id, config: { ...r.config, name: v }, prompt: r.prompt, expectContent: JSON.stringify([r.config, r.prompt]) }).catch((e) => toast(`Couldn't rename: ${String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'err'))}
                    lockedMsg="Rename isn't available while ROUTINE.md has an error. Fix it in Configure."
                    {...renameProps(`routine:${r.id}`)}
                  />
                  <span className="routine-sub">
                    {sub && <span>{sub}</span>}
                    {last && !active && last.status !== 'ok' && <span className={`tone-${statusTone(last.status)}`}> · {STATUS_LABEL[last.status]}</span>}
                  </span>
                </span>
              </RoutineOpenButton>
              <span className="routine-actions">
                <button className="icon-btn" title="Configure" aria-label="Configure" data-focus-key={`configure:${r.config.name}`} onClick={() => openRoutineEditorModal(r.id)}>
                  <IconSettings size={14} />
                </button>
                {active ? (
                  <button className="icon-btn" title="Stop" aria-label="Stop" onClick={() => void window.turno.run.stop(last!.id)}>
                    <IconStop size={14} />
                  </button>
                ) : (
                  <button
                    className="icon-btn"
                    title={r.error ? `Can't run: fix ROUTINE.md first (${r.error})` : 'Run now'}
                    aria-label="Run now"
                    disabled={!!r.error}
                    onClick={() => void runNow()}
                  >
                    <IconPlay size={14} />
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      </Section>

      {/* pastas do usuario num grupo so, com o "+" sempre visivel no cabecalho */}
      <Section
        id="folders"
        title="Folders"
        count={folders.length}
        actions={
          <button className="icon-btn new-folder" title="New folder" aria-label="New folder" onClick={() => setDialog({ t: 'folder' })}>
            <IconPlus size={14} />
          </button>
        }
      >
      {!folders.length && (
        <p className="empty muted small side-empty">
          No folders yet. Use <b>+</b> to keep agent chats, terminals and links together.
        </p>
      )}
      <div className="folder-list">
      {folders.map((f, i) => {
        const delFolder = (): void => {
          void askConfirm({
            title: 'Delete folder',
            message: f.items.length
              ? `Delete the folder "${f.name}" and its ${plural(f.items.length, 'item')}? The sessions themselves are not deleted.` +
                (runningIn(f) ? ` ${plural(runningIn(f), 'hidden running terminal')} will be closed; open tabs stay open.` : '')
              : `Delete the folder "${f.name}"?`,
          }).then((ok) => {
            if (!ok) return
            // o botao que abriu o menu some junto com a pasta: foco na pasta vizinha (ou em "New folder")
            const next = folders[i + 1] ?? folders[i - 1]
            deleteFolder(f.id)
            setTimeout(() => (document.querySelector<HTMLElement>(next ? `[data-folder-id="${next.id}"] .section-toggle` : '.new-folder') ?? undefined)?.focus(), 50)
          })
        }
        const folderMenu: MenuItem[] = [
          { label: 'New chat or link', onClick: () => setDialog({ t: 'item', folderId: f.id }) },
          { label: 'Rename', onClick: () => setRenaming(`folder:${f.id}`) },
          { label: 'Agent setup (MCP, context)…', onClick: () => setDialog({ t: 'agent-setup', folder: f }) },
          ...(i > 0 ? [{ label: 'Move up', onClick: () => moveFolder(f.id, -1) }] : []),
          ...(i < folders.length - 1 ? [{ label: 'Move down', onClick: () => moveFolder(f.id, 1) }] : []),
          { label: 'Delete folder', danger: true, onClick: delFolder },
        ]
        return (
        <Section
          key={f.id}
          id={f.id}
          folder
          onContextMenu={menuAt(folderMenu)}
          rename={{ start: renaming === `folder:${f.id}`, started: () => setRenaming(undefined) }}
          dropping={dropFolder === f.id}
          title={f.name}
          onRename={(v) =>
            folders.some((o) => o.id !== f.id && o.name.trim().toLowerCase() === v.trim().toLowerCase())
              ? toast(`A folder named "${v.trim()}" already exists.`, 'warn')
              : renameFolder(f.id, v)
          }
          count={f.items.length}
          actions={
            <>
              <button className="icon-btn" title="New chat or link" aria-label="New item" onClick={() => setDialog({ t: 'item', folderId: f.id })}>
                <IconPlus size={14} />
              </button>
              <Menu items={folderMenu.filter((m) => m.label !== 'New chat or link')} />
            </>
          }
        >
          <ul className="routines">
            {!f.items.length && (
              <li className="empty muted small">
                Empty. Use <b>+</b> or drag a terminal tab here.
              </li>
            )}
            {f.items.map((it) => {
              const state = live.get(it.id)
              const removeItem = (): void =>
                void askConfirm({ title: 'Remove item', message: it.kind === 'link' ? `Remove the link "${it.name}" from the folder?` : `Remove "${it.name}" from the folder?${it.sessionId ? ' The session is not deleted.' : ''}${live.get(it.id) === 'hidden' ? ' Its hidden running terminal will be closed.' : live.get(it.id) ? ' Its tab stays open.' : ''}`, confirmLabel: 'Remove' }).then(
                  (ok) => ok && (deleteItem(it.id), requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-folder-id="${f.id}"] .section-toggle`)?.focus())),
                )
              const itemMenu: MenuItem[] = [
                { label: it.kind === 'link' ? 'Open link' : state ? 'Show' : 'Open', onClick: () => void openItem(it) },
                { label: 'Rename', onClick: () => setRenaming(`item:${it.id}`) },
                { label: 'Edit…', onClick: () => setDialog({ t: 'item', folderId: f.id, item: it }) },
                ...(state ? [{ label: 'Close terminal', onClick: () => closeItemTerminal(it.id) }] : []),
                { label: 'Remove from folder', danger: true, onClick: removeItem },
              ]
              return (
              <li key={it.id} data-item-id={it.id} className="routine" onContextMenu={menuAt(itemMenu)}>
                <ItemOpenButton item={it} onF2={() => setRenaming(`item:${it.id}`)} title={it.kind === 'link' ? it.url : `${it.kind === 'terminal' && !it.sessionId ? 'Terminal' : agentOf(it.agent).name}${it.cwd ? ` · ${it.cwd}` : ''}`}>
                  <span className="item-icon">
                    {it.kind === 'link' ? <IconLink size={14} /> : it.kind === 'terminal' && !it.sessionId ? <IconTerminal size={14} /> : <IconChat size={14} />}
                    {state && <span className={`live-dot ${state}`} title={state === 'open' ? 'Open in a tab' : 'Running in the background (hidden)'} />}
                  </span>
                  <span className="routine-text">
                    <InlineName className="routine-name" value={it.name} onRename={(v) => patchItem(it.id, { name: v })} {...renameProps(`item:${it.id}`)} />
                    <span className="routine-sub">
                      {it.kind === 'link'
                        ? (it.url ?? '').replace(/^https?:[/][/]/, '').slice(0, 40)
                        : it.kind === 'terminal' && !it.sessionId
                          ? `terminal${it.cwd ? ` · ${lastPart(it.cwd)}` : ''}`
                          : agentLine(AGENT_SHORT[(it.agent ?? 'claude') as AgentId] ?? agentOf(it.agent).name, it.model)}
                    </span>
                  </span>
                </ItemOpenButton>
                <span className="routine-actions">
                  <button className="icon-btn" title="Edit" aria-label="Edit" onClick={() => setDialog({ t: 'item', folderId: f.id, item: it })}>
                    <IconSettings size={14} />
                  </button>
                  <button className="icon-btn" title="Remove from folder" aria-label="Remove" onClick={removeItem}>
                    <IconClose size={14} />
                  </button>
                </span>
              </li>
              )
            })}
          </ul>
        </Section>
        )
      })}

      </div>
      </Section>
      {openTabs.length > 0 && (
        <Section id="open-tabs" title="Open tabs" count={openTabs.length} defaultClosed>
          <ul className="routines">
            {openTabs.map((tab) => {
              const Icon = tab.agent ? (IconChat as IconComp) : KIND_ICON_SIDEBAR[tab.kind] ?? (IconTerminal as IconComp)
              return (
                <li
                  key={tab.id}
                  aria-current={tab.active ? 'page' : undefined}
                  className={`routine ${tab.active ? 'current' : ''}`}
                  draggable={tab.kind === 'terminal'}
                  onDragStart={(e) => {
                    // Mesmo caminho do arrasto de aba do dockview: o drop numa pasta vira item.
                    const panel = dockApi()?.getPanel(tab.id)
                    if (!panel) return e.preventDefault()
                    setDragging({ id: tab.id, params: paramsOf(panel), title: tab.title || 'terminal' })
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('application/x-turno-tab', tab.id) // tipo proprio: soltar num campo de texto nao cola o id
                  }}
                >
                  <button className="routine-main" onClick={() => focusTab(tab.id)} onKeyDown={(e) => e.key === 'F2' && (e.preventDefault(), setRenaming(`tab:${tab.id}`))} title={tab.kind === 'terminal' ? `${tab.title}
Drag onto a folder to keep it` : tab.title}>
                    <span className="item-icon">
                      <Icon size={14} />
                      {(() => {
                        const s = tab.agentKey ? agentSessions.find((x) => x.key === tab.agentKey) : undefined
                        return s && s.status !== 'starting' ? <span className={`tab-status st-${s.status}`} aria-hidden /> : null
                      })()}
                    </span>
                    <span className="routine-text">
                      <InlineName className="routine-name" value={tab.title || tab.kind} onRename={(v) => renameTab(tab.id, v)} {...renameProps(`tab:${tab.id}`)} />
                      {tabLine(tab) && <span className="routine-sub">{tabLine(tab)}</span>}
                    </span>
                  </button>
                  <span className="routine-actions">
                    <button className="icon-btn" title="Close tab" aria-label="Close tab" onClick={() => closeTab(tab.id)}>
                      <IconClose size={14} />
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      </div>

      <div className="sidebar-foot">
        <button className="foot-btn" onClick={() => openSettingsModal()}>
          <IconSettings /> Settings
          <kbd>Ctrl+,</kbd>
        </button>
        <Menu
          label="Help"
          icon={<IconHelp size={16} />}
          items={[
            { label: 'Command palette  (Ctrl+Shift+P)', onClick: () => window.dispatchEvent(new Event('turno:palette')) },
            { label: 'Keyboard shortcuts', onClick: () => openSettingsModal('shortcuts') },
            { label: 'Show the setup tour', onClick: () => openOnboarding() },
            { label: "What's new", onClick: () => void openWhatsNew(true) },
            { label: 'Open routines folder', onClick: () => void window.turno.routines.openFolder() },
            { label: 'About Turno', onClick: () => openSettingsModal('about') },
          ]}
        />
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={closeCtx} opener={ctx.opener} />}
      {dialog?.t === 'folder' && (
        <FolderDialog
          initial={dialog.folder?.name}
          onClose={() => setDialog(undefined)}
          onSave={(name) => (dialog.folder ? renameFolder(dialog.folder.id, name) : addFolder(name))}
        />
      )}
      {dialog?.t === 'agent-setup' && <FolderAgentDialog folder={dialog.folder} onClose={() => setDialog(undefined)} />}
      {dialog?.t === 'item' && <ItemDialog folderId={dialog.folderId} item={dialog.item} onClose={() => setDialog(undefined)} />}

    </aside>
  )
}

// "Precisa de voce": agentes esperando resposta, permissao, com erro ou sem conta livre (inclui abas de pastas).
function NeedsYou() {
  const sessions = useAgentSessions().filter(needsYouUnseen)
  useOpenTabs() // re-renderiza quando as abas mudam
  // ir para a aba (clique na aba, atalho, paleta) conta como visto
  const api = dockApi()
  useEffect(() => {
    if (!api) return
    const d = api.onDidActivePanelChange(({ panel: p }) => ackNeeds(p ? (paramsOf(p) as { agent?: { key: string } }).agent?.key : undefined))
    return () => d.dispose()
  }, [api])
  const rows = sessions
    .map((s) => ({ s, panel: dockApi()?.panels.find((p) => (paramsOf(p) as { agent?: { key: string } }).agent?.key === s.key) }))
    .filter((r) => r.panel)
  if (!rows.length) return null
  return (
    <section className="side-section needs-you" aria-label="Needs you">
      <div className="section-head"><span className="section-title">Needs you</span><span className="section-count">{rows.length}</span></div>
      <ul className="routines">
        {rows.map(({ s, panel }) => (
          <li key={s.key} className="routine">
            <button className="routine-main" onClick={() => (ackNeeds(s.key), focusTab(panel!.id))} title={s.message ?? STATUS_TEXT[s.status]}>
              <span className="item-icon"><span className={`tab-status st-${s.status}`} aria-hidden /></span>
              <span className="routine-text">
                <span className="routine-name">{panel!.title}</span>
                <span className="routine-sub">{s.message ?? STATUS_TEXT[s.status]}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
