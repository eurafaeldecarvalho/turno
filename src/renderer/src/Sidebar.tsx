import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as RMouseEvent, type ReactNode } from 'react'
import { useStore, isActive } from './store'
import { scheduleSummary, statusTone, when, STATUS_LABEL } from './fmt'
import { openAdhoc, openFanout, openHistory, openRoutine, openRoutineEditorModal, openTerminal, useOpenTabs, focusTab, closeTab } from './layout'
import { openSettingsModal } from './SettingsModal'
import { IconChat, IconChevron, IconClock, IconClose, IconFolder, IconHistory, IconLink, IconMore, IconPlay, IconPlus, IconRoutine, IconSettings, IconSpark, IconStop, IconTerminal } from './icons'
import { addFolder, addTerminalItem, agentOf, closeItemTerminal, deleteFolder, deleteItem, getDragging, getItem, moveFolder, openItem, patchItem, renameFolder, saveItem, setDragging, toggleSection, useSidebar } from './sidebarStore'
import { dockApi, paramsOf } from './layout'
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

// Nome editavel no lugar: duplo clique (ou F2) abre o campo; Enter salva, Esc cancela.
function InlineName({ value, onRename, className, startEdit, onEditStarted }: {
  value: string
  onRename?: (v: string) => void
  className?: string
  startEdit?: boolean // pedido de edicao vindo de fora (menu "Rename")
  onEditStarted?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    if (!startEdit) return
    setDraft(value)
    setEditing(true)
    onEditStarted?.()
  }, [startEdit])
  if (!onRename) return <span className={className}>{value}</span>
  if (!editing)
    return (
      <span
        className={className}
        title="Double-click to rename"
        onDoubleClick={(e) => {
          e.stopPropagation()
          setDraft(value)
          setEditing(true)
        }}
      >
        {value}
      </span>
    )
  const commit = (): void => {
    const v = draft.trim()
    if (v && v !== value) onRename(v)
    setEditing(false)
  }
  return (
    <input
      className="inline-rename"
      autoFocus
      value={draft}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}

// Secao recolhivel da barra lateral (Rotinas e cada pasta).
function Section({ id, title, count, actions, children, folder, dropping, onRename, onContextMenu, rename }: {
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
}) {
  const { collapsed } = useSidebar()
  const closed = !!collapsed[id]
  return (
    <section className={`side-section ${closed ? 'closed' : ''} ${dropping ? 'drop-target' : ''}`} data-folder-id={folder ? id : undefined}>
      <div className="section-head" onContextMenu={onContextMenu}>
        <button className="section-toggle" onClick={() => toggleSection(id)} aria-expanded={!closed}>
          <IconChevron size={12} className="chev" />
          <InlineName className="section-title" value={title} onRename={onRename} startEdit={rename?.start} onEditStarted={rename?.started} />
          {closed && count !== undefined && <span className="section-count">{count}</span>}
        </button>
        <span className="section-actions">{actions}</span>
      </div>
      {!closed && children}
    </section>
  )
}

