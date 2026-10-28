import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { TasksPanel } from './panels/TasksPanel'
import { NewItems } from './NewItems'
import { ErrorBoundary, guarded } from './ErrorBoundary'
import { CommandPaletteHost, openPalette } from './CommandPalette'
import { SHORTCUTS } from './shortcuts'
import { AgentChatPanel } from './panels/AgentChatPanel'
import { useAgentSessions, STATUS_TEXT } from './agentStore'
import { toast } from './Toast'
import { isModalOpen, menuKeyNav } from './modalStack'
import {
  DockviewReact,
  DockviewReadyEvent,
  IDockviewHeaderActionsProps,
  IDockviewPanelHeaderProps,
  IWatermarkPanelProps,
  themeAbyss,
} from 'dockview-react'
import { TerminalPanel } from './panels/TerminalPanel'
import { RoutineEditor } from './panels/RoutineEditor'
import { RunViewer, RoutineSession } from './panels/RunViewer'
import { HistoryPanel } from './panels/HistoryPanel'
import { AdhocPanel } from './panels/AdhocPanel'
import { FanoutPanel } from './panels/FanoutPanel'
import { SettingsPanel } from './panels/SettingsPanel'
import { WebPanel } from './panels/WebPanel'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { ConfirmHost } from './ConfirmDialog'
import { AgentFolderHost, newAgentAsk } from './AgentFolderDialog'
import { SettingsModalHost, openSettingsModal } from './SettingsModal'
import { OnboardingHost, maybeShowIntro, openOnboarding, openWhatsNew } from './Onboarding'
import { RoutineEditorModalHost } from './RoutineEditorModal'
import { PanelModalHost } from './PanelModal'
import { ToastHost } from './Toast'
import { dockApi, syncRoutineTitles, openAdhoc, openFanout, openHistory, openRoutine, openRun, openTerminal, paramsOf, restoreLayout, saveLayout, setDockApi, openTasks } from './layout'
import { getStore, initStore, useStore } from './store'
import { plural } from './fmt'
import { addTerminalItem, openItem, patchItem, setDragging } from './sidebarStore'
import type { TerminalParams } from './layout'
import { updateSettings, setSettingsNotice } from './appearance'
import {
  IconClock,
  IconChat,
  IconClose,
  IconHistory,
  IconMaximize,
  IconMinimize,
  IconPlus,
  IconRoutine,
  IconSettings,
  IconSidebar,
  IconSpark,
  IconSplitDown,
  IconSplitRight,
  IconTerminal,
  IconCheck,
} from './icons'

// cada aba com o proprio limite de erro: um erro numa aba nao derruba as outras nem os terminais
const components = {
  terminal: guarded(TerminalPanel, 'terminal'),
  routine: guarded(RoutineEditor, 'routine'),
  run: guarded(RunViewer, 'run'),
  session: guarded(RoutineSession, 'session'),
  history: guarded(HistoryPanel, 'runs'),
  adhoc: guarded(AdhocPanel, 'ad hoc'),
  fanout: guarded(FanoutPanel, 'fan-out'),
  chat: guarded(AgentChatPanel, 'chat'),
  tasks: guarded(TasksPanel, 'tasks'),
  web: guarded(WebPanel, 'web'), // pagina embutida (dashboard de gateway) numa aba
  settings: guarded(SettingsPanel, 'settings'), // Settings abre em modal; registrado so p/ restaurar layouts salvos antigos com aba 'settings'
}

const KIND_ICON: Record<string, (p: { size?: number }) => ReactElement> = {
  terminal: IconTerminal,
  routine: IconRoutine,
  run: IconClock,
  session: IconChat,
  history: IconHistory,
  adhoc: IconSpark,
  fanout: IconSpark,
  chat: IconChat,
  tasks: IconCheck,
  settings: IconSettings,
}

