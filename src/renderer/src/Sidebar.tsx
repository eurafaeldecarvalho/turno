import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore, isActive } from './store'
import { scheduleSummary, statusTone, when, STATUS_LABEL } from './fmt'
import { openAdhoc, openHistory, openRoutine, openSettings, openTerminal } from './layout'
import { IconChat, IconChevron, IconClose, IconFolder, IconHistory, IconLink, IconMore, IconPlay, IconPlus, IconSettings, IconSpark, IconStop, IconTerminal } from './icons'
import { addFolder, addTerminalItem, agentOf, deleteFolder, deleteItem, getDragging, moveFolder, openItem, renameFolder, setDragging, toggleSection, useSidebar } from './sidebarStore'
import { dockApi } from './layout'
import { FolderDialog, ItemDialog } from './ItemDialog'
import type { SidebarFolder, SidebarItem } from '../../shared/types'

// Secao recolhivel da barra lateral (Rotinas e cada pasta).
function Section({ id, title, count, actions, children, folder, dropping }: {
  id: string
  title: ReactNode
  count?: number
  actions?: ReactNode
  children: ReactNode
  folder?: boolean
  dropping?: boolean
}) {
  const { collapsed } = useSidebar()
  const closed = !!collapsed[id]
  return (
    <section className={`side-section ${closed ? 'closed' : ''} ${dropping ? 'drop-target' : ''}`} data-folder-id={folder ? id : undefined}>
      <div className="section-head">
        <button className="section-toggle" onClick={() => toggleSection(id)} aria-expanded={!closed}>
          <IconChevron size={12} className="chev" />
          <span className="section-title">{title}</span>
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
      <button className="icon-btn" aria-label="Mais opções" title="Mais opções" onClick={() => setOpen(!open)}>
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
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'link'
      }
    }
    const drop = (e: DragEvent | PointerEvent): void => {
      const d = getDragging()
      const f = d && folderAt(e.clientX, e.clientY)
      if (d && f) {
        e.preventDefault()
        e.stopPropagation()
        const itemId = addTerminalItem(f, d.params, d.title)
        const panel = dockApi()?.getPanel(d.id)
        panel?.api.updateParameters({ ...d.params, itemId })
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
  const routines = useStore((s) => s.routines)
  const runs = useStore((s) => s.runs)
  const running = runs.filter(isActive)
  const problems = runs.filter((r) => Date.now() - Date.parse(r.ended_at ?? r.started_at ?? '0') < 86_400_000 && !['ok', 'running', 'queued', 'skipped'].includes(r.status))

  return (
    <aside className="sidebar">
      <div className="brand drag">
        <img src="./icon.png" alt="" width={18} height={18} />
        <span>Turno</span>
      </div>

      <nav className="nav">
        <button onClick={() => openTerminal()}>
          <IconTerminal /> Novo terminal
        </button>
        <button onClick={() => openAdhoc()}>
          <IconSpark /> Execução avulsa
        </button>
        <button onClick={() => openHistory()}>
          <IconHistory /> Execuções
          {running.length > 0 && <span className="count run">{running.length}</span>}
          {problems.length > 0 && <span className="count err" title="falhas nas últimas 24h">{problems.length}</span>}
        </button>
        <button onClick={() => openSettings()}>
          <IconSettings /> Configurações
        </button>
      </nav>

      <div className="side-scroll">
      <Section
        id="routines"
        title="Rotinas"
        count={routines.length}
        actions={
          <button className="icon-btn" title="Nova rotina" aria-label="Nova rotina" onClick={() => openRoutine(null, 'Nova rotina')}>
            <IconPlus size={14} />
          </button>
        }
      >
      <ul className="routines">
        {routines.length === 0 && (
          <li className="empty muted small">
            Nenhuma rotina ainda. Clique em <b>+</b> para criar a primeira.
          </li>
        )}
        {routines.map((r) => {
          const last = r.lastRun
          const active = isActive(last)
          const tone = r.error ? 'err' : active ? 'run' : !r.config.enabled ? 'idle' : statusTone(last?.status)
          const sub = r.error
            ? 'erro no ROUTINE.md'
            : active
              ? 'rodando agora'
              : !r.config.enabled
                ? `desligada · ${scheduleSummary(r.config)}`
                : r.nextRuns[0]
                  ? `próxima ${when(r.nextRuns[0])}`
                  : scheduleSummary(r.config)
          return (
            <li key={r.id} className={`routine ${r.config.enabled ? '' : 'off'}`}>
              <button className="routine-main" onClick={() => openRoutine(r.id, r.config.name)} title={r.config.description || r.config.name}>
                <span className={`dot dot-${tone}`} />
                <span className="routine-text">
                  <span className="routine-name">{r.config.name}</span>
                  <span className="routine-sub">
                    {r.config.profile === 'qwen-local' && <span className="tag">qwen</span>}
                    {sub}
                    {last && !active && last.status !== 'ok' && <span className={`tone-${statusTone(last.status)}`}> · {STATUS_LABEL[last.status]}</span>}
                  </span>
                </span>
              </button>
              <span className="routine-actions">
                <button className="icon-btn" title="Configurar" aria-label="Configurar" onClick={() => openRoutine(r.id, r.config.name, true)}>
                  <IconSettings size={14} />
                </button>
                {active ? (
                  <button className="icon-btn" title="Parar" aria-label="Parar" onClick={() => void window.turno.run.stop(last!.id)}>
                    <IconStop size={14} />
                  </button>
                ) : (
                  <button
                    className="icon-btn"
                    title="Rodar agora"
                    aria-label="Rodar agora"
                    disabled={!!r.error}
                    onClick={async () => {
                      const id = await window.turno.run.startRoutine(r.id).catch(() => '')
                      if (id) openRoutine(r.id, r.config.name)
                    }}
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

      {folders.map((f, i) => (
        <Section
          key={f.id}
          id={f.id}
          folder
          dropping={dropFolder === f.id}
          title={f.name}
          count={f.items.length}
          actions={
            <>
              <button className="icon-btn" title="Novo chat ou link" aria-label="Novo item" onClick={() => setDialog({ t: 'item', folderId: f.id })}>
                <IconPlus size={14} />
              </button>
              <Menu
                items={[
                  { label: 'Renomear', onClick: () => setDialog({ t: 'folder', folder: f }) },
                  ...(i > 0 ? [{ label: 'Mover para cima', onClick: () => moveFolder(f.id, -1) }] : []),
                  ...(i < folders.length - 1 ? [{ label: 'Mover para baixo', onClick: () => moveFolder(f.id, 1) }] : []),
                  {
                    label: 'Excluir pasta',
                    danger: true,
                    onClick: () => {
                      if (!f.items.length || confirm(`Excluir a pasta "${f.name}" e seus ${f.items.length} item(ns)? As sessões em si não são apagadas.`)) deleteFolder(f.id)
                    },
                  },
                ]}
              />
            </>
          }
        >
          <ul className="routines">
            {!f.items.length && (
              <li className="empty muted small">
                Vazia. Use <b>+</b> ou arraste uma aba de terminal para cá.
              </li>
            )}
            {f.items.map((it) => (
              <li key={it.id} className="routine">
                <button className="routine-main" onClick={() => void openItem(it)} title={it.kind === 'link' ? it.url : `${agentOf(it.agent).name}${it.cwd ? ` · ${it.cwd}` : ''}`}>
                  <span className="item-icon">{it.kind === 'link' ? <IconLink size={14} /> : it.kind === 'terminal' && !it.sessionId ? <IconTerminal size={14} /> : <IconChat size={14} />}</span>
                  <span className="routine-text">
                    <span className="routine-name">{it.name}</span>
                    <span className="routine-sub">
                      {it.kind === 'link'
                        ? (it.url ?? '').replace(/^https?:[/][/]/, '').slice(0, 40)
                        : it.kind === 'terminal'
                          ? `${it.sessionId ? 'sessão do Claude' : 'terminal'}${it.cwd ? ` · ${lastPart(it.cwd)}` : ''}`
                          : `${agentOf(it.agent).name}${it.cwd ? ` · ${lastPart(it.cwd)}` : ''}`}
                    </span>
                  </span>
                </button>
                <span className="routine-actions">
                  <button className="icon-btn" title="Editar" aria-label="Editar" onClick={() => setDialog({ t: 'item', folderId: f.id, item: it })}>
                    <IconSettings size={14} />
                  </button>
                  <button className="icon-btn" title="Remover da pasta" aria-label="Remover" onClick={() => confirm(`Remover "${it.name}" da pasta? A sessão não é apagada.`) && deleteItem(it.id)}>
                    <IconClose size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      <button className="new-folder" onClick={() => setDialog({ t: 'folder' })}>
        <IconFolder size={14} /> Nova pasta
      </button>
      </div>

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