function Menu({ items }: { items: Array<{ label: string; danger?: boolean; onClick: () => void }> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => void (!ref.current?.contains(e.target as Node) && setOpen(false))
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <span className="menu-wrap" ref={ref}>
      <button className="icon-btn" aria-label="More options" title="More options" onClick={() => setOpen(!open)}>
        <IconMore size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => (setOpen(false), it.onClick())}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

type MenuItem = { label: string; danger?: boolean; onClick: () => void }

// Menu do botao direito: abre no ponteiro e fica dentro da janela.
function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) })
  }, [x, y])
  useEffect(() => {
    const down = (e: MouseEvent): void => void (!ref.current?.contains(e.target as Node) && onClose())
    const key = (e: KeyboardEvent): void => void (e.key === 'Escape' && onClose())
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
      {items.map((it) => (
        <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => (onClose(), it.onClick())}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

const lastPart = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

type Dialog =
  | { t: 'folder'; folder?: SidebarFolder }
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
        if (linked) return void (saveItem(f, linked), setDragging(undefined), setHover(undefined))
        const itemId = addTerminalItem(f, d.params, d.title)
        const panel = dockApi()?.getPanel(d.id)
        panel?.api.updateParameters({ ...paramsOf(panel), itemId })
        if (panel) setLive(itemId, 'open')
      }
      setDragging(undefined)
      setHover(undefined)
    }
    const end = (): void => {
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

export function Sidebar() {
  const { folders } = useSidebar()
  const [dialog, setDialog] = useState<Dialog>()
  const dropFolder = useTerminalDrop()
  const live = useLive()
  const [ctx, setCtx] = useState<{ x: number; y: number; items: MenuItem[] }>()
  const closeCtx = useCallback(() => setCtx(undefined), [])
  const menuAt = (items: MenuItem[]) => (e: RMouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setCtx({ x: e.clientX, y: e.clientY, items })
  }
  // Renomear pelo menu: liga o campo do nome certo ("folder:<id>", "item:<id>", "routine:<id>").
  const [renaming, setRenaming] = useState<string>()
  const renameProps = (key: string) => ({ startEdit: renaming === key, onEditStarted: () => setRenaming(undefined) })
  const routines = useStore((s) => s.routines)
  const runs = useStore((s) => s.runs)
  const connections = useStore((s) => s.settings?.connections ?? [])
  const running = runs.filter(isActive)
  const problems = runs.filter((r) => Date.now() - Date.parse(r.ended_at ?? r.started_at ?? '0') < 86_400_000 && !['ok', 'running', 'queued', 'skipped'].includes(r.status))
  const openTabs = useOpenTabs()
  type IconComp = (p: { size?: number }) => React.ReactElement
  const KIND_ICON_SIDEBAR: Record<string, IconComp> = {
    terminal: IconTerminal as IconComp, routine: IconRoutine as IconComp, run: IconClock as IconComp,
    session: IconChat as IconComp, history: IconHistory as IconComp, adhoc: IconSpark as IconComp,
    fanout: IconSpark as IconComp, settings: IconSettings as IconComp,
  }

  return (
    <aside className="sidebar">
      <div className="brand drag">
        <img src="./icon.png" alt="" width={18} height={18} />
        <span>Turno</span>
      </div>

      <nav className="nav">
        <button onClick={() => openTerminal()}>
          <IconTerminal /> New terminal
        </button>
        <button onClick={() => openTerminal(undefined, { profile: 'claude-max', initialCommand: 'claude --chrome' })}>
          <IconChat /> Claude
        </button>
        <button onClick={() => openAdhoc()}>
          <IconSpark /> Ad hoc run
        </button>
        <button onClick={() => openFanout()}>
          <IconSpark /> Fan-out
        </button>
        <button onClick={() => openHistory()}>
          <IconHistory /> Runs
          {running.length > 0 && <span className="count run">{running.length}</span>}
          {problems.length > 0 && <span className="count err" title="failures in the last 24h">{problems.length}</span>}
        </button>
        <button onClick={() => openSettingsModal()}>
          <IconSettings /> Settings
        </button>
      </nav>

      <div className="side-scroll">
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
          const tone = r.error ? 'err' : active ? 'run' : !r.config.enabled ? 'idle' : statusTone(last?.status)
          const sub = r.error
            ? 'error in ROUTINE.md'
            : active
              ? 'running now'
              : !r.config.enabled
                ? `off · ${scheduleSummary(r.config)}`
                : r.nextRuns[0]
                  ? `next ${when(r.nextRuns[0])}`
                  : scheduleSummary(r.config)
          const modelLabel = shortModel(r.config.model) || r.config.model
          const runNow = async (): Promise<void> => {
            const id = await window.turno.run.startRoutine(r.id).catch(() => '')
            if (id) openRoutine(r.id, r.config.name)
          }
          const routineMenu: MenuItem[] = [
            { label: 'Open', onClick: () => openRoutine(r.id, r.config.name) },
            { label: 'Configure', onClick: () => openRoutineEditorModal(r.id) },
            active
              ? { label: 'Stop', onClick: () => void window.turno.run.stop(last!.id) }
              : { label: 'Run now', onClick: () => void runNow() },
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
              },
            },
          ]
          return (
            <li key={r.id} className={`routine ${r.config.enabled ? '' : 'off'}`} onContextMenu={menuAt(routineMenu)}>
              <button className="routine-main" onClick={() => openRoutine(r.id, r.config.name)} title={r.config.description || r.config.name}>
                <span className={`dot dot-${tone}`} />
                <span className="routine-text">
                  <InlineName
                    className="routine-name"
                    value={r.config.name}
                    onRename={(v) => void window.turno.routines.save({ id: r.id, originalId: r.id, config: { ...r.config, name: v }, prompt: r.prompt })}
                    {...renameProps(`routine:${r.id}`)}
                  />
                  <span className="routine-sub">
                    <span className="sb-dim">{llmLabel(connections, r.config.profile, r.config.model)}{modelLabel ? ` · ${modelLabel}` : ''} · {r.config.effort}</span>
                    {sub && <span> · {sub}</span>}
                    {last && !active && last.status !== 'ok' && <span className={`tone-${statusTone(last.status)}`}> · {STATUS_LABEL[last.status]}</span>}
                  </span>
                </span>
              </button>
              <span className="routine-actions">
                <button className="icon-btn" title="Configure" aria-label="Configure" onClick={() => openRoutineEditorModal(r.id)}>
                  <IconSettings size={14} />
                </button>
                {active ? (
                  <button className="icon-btn" title="Stop" aria-label="Stop" onClick={() => void window.turno.run.stop(last!.id)}>
                    <IconStop size={14} />
                  </button>
                ) : (
                  <button
                    className="icon-btn"
                    title="Run now"
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

      {openTabs.length > 0 && (
        <Section id="open-tabs" title="Open tabs" count={openTabs.length}>
          <ul className="routines">
            {openTabs.map((tab) => {
              const Icon = KIND_ICON_SIDEBAR[tab.kind] ?? (IconTerminal as IconComp)
              return (
                <li key={tab.id} className="routine">
                  <button className="routine-main" onClick={() => focusTab(tab.id)} title={tab.title}>
                    <span className="item-icon"><Icon size={14} /></span>
                    <span className="routine-text">
                      <span className="routine-name">{tab.title || tab.kind}</span>
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

      {folders.map((f, i) => {
        const delFolder = (): void => {
          void askConfirm({
            title: 'Delete folder',
            message: f.items.length
              ? `Delete the folder "${f.name}" and its ${f.items.length} item(s)? The sessions themselves are not deleted.`
              : `Delete the folder "${f.name}"?`,
          }).then((ok) => ok && deleteFolder(f.id))
        }
        const folderMenu: MenuItem[] = [
          { label: 'New chat or link', onClick: () => setDialog({ t: 'item', folderId: f.id }) },
          { label: 'Rename', onClick: () => setRenaming(`folder:${f.id}`) },
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
          onRename={(v) => renameFolder(f.id, v)}
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
                void askConfirm({ title: 'Remove item', message: `Remove "${it.name}" from the folder? The session is not deleted.`, confirmLabel: 'Remove' }).then(
                  (ok) => ok && deleteItem(it.id),
                )
              const itemMenu: MenuItem[] = [
                { label: it.kind === 'link' ? 'Open link' : state ? 'Show' : 'Open', onClick: () => void openItem(it) },
                { label: 'Rename', onClick: () => setRenaming(`item:${it.id}`) },
                { label: 'Edit…', onClick: () => setDialog({ t: 'item', folderId: f.id, item: it }) },
                ...(state ? [{ label: 'Close terminal', onClick: () => closeItemTerminal(it.id) }] : []),
                { label: 'Remove from folder', danger: true, onClick: removeItem },
              ]
              return (
              <li key={it.id} className="routine" onContextMenu={menuAt(itemMenu)}>
                <button className="routine-main" onClick={() => void openItem(it)} title={it.kind === 'link' ? it.url : `${agentOf(it.agent).name}${it.cwd ? ` · ${it.cwd}` : ''}`}>
                  <span className="item-icon">
                    {it.kind === 'link' ? <IconLink size={14} /> : it.kind === 'terminal' && !it.sessionId ? <IconTerminal size={14} /> : <IconChat size={14} />}
                    {state && <span className={`live-dot ${state}`} title={state === 'open' ? 'Open in a tab' : 'Running in the background (hidden)'} />}
                  </span>
                  <span className="routine-text">
                    <InlineName className="routine-name" value={it.name} onRename={(v) => patchItem(it.id, { name: v })} {...renameProps(`item:${it.id}`)} />
                    <span className="routine-sub">
                      {it.kind === 'link'
                        ? (it.url ?? '').replace(/^https?:[/][/]/, '').slice(0, 40)
                        : it.kind === 'terminal'
                          ? `${it.sessionId ? 'session' : 'terminal'}${it.cwd ? ` · ${lastPart(it.cwd)}` : ''}`
                          : `${AGENT_SHORT[it.agent as AgentId] ?? agentOf(it.agent).name}${it.cwd ? ` · ${lastPart(it.cwd)}` : ''}`}
                    </span>
                  </span>
                </button>
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

      <button className="new-folder" onClick={() => setDialog({ t: 'folder' })}>
        <IconFolder size={14} /> New folder
      </button>
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={closeCtx} />}
      {dialog?.t === 'folder' && (
        <FolderDialog
          initial={dialog.folder?.name}
          onClose={() => setDialog(undefined)}
          onSave={(name) => (dialog.folder ? renameFolder(dialog.folder.id, name) : addFolder(name))}
        />
      )}
      {dialog?.t === 'item' && <ItemDialog folderId={dialog.folderId} item={dialog.item} onClose={() => setDialog(undefined)} />}

    </aside>
  )
}
