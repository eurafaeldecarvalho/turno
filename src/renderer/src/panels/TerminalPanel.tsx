import { useEffect, useRef, useState } from 'react'
import { isModalOpen } from '../modalStack'
import type { IDockviewPanelProps } from 'dockview-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { LigaturesAddon } from '@xterm/addon-ligatures'
import { discarded, paramsOf, type TerminalParams } from '../layout'
import { onSettings, useSettings } from '../appearance'
import { terminalOptions } from '../terminalOptions'
import { itemExists, patchItem } from '../sidebarStore'
import { killParked, park, setLive, unpark } from '../liveTerms'
import type { TermSession } from '../../../shared/types'
import { themeById } from '../../../shared/themes'
import { IconChevron, IconClose } from '../icons'

type Cur = { lastCwd?: string; lastSession?: TermSession }
interface Binding {
  itemId(): string | undefined
  onParams(cur: Cur): void
  onFind(): void
  onAi(): void
}

// Terminal + pty desacoplados do painel: o mesmo terminal pode sair de uma aba e voltar em outra.
interface TermHandle {
  el: HTMLDivElement
  term: Terminal
  search: SearchAddon
  itemId?: string
  profile?: string // connection p/ o NL->comando
  alive(): boolean
  bind(b?: Binding): void
  refit(): void
  redraw(): void
  findActive: boolean // busca aberta: a selecao (achado atual) usa a cor forte do achado ativo
  applyTheme(): void // reaplica o tema atual (com a cor da busca, se aberta)
  lastOutput(): string // ultimas linhas do buffer (contexto p/ o NL->comando)
  runCommand(cmd: string): void // injeta um comando no pty
  dispose(): void
}

// cor do achado ativo da busca (selecao) por tema claro/escuro
const FIND_ACTIVE = { dark: '#a87a12', light: '#f5c542' }
let currentThemeId = ''