function Tab({ api, params }: IDockviewPanelHeaderProps<{ kind?: string; itemId?: string; profile?: string; initialCommand?: string; lastSession?: unknown; agent?: { key: string } }>) {
  const agentKey = (paramsOf({ params, api }) as { agent?: { key: string } }).agent?.key
  const agentSess = useAgentSessions().find((s) => s.key === agentKey)
  const [title, setTitle] = useState(api.title ?? '')
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(api.title ?? '')
  useEffect(() => api.onDidTitleChange((e) => setTitle(e.title)).dispose, [api])
  const tabRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // a aba focada e o .dv-tab do dockview (pai deste componente): F2 renomeia como na sidebar
    const host = tabRef.current?.closest<HTMLElement>('.dv-tab')
    const k = (e: KeyboardEvent): void => {
      if (e.key !== 'F2') return
      e.preventDefault()
      setDraft(api.title ?? '')
      setRenaming(true)
    }
    host?.addEventListener('keydown', k)
    return () => host?.removeEventListener('keydown', k)
  }, [api])
  useEffect(() => {
    // O botao de overflow do dockview aparece depois e encolhe o container: mede de novo quando ele muda.
    const show = (): void => {
      const el = tabRef.current
      const box = el?.closest<HTMLElement>('.dv-tabs-container')
      if (!el || !box || !api.isActive) return
      const r = el.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      if (r.right > b.right - 2) box.scrollLeft += r.right - b.right + 6
      else if (r.left < b.left) box.scrollLeft -= b.left - r.left + 6
    }
    const box = tabRef.current?.closest<HTMLElement>('.dv-tabs-container')
    const ro = new ResizeObserver(() => requestAnimationFrame(show))
    if (box) ro.observe(box)
    const t = setTimeout(show, 150)
    const sub = api.onDidActiveChange((e) => e.isActive && (requestAnimationFrame(show), setTimeout(show, 150)))
    return () => {
      ro.disconnect()
      clearTimeout(t)
      sub.dispose()
    }
  }, [api])
  const isAgent = params.kind === 'terminal' && (!!agentKey || params.profile === 'claude-max' || /^claude\b/.test(params.initialCommand ?? '') || !!params.lastSession)
  const Icon = isAgent ? IconChat : KIND_ICON[params.kind ?? 'terminal'] ?? IconTerminal

  const commitRename = (d: string): void => {
    const v = d.trim()
    if (v && v !== title) {
      api.setTitle(v)
      api.updateParameters({ ...paramsOf({ params, api }), customTitle: true }) // nome dado a mao: syncRoutineTitles respeita
      saveLayout()
      const itemId = (api.getParameters?.() as { itemId?: string } | undefined)?.itemId ?? params.itemId
      if (itemId) patchItem(itemId, { name: v })
    }
    setRenaming(false)
    refocusPanel()
  }
  // depois de renomear (Enter/Esc), o teclado volta para o painel da aba (o terminal)
  const refocusPanel = (): void => {
    // devolve o foco ao terminal so depois que a tecla (Enter/Esc) for solta: senao o caractere da propria
    // tecla chega ao terminal e executa a linha que estava digitada nele
    const go = (): void => {
      window.dispatchEvent(new CustomEvent('turno:focus-panel', { detail: api.id }))
      // so terminais ouvem o evento: nos outros paineis o foco volta para a propria aba
      requestAnimationFrame(() => (document.activeElement === document.body || !document.activeElement) && tabRef.current?.closest<HTMLElement>('.dv-tab')?.focus())
    }
    const up = (): void => (window.removeEventListener('keyup', up, true), void setTimeout(go, 0))
    window.addEventListener('keyup', up, true)
    setTimeout(() => (window.removeEventListener('keyup', up, true), go()), 400) // garantia se o keyup nao vier
  }

  return (
    <div ref={tabRef} className="tab" onAuxClick={(e) => e.button === 1 && api.close()} title={renaming ? undefined : title}>
      <Icon size={13} />
      {agentSess && agentSess.status !== 'starting' && <span className={`tab-status st-${agentSess.status}`} title={`${STATUS_TEXT[agentSess.status]}${agentSess.message ? `: ${agentSess.message}` : ''}`} aria-label={STATUS_TEXT[agentSess.status]} />}
      {renaming ? (
        <input
          className="inline-rename tab-rename"
          aria-label="Rename tab"
          autoFocus
          value={draft}
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitRename(draft)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commitRename(draft)
            else if (e.key === 'Escape') (setRenaming(false), refocusPanel())
          }}
        />
      ) : (
        <span
          className="tab-title"
          title={`${title}\nDouble-click to rename`}
          onDoubleClick={(e) => { e.stopPropagation(); setDraft(title); setRenaming(true) }}
        >
          {title}
        </span>
      )}
      <button
        className="tab-close"
        aria-label="Close"
        title={params.itemId ? 'Hide (keeps running; reopen from its folder)' : 'Close'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          api.close()
        }}
      >
        <IconClose size={12} />
      </button>
    </div>
  )
}