function createTerm(params: TerminalParams): TermHandle {
  const el = document.createElement('div')
  el.className = 'term-inner'
  const term = new Terminal({
    allowProposedApi: true,
    cursorInactiveStyle: 'outline',
    drawBoldTextInBrightColors: true,
    // ConPTY ja reflui a tela no resize: sem isto o xterm refluia de novo e o historico perdia linhas
    ...(window.turno.winBuild ? { windowsPty: { backend: 'conpty' as const, buildNumber: window.turno.winBuild } } : {}),
  })
  let binding: Binding | undefined
  let copyOnSelect = false
  let rightClickPaste = true
  let ligaturesLoaded = false
  let ptyId: number | undefined
  let disposed = false
  let dead = false
  const fit = new FitAddon()
  term.loadAddon(fit)
  const search = new SearchAddon()
  term.loadAddon(search)
  term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank')))
  term.open(el)

  const h: TermHandle = {
    el,
    term,
    search,
    itemId: params.itemId,
    profile: params.profile,
    findActive: false,
    applyTheme() {
      const th = themeById(currentThemeId)
      const c = th.dark ? FIND_ACTIVE.dark : FIND_ACTIVE.light
      const want = h.findActive ? { ...th.term, selectionBackground: c, selectionInactiveBackground: c } : th.term
      if (term.options.theme !== want) term.options.theme = want
    },
    lastOutput() {
      const buf = term.buffer.active
      const out: string[] = []
      for (let i = Math.max(0, buf.length - 40); i < buf.length; i++) out.push(buf.getLine(i)?.translateToString(true) ?? '')
      return out.join('\n').trim().slice(-4000)
    },
    runCommand(cmd) {
      if (ptyId) window.turno.pty.write(ptyId, cmd + '\r')
    },
    alive: () => !dead && !disposed,
    bind(b) {
      if (!b && binding) h.itemId = binding.itemId() ?? h.itemId
      binding = b
    },
    refit() {
      if (!el.offsetWidth || !el.offsetHeight) return
      // Durante maximizar/restaurar o painel passa por tamanhos minusculos: redimensionar o pty para 1-2 linhas
      // faz o ConPTY descartar a tela (o terminal volta em branco). Ignora tamanhos degenerados.
      const d = fit.proposeDimensions()
      if (!d || d.cols < 20 || d.rows < 4) return
      fit.fit()
      if (ptyId) window.turno.pty.resize(ptyId, term.cols, term.rows)
    },
    redraw() {
      if (!el.offsetWidth || !el.offsetHeight) return
      // so refresh: o atlas de glifos do WebGL e compartilhado entre os terminais, e limpa-lo num deles
      // deixava os outros com o texto embaralhado/em branco
      term.refresh(0, term.rows - 1)
    },
    dispose() {
      if (disposed) return
      disposed = true
      offSettings()
      sel.dispose()
      el.removeEventListener('contextmenu', onContext)
      input.dispose()
      offData()
      offSession()
      offExit()
      if (ptyId) window.turno.pty.kill(ptyId)
      term.dispose()
      el.remove()
    },
  }

  // Pasta atual: o prompt emite OSC 9;9;"<pasta>" (integracao injetada no shell pelo main).
  // Sessao so vale enquanto o Claude roda neste pty: um terminal novo comeca sem nenhuma.
  let cur: Cur = { lastCwd: params.lastCwd }
  const remember = (patch: Cur): void => {
    cur = { ...cur, ...patch }
    binding?.onParams(cur)
    const itemId = binding?.itemId() ?? h.itemId
    if (!itemId) return
    if (patch.lastSession) patchItem(itemId, { agent: 'claude', sessionId: patch.lastSession.sessionId, cwd: patch.lastSession.cwd })
    else if ('lastSession' in patch) patchItem(itemId, { agent: undefined, sessionId: undefined }) // saiu do Claude
    else if (patch.lastCwd) patchItem(itemId, { cwd: patch.lastCwd })
  }
  term.parser.registerOscHandler(9, (data) => {
    if (!data.startsWith('9;')) return false
    const path = data.slice(2).replace(/^"|"$/g, '')
    if (path && path !== cur.lastCwd) remember({ lastCwd: path })
    return true
  })
  const uni = new Unicode11Addon()
  term.loadAddon(uni)
  term.unicode.activeVersion = '11'
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose()) // cai para o renderer DOM
    term.loadAddon(webgl)
  } catch {
    /* sem WebGL: renderer DOM */
  }

  const offSettings = onSettings((st) => {
    const t = st.terminal
    Object.assign(term.options, terminalOptions(t))
    // tema claro: branco/branco-brilhante da paleta somem no fundo claro (argumentos do PowerShell): garante contraste
    if (!themeById(st.theme).dark) term.options.minimumContrastRatio = Math.max(t.minimumContrastRatio, 4.5)
    currentThemeId = st.theme
    const theme = themeById(st.theme).term
    if (h.findActive) h.applyTheme()
    else if (term.options.theme !== theme) term.options.theme = theme // tema novo = configuracao nova: o xterm monta outro atlas
    // o padding fica no elemento do xterm: ele precisa do fundo do tema (senao a borda aparece preta)
    el.style.background = theme.background
    if (term.element) term.element.style.background = theme.background
    // padding no elemento do xterm, nao no container: o fit mede o container e desconta so o padding do xterm
    // (no container ele contava o padding como altura util e a ultima linha ficava cortada)
    el.style.padding = '0'
    const pad = `${t.padding}px`
    // o container nao muda de tamanho com o padding interno: refaz o fit na mao
    requestAnimationFrame(() => {
      if (term.element && term.element.style.padding !== pad) (term.element.style.padding = pad), h.refit()
    })
    copyOnSelect = t.copyOnSelect
    rightClickPaste = t.rightClickPaste
    // Ligaduras (opt-in): carrega o addon uma vez quando ligado. Desligar exige reabrir o terminal.
    if (t.ligatures && !ligaturesLoaded) {
      ligaturesLoaded = true
      try {
        term.loadAddon(new LigaturesAddon())
      } catch {
        /* sem suporte: ignora */
      }
    }
    requestAnimationFrame(() => h.refit())
  })
  const sel = term.onSelectionChange(() => {
    if (copyOnSelect && term.hasSelection()) void navigator.clipboard.writeText(term.getSelection())
  })
  // Botao direito: copia se ha selecao, senao cola (como no Windows Terminal).
  const onContext = (e: MouseEvent): void => {
    if (!rightClickPaste) return
    e.preventDefault()
    if (term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
    } else void navigator.clipboard.readText().then((t) => t && term.paste(t))
  }
  el.addEventListener('contextmenu', onContext)

  let pending = params.initialCommand
  const offData = window.turno.pty.onData((id, d) => {
    if (id !== ptyId) return
    term.write(d)
    // So manda o comando inicial depois que o shell imprimiu algo (o prompt): antes disso ele se perde.
    if (pending) {
      const cmd = pending
      pending = undefined
      setTimeout(async () => {
        if (/^\s*claude\b/.test(cmd)) await window.turno.routines.prepareClaude(cur.lastCwd ?? params.cwd, /--chrome\b/.test(cmd)).catch(() => {})
        window.turno.pty.write(id, cmd + '\r')
      }, 150)
    }
  })
  const offSession = window.turno.pty.onSession((id, s) => {
    if (id !== ptyId) return
    if (!s) cur.lastSession && remember({ lastSession: undefined })
    else if (s.sessionId !== cur.lastSession?.sessionId) remember({ lastSession: s })
  })
  const offExit = window.turno.pty.onExit((id, code) => {
    if (id !== ptyId) return
    dead = true
    term.write(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m\r\n`)
    if (!binding && h.itemId) killParked(h.itemId) // morreu escondido: some o indicador
  })
  window.turno.pty
    .create({ shell: params.shell, cwd: params.cwd, profile: params.profile, cols: term.cols, rows: term.rows })
    .then((id) => {
      if (disposed) return window.turno.pty.kill(id)
      ptyId = id
    })
    .catch((e) => {
      dead = true
      const raw = String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      // 267 = ERROR_DIRECTORY (pasta de trabalho invalida); 2/"not found" = shell inexistente
      const why = /error code: 267/.test(raw) ? 'the working folder is not a folder' : /error code: 2|not found/i.test(raw) ? 'the shell program was not found' : raw
      term.write(`\x1b[31mCouldn't start the shell: ${why}.\x1b[0m\r\n\x1b[90mCheck Default shell in Settings${params.itemId ? ' and this item' + "'" + 's working folder' : ''}.\x1b[0m\r\n`)
    })
  const input = term.onData((d) => ptyId && window.turno.pty.write(ptyId, d))
  term.attachCustomKeyEventHandler((e) => {
    // Shift+Enter: nova linha no prompt do Claude Code interativo (mesmo valor que o Wave envia).
    if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
      if (ptyId) window.turno.pty.write(ptyId, '\x1b\n')
      return false
    }
    if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && e.code === 'KeyF') {
      binding?.onFind()
      return false
    }
    if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
    if (e.code === 'KeyC' && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      return false
    }
    if (e.code === 'KeyV') {
      void navigator.clipboard.readText().then((t) => t && term.paste(t))
      return false
    }
    if (e.code === 'KeyA') {
      binding?.onAi() // Ctrl+Shift+A: NL -> comando
      return false
    }
    return true
  })
  return h
}