// Botoes no cabecalho de cada grupo: dividir a direita, abaixo e maximizar.
function GroupActions({ group, containerApi }: IDockviewHeaderActionsProps) {
  const [max, setMax] = useState(containerApi.hasMaximizedGroup())
  const [menu, setMenu] = useState(false)
  const plusRef = useRef<HTMLButtonElement>(null)
  useEffect(() => containerApi.onDidMaximizedGroupChange(() => setMax(containerApi.hasMaximizedGroup())).dispose, [containerApi])
  const ref = group.activePanel?.id


  // menu no body (fora do painel, que corta o que passa da borda): alinhado a direita do "+", sem sair da janela
  const dropPos = (): React.CSSProperties => {
    const r = plusRef.current?.getBoundingClientRect()
    if (!r) return {}
    return r.right < 200 ? { position: 'fixed', top: r.bottom + 4, left: 8, right: 'auto' } : { position: 'fixed', top: r.bottom + 4, right: window.innerWidth - r.right, left: 'auto' }
  }
  return (
    <div className="group-actions">
      <div className="new-term-wrap">
        <button ref={plusRef} title="New: terminal, agent, chat…" aria-label="New" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          <IconPlus size={14} />
        </button>
        {menu &&
          createPortal(
          <>
            <div className="new-term-overlay" onClick={() => setMenu(false)} />
            <div
              className="new-term-dropdown"
              role="menu"
              style={dropPos()}
              ref={(el) => void (el && !el.contains(document.activeElement) && el.querySelector<HTMLButtonElement>('button')?.focus())}
              onKeyDown={(e) => {
                if (e.key === 'Escape') return void (e.stopPropagation(), setMenu(false), plusRef.current?.focus())
                if (e.key === 'Tab') return void setMenu(false)
                menuKeyNav(e, e.currentTarget)
              }}
            >
              <NewItems onPick={(run) => (setMenu(false), run())} refId={ref} />
            </div>
          </>,
          document.body,
        )}
      </div>
      <button title="Split right (Alt+Shift+=)" onClick={() => openTerminal('right', {}, undefined, ref)}>
        <IconSplitRight size={14} />
      </button>
      <button title="Split down (Alt+Shift+-)" onClick={() => openTerminal('below', {}, undefined, ref)}>
        <IconSplitDown size={14} />
      </button>
      <button
        title={max ? 'Restore (Ctrl+Shift+M)' : 'Maximize (Ctrl+Shift+M)'}
        onClick={() => (max ? containerApi.exitMaximizedGroup() : group.activePanel && containerApi.maximizeGroup(group.activePanel))}
      >
        {max ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
      </button>
    </div>
  )
}

function Welcome(_: IWatermarkPanelProps) {
  const routines = useStore((s) => s.routines)
  return (
    <div className="welcome">
      <img src="./icon.png" alt="" width={56} height={56} />
      <h1>Turno</h1>
      <p className="muted">Agents, terminals and routines on your PC, with Claude, local models or any provider.</p>
      <div className="welcome-actions">
        <button className="btn primary" onClick={() => newAgentAsk()}>
          <IconChat /> New agent
        </button>
        <button className="btn" onClick={() => openTerminal()}>
          <IconTerminal /> Terminal
        </button>
        <button className="btn" onClick={() => openRoutine(null, 'New routine')}>
          <IconRoutine /> Routine
        </button>
        <button className="btn" onClick={() => openHistory()}>
          <IconHistory /> Runs
        </button>
      </div>
      {/* mesma lista de Settings › Shortcuts e da paleta */}
      <dl className="shortcuts">
        {SHORTCUTS.filter((x) => ['Ctrl+Shift+P', 'Ctrl+Shift+N', 'Ctrl+Shift+T', 'Ctrl+Shift+R', 'Ctrl+Shift+J', 'F2', 'Alt+Shift+= / Alt+Shift+-', 'Ctrl+Shift+M', 'Ctrl+Shift+W', 'Ctrl+,', 'Shift+Enter'].includes(x.keys)).map((x) => (
          <div key={x.keys} className="shortcut-pair">
            <dt>{x.keys}</dt>
            <dd>{x.label}</dd>
          </div>
        ))}
        <div className="shortcut-pair">
          <dt>Drag a tab</dt>
          <dd>Drop it on another pane to split</dd>
        </div>
      </dl>
      {routines.length > 0 && <p className="muted small">{plural(routines.length, 'routine')} loaded in the sidebar.</p>}
    </div>
  )
}

// Abas que nao sao terminal (rotina, chat, Tasks...): "ir para a aba" leva o teclado ao primeiro controle dela
function useFocusNonTerminalPanels(): void {
  useEffect(() => {
    const f = (e: Event): void => {
      const id = (e as CustomEvent<string>).detail
      const p = dockApi()?.getPanel(id)
      if (!p || (paramsOf(p) as { kind?: string }).kind === 'terminal') return
      requestAnimationFrame(() => {
        const root = document.querySelector('.dv-groupview.dv-active-group .dv-content-container')
        const el = root?.querySelector<HTMLElement>('[autofocus], textarea, input:not([type="hidden"]), [tabindex="-1"], button')
        el?.focus({ preventScroll: true })
      })
    }
    window.addEventListener('turno:focus-panel', f)
    return () => window.removeEventListener('turno:focus-panel', f)
  }, [])
}

export function App() {
  useFocusNonTerminalPanels()
  // Pedido de foco no painel ativo (ex. o modal fechou e quem abriu nao existe mais)
  useEffect(() => {
    const f = (): void => {
      const a = dockApi()?.activePanel
      if (a) window.dispatchEvent(new CustomEvent('turno:focus-panel', { detail: a.id }))
    }
    window.addEventListener('turno:focus-active-panel', f)
    return () => window.removeEventListener('turno:focus-active-panel', f)
  }, [])
  // A lista de abas escondidas do dockview so fecha com clique fora: o Esc faz o mesmo.
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || isModalOpen()) return
      const list = document.querySelector('.dv-tabs-overflow-container')
      if (!list || !(list as HTMLElement).offsetParent) return
      e.preventDefault()
      e.stopImmediatePropagation()
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) document.body.dispatchEvent(new MouseEvent(t, { bubbles: true }))
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [])
  // Rotina renomeada: a aba da sessao acompanha o nome novo.
  const routineList = useStore((s) => s.routines)
  useEffect(() => syncRoutineTitles(new Map(routineList.map((r) => [r.id, r.config.name]))), [routineList])
  const onReady = useCallback((e: DockviewReadyEvent) => {
    setDockApi(e.api)
    // Guarda qual aba esta sendo arrastada: a sidebar aceita terminais soltos numa pasta.
    e.api.onDidRemovePanel(() => {
      // o painel que fica ativo so aceita foco depois que o dockview termina de reorganizar: tenta algumas vezes
      const tryFocus = (left: number): void => {
        const a = e.api.activePanel
        if (!a && !isModalOpen() && (!document.activeElement || document.activeElement === document.body))
          return void document.querySelector<HTMLElement>('.welcome button')?.focus() // ultima aba fechada: tela de boas-vindas
        if (!a || isModalOpen() || (document.activeElement && document.activeElement !== document.body)) return
        window.dispatchEvent(new CustomEvent('turno:focus-panel', { detail: a.id }))
        if (left > 0) setTimeout(() => tryFocus(left - 1), 80)
        // so terminais ouvem o evento: nos outros paineis, a aba ativa recebe o foco
        else document.querySelector<HTMLElement>('.dv-groupview.dv-active-group .dv-tab.dv-active-tab')?.focus()
      }
      setTimeout(() => tryFocus(4), 30)
    })
    e.api.onWillDragPanel((ev) => {
      const params = paramsOf(ev.panel)
      setDragging(params.kind === 'terminal' ? { id: ev.panel.id, params, title: ev.panel.title ?? 'terminal' } : undefined)
    })
    // arrastar um divisor (sash) tira o foco do terminal/campo: devolve ao soltar
    let beforeSash: Element | null = null
    document.addEventListener('pointerdown', (ev) => void ((ev.target as HTMLElement).closest?.('.dv-sash') && (beforeSash = document.activeElement)), true)
    document.addEventListener('pointerup', () => {
      const b = beforeSash as HTMLElement | null
      beforeSash = null
      if (b && b !== document.body && b.isConnected && (!document.activeElement || document.activeElement === document.body)) requestAnimationFrame(() => b.focus({ preventScroll: true }))
    }, true)
    // painel movido de grupo: o DOM e reinserido e o navegador zera a rolagem; as conversas restauram a sua
    e.api.onDidMovePanel(() => requestAnimationFrame(() => window.dispatchEvent(new Event('turno:panels-moved'))))
    let t: ReturnType<typeof setTimeout> | undefined
    e.api.onDidLayoutChange(() => {
      clearTimeout(t)
      t = setTimeout(saveLayout, 500)
    })
    if (window.turno.smoke.enabled) return void runSmoke()
    if (!restoreLayout()) {
      openTerminal()
      openHistory()
    }
  }, [])

  useEffect(() => {
    void initStore()
    // instalacao nova: introducao; atualizacao: novidades (smoke abre so pelas views proprias)
    if (!window.turno.smoke.enabled) void window.turno.settings.get().then(maybeShowIntro)
    void window.turno.ui.notices().then((ms) =>
      ms.forEach((n) => {
        const id = toast(n.message, 'warn', { sticky: true })
        if (n.file === 'settings.json') setSettingsNotice(id)
      }),
    )
    const off = window.turno.ui.onOpenRun((id) => {
      // mesmo titulo da lista de Runs: nome da rotina (ou ad hoc)
      const { runs, routines } = getStore()
      const r = runs.find((x) => x.id === id)
      openRun(id, !r ? 'Run' : r.routine ? (routines.find((x) => x.id === r.routine)?.config.name ?? r.routine) : 'ad hoc')
    })
    const onKey = (ev: KeyboardEvent): void => {
      const api = dockApi()
      if (!api) return
      const k = ev.key.toLowerCase()
      const hit = (fn: () => void): void => {
        ev.preventDefault()
        ev.stopPropagation()
        fn()
      }
      if (isModalOpen() && (!(ev.ctrlKey && !ev.shiftKey && k === ',') || document.querySelector('.confirm-modal'))) return // modal aberto: o workspace atras nao recebe atalhos
      // paleta: Ctrl+Shift+P em qualquer lugar; Ctrl+K so fora do terminal (no shell e apagar ate o fim da linha)
      if (ev.ctrlKey && ev.shiftKey && k === 'p') return hit(() => openPalette())
      if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && k === 'k' && !(ev.target as HTMLElement | null)?.closest?.('.xterm')) return hit(() => openPalette())
      if (ev.ctrlKey && ev.shiftKey && k === 'n') return hit(() => newAgentAsk())
      if (ev.ctrlKey && ev.shiftKey && k === 'r') return hit(() => openAdhoc())
      if (ev.ctrlKey && ev.shiftKey && k === 'j') return hit(() => openTasks())
      if (ev.altKey && ev.shiftKey && (k === '+' || k === '=')) hit(() => openTerminal('right'))
      else if (ev.altKey && ev.shiftKey && (k === '_' || k === '-')) hit(() => openTerminal('below'))
      else if (ev.ctrlKey && ev.shiftKey && k === 't') hit(() => openTerminal())
      else if (ev.ctrlKey && !ev.shiftKey && k === ',') hit(() => openSettingsModal())
      else if (ev.ctrlKey && ev.shiftKey && k === 'h') hit(() => openHistory())
      else if (ev.ctrlKey && ev.shiftKey && k === 'w') hit(() => api.activePanel?.api.close())
      else if (ev.ctrlKey && ev.shiftKey && k === 'm')
        hit(() => {
          const p = api.activePanel
          if (p) api.hasMaximizedGroup() ? api.exitMaximizedGroup() : api.maximizeGroup(p)
        })
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      off()
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  const side = useSidebarLayout()
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      // no terminal o Ctrl+B e do shell (readline/tmux) enquanto a sidebar esta visivel; escondida, ele a traz de volta
      if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'b' && !isModalOpen() && (side.hidden || !(ev.target as HTMLElement | null)?.closest?.('.xterm'))) {
        ev.preventDefault()
        ev.stopPropagation()
        side.toggle()
        // o botao que tinha o foco pode sumir com a sidebar: o teclado vai para o painel ativo
        requestAnimationFrame(() => {
          const a = dockApi()?.activePanel
          if (a && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected))
            window.dispatchEvent(new CustomEvent('turno:focus-panel', { detail: a.id }))
        })
      }
    }
    window.addEventListener('keydown', onKey, true)
    // paleta e menu de ajuda tambem mostram/escondem a sidebar
    const onToggle = (): void => {
      side.toggle()
      // como no Ctrl+B: o foco que estava na sidebar escondida vai para o painel ativo
      requestAnimationFrame(() => {
        const a = dockApi()?.activePanel
        if (a && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected))
          window.dispatchEvent(new CustomEvent('turno:focus-panel', { detail: a.id }))
      })
    }
    window.addEventListener('turno:toggle-sidebar', onToggle)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('turno:toggle-sidebar', onToggle)
    }
  }, [side.toggle, side.hidden])

  // Janela estreita: a sidebar cede espaco ao dock (clamp), sem passar da largura escolhida.
  return (
    <div className="app" style={{ gridTemplateColumns: side.hidden ? '0 1fr' : `clamp(200px, 26vw, ${side.width}px) 1fr` }}>
      {side.hidden ? <div /> : <Sidebar />}
      {!side.hidden && (
        <div
          className="sidebar-resizer"
          style={{ left: `calc(clamp(200px, 26vw, ${side.width}px) - 3px)` }} // mesma largura efetiva da coluna (clamp)
          title="Drag to resize · double-click to reset"
          onPointerDown={side.startResize}
          onDoubleClick={side.reset}
        />
      )}
      <main className="main">
        <div className="titlebar drag">
          <button className="sidebar-toggle" title={side.hidden ? 'Show sidebar (Ctrl+B)' : 'Hide sidebar (Ctrl+B)'} aria-label="Toggle sidebar" onClick={side.toggle}>
            <IconSidebar size={15} />
          </button>
        </div>
        <DockviewReact
          className="dock"
          components={components}
          tabComponents={{ tab: Tab }}
          defaultTabComponent={Tab}
          rightHeaderActionsComponent={GroupActions}
          watermarkComponent={Welcome}
          onReady={onReady}
          theme={themeAbyss}
        />
      </main>
      <StatusBar />
      {/* cada janela com o proprio limite de erro: a janela fecha com um aviso, o app e os terminais seguem */}
      <ErrorBoundary scope="dialog" label="The confirmation"><ConfirmHost /></ErrorBoundary>
      <ErrorBoundary scope="dialog" label="The folder picker"><AgentFolderHost /></ErrorBoundary>
      <ErrorBoundary scope="dialog" label="Settings"><SettingsModalHost /></ErrorBoundary>
      <ErrorBoundary scope="dialog" label="The command palette"><CommandPaletteHost /></ErrorBoundary>
      <ErrorBoundary scope="dialog" label="The setup tour"><OnboardingHost /></ErrorBoundary>
      <ErrorBoundary scope="dialog" label="The routine editor"><RoutineEditorModalHost /></ErrorBoundary>
      <ErrorBoundary scope="dialog" label="This window"><PanelModalHost /></ErrorBoundary>
      <ToastHost />
    </div>
  )
}