export function TerminalPanel({ params, api }: IDockviewPanelProps<TerminalParams>) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<TermHandle | undefined>(undefined)
  const [find, setFind] = useState<string | null>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const lastFind = useRef('') // texto de cada barra fica para a proxima vez que ela abrir
  const lastAsk = useRef('')
  const [aiLow, setAiLow] = useState(false)
  const aiInput = useRef<HTMLInputElement>(null)
  // abre a busca / a barra da IA (fecha a outra) e foca o campo; vale do terminal e de dentro das proprias barras
  const openFind = (): void => {
    setAi(null)
    setFind((f) => f ?? lastFind.current)
    requestAnimationFrame(() => {
      findInput.current?.focus()
      findInput.current?.select()
      if (findInput.current?.value) findNext(findInput.current.value, true)
    })
  }
  const openAi = (): void => {
    const hh = handle.current
    if (hh) {
      hh.search.clearDecorations()
      hh.term.clearSelection()
      if (hh.findActive) (hh.findActive = false), hh.applyTheme()
    }
    setFind(null)
    setHits(null)
    setFindLow(false)
    setAi((a) => a ?? { ask: lastAsk.current })
    // como a busca: se o cursor (prompt) esta nas 3 primeiras linhas visiveis, a barra vai para baixo
    const tt = hh?.term
    setAiLow(!!tt && tt.buffer.active.baseY + tt.buffer.active.cursorY - tt.buffer.active.viewportY < 3)
    requestAnimationFrame(() => (aiInput.current?.focus(), aiInput.current?.select()))
  }
  const barShortcut = (e: React.KeyboardEvent): boolean => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false
    const k = e.key.toLowerCase()
    if (k === 'f' && !e.shiftKey) return (e.preventDefault(), openFind(), true)
    if (k === 'a' && e.shiftKey) return (e.preventDefault(), openAi(), true)
    return false
  }
  const [hits, setHits] = useState<{ i: number; n: number } | null>(null)
  const [findLow, setFindLow] = useState(false) // barra embaixo: o resultado esta nas primeiras linhas

  const [ai, setAi] = useState<{ ask: string; loading?: boolean; result?: { command: string | null; explanation: string } } | null>(null)
  const conns = useSettings()?.connections ?? []
  const aiConnId = handle.current?.profile ?? conns[0]?.id ?? ''
  const aiConnName = conns.find((c) => c.id === aiConnId)?.name ?? aiConnId

  useEffect(() => {
    const el = host.current!
    const itemIdNow = (): string | undefined => (api.getParameters?.() as TerminalParams | undefined)?.itemId ?? params.itemId
    // Item escondido: reaproveita o terminal vivo em vez de abrir outro.
    let h = params.itemId ? (unpark(params.itemId) as TermHandle | undefined) : undefined
    if (h && !h.alive()) {
      h.dispose()
      h = undefined
    }
    if (!h) {
      h = createTerm(params)
      if (params.lastSession) api.updateParameters({ ...params, lastSession: undefined })
    }
    handle.current = h
    el.appendChild(h.el)
    h.bind({
      itemId: itemIdNow,
      onParams: (cur) => api.updateParameters({ ...paramsOf({ params, api }), lastCwd: cur.lastCwd, lastSession: cur.lastSession }),
      onFind: () => openFind(),
      onAi: () => openAi(),
    })
    if (params.itemId) setLive(params.itemId, 'open')
    requestAnimationFrame(() => {
      h.refit()
      h.redraw()
      // terminal que nunca teve foco nao desenha cursor nenhum: o xterm so mostra depois de "inicializado"
      // (foco ou tecla). Marca como inicializado para o cursor inativo (outline) aparecer desde o inicio.
      try {
        const core = (h.term as unknown as { _core?: { coreService?: { isCursorInitialized: boolean } } })._core
        if (core?.coreService && !core.coreService.isCursorInitialized) core.coreService.isCursorInitialized = true
      } catch {
        /* API interna mudou: segue sem o cursor inicial */
      }
      if (document.activeElement !== h.term.textarea) h.term.textarea?.dispatchEvent(new FocusEvent('blur'))
      h.term.refresh(0, h.term.rows - 1)
    })

    // Resize com debounce: o ConPTY reimprime a tela a cada resize.
    let t: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => (h.refit(), h.redraw()), 80)
    })
    ro.observe(el)
    // Grupo maximizado esconde os outros; ao restaurar, o canvas WebGL volta vazio sem redesenho.
    // Soltar uma aba na sidebar (drag do dock) corrompe o atlas do WebGL: redesenha.
    const onRedraw = (): void => void requestAnimationFrame(() => h.redraw())
    window.addEventListener('turno:redraw-terminals', onRedraw)
    const onFocusPanel = (e: Event): void => void ((e as CustomEvent).detail === api.id && focusTerm())
    window.addEventListener('turno:focus-panel', onFocusPanel)
    const onFocusIn = (e: FocusEvent): void => void (e.target !== h.term.textarea && h.term.textarea?.dispatchEvent(new FocusEvent('blur')))
    document.addEventListener('focusin', onFocusIn)
    // no startup o foco passa por varios paineis enquanto o dockview monta: confere de novo quando assenta
    const settle = setTimeout(() => document.activeElement !== h.term.textarea && h.term.textarea?.dispatchEvent(new FocusEvent('blur')), 1500)
    const vis = api.onDidVisibilityChange((e) => e.isVisible && requestAnimationFrame(() => (h.refit(), h.redraw())))
    const hits = h.search.onDidChangeResults((r) => setHits(r.resultCount ? { i: r.resultIndex + 1, n: r.resultCount } : { i: 0, n: 0 }))
    const focusTerm = (): void => void (!isModalOpen() && h.term.focus())
    const focus = api.onDidActiveChange((e) => e.isActive && (focusTerm(), requestAnimationFrame(() => h.redraw())))
    if (api.isActive) setTimeout(focusTerm, 50)

    return () => {
      clearTimeout(t)
      ro.disconnect()
      focus.dispose()
      vis.dispose()
      window.removeEventListener('turno:redraw-terminals', onRedraw)
      window.removeEventListener('turno:focus-panel', onFocusPanel)
      document.removeEventListener('focusin', onFocusIn)
      clearTimeout(settle)
      hits.dispose()
      const itemId = itemIdNow()
      h.bind(undefined)
      handle.current = undefined
      const discard = discarded.delete(api.id) // ids chat:<item> se repetem: consome a marca
      if (itemId && itemExists(itemId) && h.alive() && !discard) park(itemId, h)
      else {
        h.dispose()
        if (itemId) setLive(itemId)
      }
    }
  }, [])

  const close = (): void => {
    handle.current?.search.clearDecorations()
    handle.current?.term.clearSelection()
    if (handle.current?.findActive) {
      handle.current.findActive = false
      handle.current.applyTheme()
    }
    setFind(null)
    setHits(null)
    setFindLow(false)
    handle.current?.term.focus()
  }
  const search = (): SearchAddon | undefined => handle.current?.search
  // Decoracoes ligam o evento de contagem do addon (sem elas ele nao informa quantos achou).
  const [themeId, setThemeId] = useState('')
  useEffect(() => onSettings((st) => setThemeId(st.theme)), [])
  const darkTheme = themeById(themeId).dark
  // tema trocado com a busca aberta: refaz as cores dos achados e do achado atual com o tema novo
  const lastThemeId = useRef(themeId)
  useEffect(() => {
    if (lastThemeId.current === themeId) return
    lastThemeId.current = themeId
    if (find === null) return
    const q = find
    const raf = requestAnimationFrame(() => {
      handle.current?.search.clearDecorations()
      if (q) findNext(q, true)
    })
    return () => cancelAnimationFrame(raf)
  }, [themeId])
  const findRef = useRef<{ q: string | null; i: number }>({ q: null, i: 0 })
  findRef.current = { q: find, i: hits?.i ?? 0 }
  useEffect(() => {
    const t = handle.current?.term
    if (!t || find === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const d = t.onResize(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const { q, i } = findRef.current
        const s = handle.current?.search
        if (!q || !s || i < 1) return
        // sem selecao a busca recomeca do inicio do buffer: anda ate o mesmo indice
        handle.current?.term.clearSelection()
        for (let k = 0; k < i; k++) s.findNext(q, { decorations: DECO })
        placeBar()
      }, 60)
    })
    return () => (clearTimeout(timer), d.dispose())
  }, [find === null, themeId])
  const DECO = darkTheme
    ? { matchBackground: '#5c4a12', matchOverviewRuler: '#888888', activeMatchBackground: '#a87a12', activeMatchColorOverviewRuler: '#ffaa00' }
    : { matchBackground: '#fbe7a1', matchOverviewRuler: '#888888', activeMatchBackground: '#f5c542', activeMatchColorOverviewRuler: '#c98a00' }
  // A barra fica no topo; se o resultado cair nas 3 primeiras linhas visiveis ela cobriria o achado: desce.
  const placeBar = (): void => {
    const t = handle.current?.term
    const pos = t?.getSelectionPosition()
    setFindLow(!!t && !!pos && pos.start.y - t.buffer.active.viewportY < 3)
  }
  // durante a busca a selecao (que marca o achado atual) usa a cor do achado ativo; ao fechar volta o tema
  const markActive = (): void => {
    const h = handle.current
    if (!h || h.findActive) return
    h.findActive = true
    h.applyTheme()
  }
  const findNext = (q: string, incremental = false): void => {
    if (!q) {
      handle.current?.search.clearDecorations()
      handle.current?.term.clearSelection()
      setFindLow(false)
      return setHits(null)
    }
    markActive()
    const ok = search()?.findNext(q, { incremental, decorations: DECO })
    if (!ok) setHits({ i: 0, n: 0 })
    placeBar()
  }
  const findPrev = (q: string): void => {
    if (!q) return
    markActive()
    const ok = search()?.findPrevious(q, { decorations: DECO })
    if (!ok) setHits({ i: 0, n: 0 })
    placeBar()
  }
  const closeAi = (): void => {
    setAi(null)
    handle.current?.term.focus()
  }
  const askAi = async (): Promise<void> => {
    const h = handle.current
    if (!ai?.ask.trim() || !h || !aiConnId) return
    setAi({ ...ai, loading: true })
    const res = await window.turno.ai.suggestCommand(aiConnId, { ask: ai.ask, output: h.lastOutput() }).catch(() => ({ command: null, explanation: 'request failed' }))
    setAi((cur) => (cur ? { ...cur, loading: false, result: res } : null))
  }
  const execAi = (): void => {
    const cmd = ai?.result?.command
    if (cmd) handle.current?.runCommand(cmd)
    closeAi()
  }
  return (
    <div className="term-wrap">
      <div ref={host} className="term-host" onMouseDown={() => api.setActive()} />
      {ai !== null && (
        <div className={`term-find term-ai ${aiLow ? 'at-bottom' : ''}`}>
          <span className="muted small" title="connection used for the suggestion">via {aiConnName || '—'}</span>
          <input
            ref={aiInput}
            aria-label="Ask for a command"
            autoFocus
            value={ai.ask}
            placeholder="Ask for a command… (Enter)"
            onChange={(e) => (setAi({ ...ai, ask: e.target.value }), (lastAsk.current = e.target.value))}
            onKeyDown={(e) => {
              if (barShortcut(e)) return
              if (e.key === 'Escape') closeAi()
              else if (e.key === 'Enter') void askAi()
            }}
          />
          {ai.loading && <span className="muted">thinking…</span>}
          {ai.result && ai.result.command && (
            <>
              <code className="mono" title={ai.result.explanation}>{ai.result.command}</code>
              <button className="btn primary" onClick={execAi}>Execute</button>
            </>
          )}
          {ai.result && !ai.result.command && <span className="muted">{ai.result.explanation || 'no command'}</span>}
          <button className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={closeAi}><IconClose size={14} /></button>
        </div>
      )}
      {find !== null && (
        <div className={`term-find ${findLow ? 'at-bottom' : ''}`}>
          <input
            ref={findInput}
            aria-label="Search terminal"
            autoFocus
            value={find}
            placeholder="Search terminal"
            onChange={(e) => {
              setFind(e.target.value)
              lastFind.current = e.target.value
              findNext(e.target.value, true)
            }}
            onKeyDown={(e) => {
              if (barShortcut(e)) return
              if (e.key === 'Escape') close()
              else if (e.key === 'Enter') e.shiftKey ? findPrev(find) : findNext(find)
            }}
          />
          {hits && find && (
            <span className={`small find-count ${hits.n ? 'muted' : 'tone-warn'}`} aria-live="polite">
              {hits.n ? `${hits.i}/${hits.n}` : 'No results'}
            </span>
          )}
          <button className="icon-btn" title="Previous (Shift+Enter)" aria-label="Previous match" onClick={() => findPrev(find)}><IconChevron size={14} className="rot-up" /></button>
          <button className="icon-btn" title="Next (Enter)" aria-label="Next match" onClick={() => findNext(find)}><IconChevron size={14} className="rot-down" /></button>
          <button className="icon-btn" title="Close (Esc)" aria-label="Close search" onClick={close}><IconClose size={14} /></button>
        </div>
      )}
    </div>
  )
}