// Largura e visibilidade da barra lateral, lembradas entre sessoes (so conveniencia: falha em silencio).
const SIDE_KEY = 'turno.sidebar.v1'
const SIDE_DEFAULT = 272
const clampW = (w: number): number => Math.min(560, Math.max(190, Math.round(w)))

function useSidebarLayout() {
  const [st, setSt] = useState<{ width: number; hidden: boolean }>(() => {
    try {
      const j = JSON.parse(localStorage.getItem(SIDE_KEY) ?? '{}')
      return { width: clampW(Number(j.width) || SIDE_DEFAULT), hidden: !!j.hidden }
    } catch {
      return { width: SIDE_DEFAULT, hidden: false }
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(SIDE_KEY, JSON.stringify(st))
    } catch {
      /* storage indisponivel */
    }
  }, [st])
  const toggle = useCallback(() => setSt((s) => ({ ...s, hidden: !s.hidden })), [])
  const reset = useCallback(() => setSt((s) => ({ ...s, width: SIDE_DEFAULT })), [])
  const startResize = useCallback((e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    document.body.classList.add('resizing-x')
    const move = (ev: PointerEvent): void => setSt((s) => ({ ...s, width: clampW(ev.clientX) }))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      document.body.classList.remove('resizing-x')
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }, [])
  return { ...st, toggle, reset, startResize }
}

// Smoke: monta um layout de exemplo (splits + rotina + historico) e pede o screenshot.
async function runSmoke(): Promise<void> {
  openTerminal(undefined)
  openTerminal('right')
  openTerminal('below')
  await initStore()
  await new Promise((r) => setTimeout(r, 800))
  const routines = await window.turno.routines.list()
  const api = dockApi()!
  const first = api.panels[0]
  first.api.setActive()
  if (routines[0]) openRoutine(routines[0].id, routines[0].config.name)
  else if (!window.turno.smoke.view) openAdhoc() // views especificas abrem so o proprio modal
  api.getPanel(first.id)?.api.setActive()
  if (!window.turno.smoke.view) openHistory()
  if (window.turno.smoke.theme) {
    await updateSettings({ theme: window.turno.smoke.theme })
    openSettingsModal()
  }
  if (window.turno.smoke.view === 'fanout') openFanout()
  if (window.turno.smoke.view === 'adhoc') openAdhoc()
  if (window.turno.smoke.view === 'drag-tab') {
    // Arrasta o 1o terminal de "Open tabs" para a 1a pasta (HTML5 drag sintetico).
    await new Promise((r) => setTimeout(r, 800))
    const li = document.querySelector<HTMLElement>('li[draggable="true"]')
    const folder = document.querySelector<HTMLElement>('[data-folder-id]')
    if (li && folder) {
      const dt = new DataTransfer()
      li.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      folder.scrollIntoView({ block: 'center' })
      const r = folder.getBoundingClientRect()
      const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.top + 10 }
      folder.dispatchEvent(new DragEvent('dragover', at))
      folder.dispatchEvent(new DragEvent('drop', at))
      console.log('[smoke] dragged', li.textContent, '->', folder.dataset.folderId)
    } else console.log('[smoke] drag-tab: nothing to drag', !!li, !!folder)
  }
  if (window.turno.smoke.view === 'onboarding') openOnboarding()
  if (window.turno.smoke.view === 'agent-folder') newAgentAsk() // popup "Open agent in" do New agent
  if (window.turno.smoke.view === 'settings-agents-add') {
    // fim da lista de contas: o "Add an account…" e o texto de ajuda (o modal tem altura limitada)
    openSettingsModal('agents')
    await new Promise((r) => setTimeout(r, 800))
    document.getElementById('acct-add')?.scrollIntoView({ block: 'center' })
  }
  if (window.turno.smoke.view === 'whatsnew') void openWhatsNew(true)
  if (window.turno.smoke.view === 'run') {
    const [last] = await window.turno.run.list(undefined, 1)
    if (last) openRun(last.id, 'Run')
  }
  if (window.turno.smoke.view?.startsWith('settings'))
    openSettingsModal(window.turno.smoke.view === 'settings-picker' ? 'appearance' : window.turno.smoke.view === 'settings-fontpicker' ? 'terminal' : window.turno.smoke.view.slice('settings-'.length))
  if (window.turno.smoke.view === 'settings-fontpicker') {
    // Busca de fonte: foca o campo e digita "mono"; a lista deve mostrar so as fontes que batem (sugeridas + instaladas).
    await new Promise((r) => setTimeout(r, 800))
    const el = document.querySelector<HTMLInputElement>('.font-trigger')
    el?.focus()
    await new Promise((r) => setTimeout(r, 200))
    if (el) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, 'mono')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    // passa o mouse pelas opcoes (o hover muda o destaque): o Settings nao pode cair
    await new Promise((r) => setTimeout(r, 300))
    for (const li of Array.from(document.querySelectorAll('.font-picker [role="option"]')).slice(0, 4)) {
      li.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 120))
    }
  }
  if (window.turno.smoke.view === 'settings-picker') {
    // Abre o seletor de tema e passa o mouse no 4o tema: o app inteiro deve pre-visualizar.
    await new Promise((r) => setTimeout(r, 600))
    document.querySelector<HTMLButtonElement>('.theme-trigger')?.click()
    await new Promise((r) => setTimeout(r, 300))
    document.querySelectorAll('.theme-menu li')[3]?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  }
  if (window.turno.smoke.drag) {
    // Mesmo caminho do arrasto: terminal com claude interativo -> solta na 1a pasta.
    openTerminal('right', { initialCommand: 'claude --model haiku' }, 'claude here', undefined, 'smoke-claude')
    await new Promise((r) => setTimeout(r, 25000))
    const panel = api.getPanel('smoke-claude')!
    const sb = await window.turno.sidebar.get()
    const params = panel.params as TerminalParams
    console.log('[smoke] params', JSON.stringify({ lastCwd: params.lastCwd, lastSession: params.lastSession }))
    const itemId = addTerminalItem(sb.folders[0].id, params, panel.title ?? 'terminal')
    panel.api.updateParameters({ ...params, itemId })
    console.log('[smoke] item', itemId)
  }
  if (window.turno.smoke.openItem) {
    const sb = await window.turno.sidebar.get()
    const it = sb.folders.flatMap((f) => f.items).find((x) => x.id === window.turno.smoke.openItem)
    if (it) await openItem(it)
    await new Promise((r) => setTimeout(r, 12000))
  }
  if (window.turno.smoke.edit) openRoutine(window.turno.smoke.edit, window.turno.smoke.edit, true)
  const target = window.turno.smoke.runRoutine
  if (target) {
    // Roda uma rotina de verdade pelo agendador e espera terminar antes do screenshot.
    const waitDone = (id: string) =>
      new Promise<void>((res) => {
        const off = window.turno.run.onChanged((r) => {
          if (r.id === id && !['running', 'queued'].includes(r.status)) (off(), res())
        })
      })
    if (window.turno.smoke.approve)
      window.turno.run.onEvent((ev) => {
        if (ev.kind === 'permission' && ev.ref) setTimeout(() => void window.turno.run.permission(ev.runId, ev.ref!, 'allow'), 2000)
      })
    const runId = await window.turno.run.startRoutine(target)
    if (runId) {
      openRoutine(target, target)
      await waitDone(runId)
      const followup = window.turno.smoke.followup
      if (followup) {
        await new Promise((r) => setTimeout(r, 1500))
        const next = await window.turno.run.send(runId, followup)
        await waitDone(next.runId)
      }
    }
  }
  await new Promise((r) => setTimeout(r, 3500 + window.turno.smoke.waitSec * 1000))
  window.turno.smoke.done()
}
