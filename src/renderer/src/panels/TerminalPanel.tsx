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
import { discarded, paramsOf, takeEarlyKeys, type AgentTermParams, type TerminalParams } from '../layout'
import { getSettingsSnapshot, onSettings, useSettings } from '../appearance'
import { terminalOptions } from '../terminalOptions'
import { itemExists, patchItem } from '../sidebarStore'
import { killParked, park, setLive, unpark } from '../liveTerms'
import { ackNeeds } from '../agentStore'
import { askConfirm } from '../ConfirmDialog'
import type { TermSession } from '../../../shared/types'
import { themeById } from '../../../shared/themes'
import { agentDef } from '../../../shared/agents'
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
  agent?: AgentTermParams
  lastOutput(): string // ultimas linhas do buffer (contexto p/ o NL->comando)
  runCommand(cmd: string): void // injeta um comando no pty
  typeEarly(keys: string): void // teclas digitadas antes de a aba ter foco (guardadas pelo layout)
  dispose(): void
}

// Sugestao da IA que o Turno nao executa (veio de texto que estava na tela). Testa o texto ja limpo e sem os truques de
// escape dos shells (cl^aude, 'cl'+'aude', cl$()aude, cl\aude): nada que abra o Claude ou mexa nas permissoes dele.
// E melhor esforco (um shell tem formas demais de montar um nome); a protecao de verdade e a pessoa ver o comando
// antes do Execute, e o comando executado ainda passa por defaultPermissionMode.
export function suggestionProblem(cmd: string): 'multiline' | 'claude' | undefined {
  const c = stripControls(cmd).trim()
  if (/[\r\n]/.test(c)) return 'multiline'
  const flat = c.replace(/[\^'"`+()$\s{}[\]\\]/g, '').toLowerCase()
  return /claude|anthropic|dangerously|bypasspermissions|permission-?mode/.test(flat) ? 'claude' : undefined
}
const SHIFT_ENTER = '\x1b\r' // Alt+Enter: nova linha no Claude Code e nos outros CLIs de agente
// Relatorios que o xterm manda sozinho ao programa: CPR/DSR, DA1/DA2, DECRQM, flags do teclado kitty, foco, OSC e DCS
// eslint-disable-next-line no-control-regex
const TERMINAL_REPLY = /^(\x1b\[\??[\d;]*[Rn]|\x1b\[[?>=]?[\d;]*c|\x1b\[\?[\d;]*\$y|\x1b\[\?\d*u|\x1b\[[IO]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\)+$/

// Claude aberto pelo Turno comeca no modo de permissao normal, mesmo com defaultMode "bypassPermissions" no
// settings.json do usuario (copiado para as contas isoladas). Comando que ja escolhe o modo fica como esta.
// So olha as flags FORA de aspas: o prompt (texto do usuario, de uma tarefa, de um repo) pode citar a flag.
// Vale para `claude` em qualquer posicao de comando (`cd x; claude`, `& claude.exe`), nao so no comeco da linha.
const CLAUDE_AT_COMMAND = /(^\s*|[;&|(]\s*|&\s+)(claude(?:\.exe)?)(?=\s|$|;|&|\|)/g
export const defaultPermissionMode = (cmd: string): string => {
  const bare = cmd.replace(/"[^"]*"|'[^']*'/g, '')
  if (/--permission-mode\b|--dangerously-skip-permissions\b/.test(bare) || !new RegExp(CLAUDE_AT_COMMAND.source).test(bare)) return cmd
  // so fora das aspas (o texto do prompt nao muda); "^" so vale no comeco da linha, nao logo depois de uma aspa
  return cmd.replace(/("[^"]*"|'[^']*')|([^"']+)/g, (_m, quoted: string | undefined, plain: string, at: number) =>
    quoted ?? plain.replace(CLAUDE_AT_COMMAND, (x, pre: string, name: string, i: number) => (i === 0 && !pre.trim() && at > 0 ? x : `${pre}${name} --permission-mode default`)),
  )
}

// Colar texto no pty. Com bracketed paste (Claude Code e outros TUIs) vai inteiro e marcado como colagem, sem
// caracteres de controle que fechariam a colagem antes da hora.
// sem nenhum caractere de controle (so tab e quebra de linha): ESC tiraria a colagem do modo marcado (inclusive com
// marcas aninhadas que se remontam) ou viraria tecla no ConPTY; ^C, ^D etc. agiriam no programa
// eslint-disable-next-line no-control-regex
const stripControls = (s: string): string => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')

// Varias linhas num programa sem bracketed paste (shell, REPL, agente ainda subindo): cada quebra de linha vira Enter
// e a linha roda como comando. Como no Windows Terminal, pergunta antes de colar.
// bracketed: o programa que esta na frente ligou o modo (o flag do xterm sozinho pode ter ficado ligado por um programa
// que ja saiu). Fora dele, a quebra de linha no fim e tirada (como no Windows Terminal): colar nunca da Enter sozinho.
async function pasteInto(term: Terminal, text: string, bracketed: boolean): Promise<void> {
  let t = stripControls(text)
  if (!bracketed) t = t.replace(/[\r\n]+$/, '')
  if (!t) return
  if (!bracketed && /[\r\n]/.test(t)) {
    const n = t.split(/\r\n|\r|\n/).filter((l) => l.trim()).length
    const ok = await askConfirm({ title: 'Paste multiple lines?', message: `The text has ${n} lines. The program in this terminal doesn't mark pasted text, so each line may run as a command as soon as it is pasted.`, confirmLabel: 'Paste', danger: false })
    if (!ok) return
  }
  term.paste(t)
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
      // sugestao da IA (veio de texto que estava na tela): uma linha so, sem caracteres de controle, Claude sem bypass
      if (suggestionProblem(cmd)) return
      const c = defaultPermissionMode(stripControls(cmd).trim())
      if (!c) return
      if (ptyId) window.turno.pty.write(ptyId, c + '\r')
    },
    typeEarly(keys) {
      if (!keys) return
      if (hold) held += keys
      else if (ptyId) window.turno.pty.write(ptyId, keys)
      else preSpawn += keys
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
      el.removeEventListener('paste', onNativePaste, true)
      input.dispose()
      keyAck.dispose()
      offAgentState()
      offData()
      offSession()
      offExit()
      offSwap()
      window.removeEventListener('turno:agent-switching', onSwitching)
      window.removeEventListener('turno:agent-switch-cancel', onSwitchCancel)
      clearTimeout(switchTimer)
      offType()
      clearTimeout(typeTimer)
      clearTimeout(releaseTimer)
      clearTimeout(releaseCap)
      clearTimeout(pendingTimer)
      clearTimeout(promptTimer)
      if (ptyId) window.turno.pty.kill(ptyId)
      if (agent) void window.turno.agents.close(agent.key)
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
  // Colagem marcada (bracketed paste) que o Turno confia: ligada pelo programa que esta na frente AGORA. Zera a cada
  // prompt do shell (OSC 9;9) e a cada processo novo; o flag do xterm sozinho fica ligado se o programa sair sem desligar.
  let bpOn = false
  let shellInFront = false // prompt do shell visivel (OSC 9;9) desde o ultimo comando que o Turno mandou
  let promptSignal = false // este shell manda OSC 9;9 a cada prompt
  let onPrompt: () => void = () => {}
  let lateFirstPrompt = false
  // ...e so com o Claude rodando NESTE terminal (detector de processos do main): um programa aninhado (cmd, ssh, REPL)
  // nao manda o prompt que zera o modo, e um texto exibido com ESC[?2004h ligaria a confianca sozinho
  // (aba de agente em conta isolada: o detector so ve a pasta padrao do Claude; vale o aviso do broker de que o Claude
  // da aba subiu, ate o prompt do shell voltar)
  // So em shell que avisa o proprio prompt (pwsh/cmd com a integracao do Turno): no Git Bash nao ha como saber que o
  // Claude ja saiu.
  const bracketed = (): boolean => bpOn && term.modes.bracketedPasteMode && (!!cur.lastSession || (hooked && agentUp && promptSignal && !shellInFront))
  // pelo parser do xterm: segue a ordem real da saida (sequencia partida entre pedacos, prompt ainda na fila)
  const has2004 = (ps: (number | number[])[]): boolean => ps.some((p) => p === 2004 || (Array.isArray(p) && p.includes(2004)))
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (ps) => (has2004(ps) && (bpOn = true), false))
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (ps) => (has2004(ps) && (bpOn = false), false))
  term.parser.registerOscHandler(9, (data) => {
    if (!data.startsWith('9;')) return false
    bpOn = false
    promptSignal = true
    // 1o prompt de um shell que recebeu o comando adiantado (perfil lento, teto de espera): o agente ainda vai subir
    if (lateFirstPrompt) lateFirstPrompt = false
    else shellInFront = true
    onPrompt() // comando do Turno esperando o prompt: vai agora
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
    // programa que rastreia o mouse (o Claude Code cola sozinho no clique direito): o clique e dele, colar aqui duplicava
    if (term.modes.mouseTrackingMode !== 'none') return
    if (term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
    } else void navigator.clipboard.readText().then((t) => void (t && pasteInto(term, t, bracketed())))
  }
  el.addEventListener('contextmenu', onContext)
  // Qualquer colagem nativa (Shift+Insert, menu do navegador) passa pela mesma limpeza: sem isto o xterm colava o
  // texto cru pelo proprio evento de paste
  const onNativePaste = (e: ClipboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const t = e.clipboardData?.getData('text/plain')
    if (t) void pasteInto(term, t, bracketed())
  }
  el.addEventListener('paste', onNativePaste, true)

  const agent = params.agent
  let pending = params.initialCommand
  let typeAfter: string | undefined // agente que nao aceita prompt no comando: digita quando a tela parar de mudar
  let typeTimer: ReturnType<typeof setTimeout> | undefined
  let commandSent = false
  // Enquanto o Turno digita o comando (abrir ou trocar de conta), o que a pessoa digita fica guardado: no meio do
  // comando estragava a linha. Logo depois do Enter do comando o texto vai (o console guarda ate o agente ler);
  // agente que recebe o prompt digitado depois (typeAfter) so recebe o texto depois desse prompt.
  let hold = !!pending || !!agent
  let held = ''
  // teclas digitadas antes de esta aba existir na tela (logo depois do atalho de aba nova)
  let preSpawn = ''
  {
    const k = takeEarlyKeys()
    if (hold) held += k
    else preSpawn = k
  }
  let releaseTimer: ReturnType<typeof setTimeout> | undefined
  let releaseCap: ReturnType<typeof setTimeout> | undefined
  // Claude (hooks) que ainda nao avisou que subiu: o texto vai SEM quebra de linha. Se ele nao subir, o texto fica
  // parado na linha do shell em vez de virar comando; se subiu, cai no prompt (ou na pergunta de confianca na pasta).
  let hooked = false
  let agentUp = false
  const release = (): void => {
    clearTimeout(releaseTimer)
    clearTimeout(releaseCap)
    if (!hold) return
    hold = false
    let t = held
    held = ''
    if ((hooked && !agentUp) || shellInFront) t = t.replace(/[\r\n]+/g, ' ')
    if (t && ptyId) window.turno.pty.write(ptyId, t)
  }
  const offAgentState = agent
    ? window.turno.agents.onSessions((list) => {
        const s = list.find((x) => x.key === agent.key)
        if (!s) return
        hooked = agentDef(s.agent)?.usage === 'claude'
        const up = s.status !== 'starting' && s.status !== 'swapping'
        // o Claude avisou que subiu DEPOIS do ultimo prompt visto: e ele que esta na frente (prompt com redesenho no
        // Enter, como o "transient prompt" do oh-my-posh/Starship, manda um OSC 9;9 a mais logo depois do comando)
        if (up && !agentUp && hooked && commandSent) shellInFront = false
        // subiu: o texto guardado vai assim que a tela assentar (o onData adia enquanto ela muda)
        if (up && !agentUp && hold && commandSent && !typeAfter) {
          clearTimeout(releaseTimer)
          releaseTimer = setTimeout(release, 800)
        }
        agentUp = up
      })
    : () => {}
  // digita o prompt do Turno (quando a tela assentou, ou no teto de espera) e so depois devolve o teclado
  const typePrompt = (): void => {
    clearTimeout(typeTimer)
    clearTimeout(releaseCap)
    // o agente fechou e o prompt do shell voltou: o texto do prompt viraria comando do shell
    // Sem certeza de que o agente esta na frente (o prompt do shell apareceu depois do comando, ou o shell nao avisa o
    // proprio prompt, como o bash): o prompt vai SEM o Enter. No agente a pessoa so confirma; se o agente fechou, nada
    // roda no shell. (Prompt com redesenho no Enter, como o transient prompt do oh-my-posh, tambem cai aqui.)
    if (typeAfter && ptyId) window.turno.pty.write(ptyId, typeAfter + (promptSignal && !shellInFront ? '\r' : ''))
    typeAfter = undefined
    clearTimeout(releaseTimer)
    releaseTimer = setTimeout(release, 600)
  }
  const startHold = (): void => {
    hold = true
    clearTimeout(releaseTimer)
    clearTimeout(releaseCap)
  }
  // O comando do Turno vai quando o shell mostra o prompt (OSC 9;9, pwsh/cmd com a integracao do Turno): mandado antes,
  // ele era lido "adiantado" e o 1o prompt chegava DEPOIS, como se o agente ja tivesse saido. Shell sem esse aviso
  // (bash): pouco depois da primeira saida. Teto: o shell com aviso que demora (perfil lento) recebe assim mesmo.
  const shellPath = params.shell || getSettingsSnapshot()?.terminal.defaultShell || (window.turno.winBuild ? 'pwsh.exe' : '')
  const promptAware = /pwsh|powershell/i.test(shellPath) || /cmd\.exe$/i.test(shellPath)
  let pendingTimer: ReturnType<typeof setTimeout> | undefined
  let promptTimer: ReturnType<typeof setTimeout> | undefined
  const sendPending = (): void => {
    clearTimeout(pendingTimer)
    pendingTimer = undefined
    clearTimeout(promptTimer)
    const cmd = pending
    const id = ptyId
    if (!cmd || !id || disposed) return
    pending = undefined
    // mandado antes do 1o prompt de um shell que avisa o prompt: esse prompt vai chegar depois, e nao quer dizer que o agente saiu
    if (promptAware && !promptSignal) lateFirstPrompt = true
    void (async () => {
      // aba de agente: o main ja preparou a pasta da conta (confiavel, Chrome)
      if (!agent && /^\s*claude\b/.test(cmd)) await window.turno.routines.prepareClaude(cur.lastCwd ?? params.cwd, /--chrome\b/.test(cmd)).catch(() => {})
      window.turno.pty.write(id, defaultPermissionMode(cmd) + '\r')
      commandSent = true
      shellInFront = false
      if (typeAfter) releaseCap = setTimeout(typePrompt, 12_000) // agente que nunca para de redesenhar
      else {
        // o agente descarta o que chega antes de ele ler o teclado: o texto guardado espera a tela dele assentar
        // (o onData adia a cada mudanca), com teto para quem nunca para de redesenhar
        releaseTimer = setTimeout(release, 1500)
        releaseCap = setTimeout(release, 15_000)
      }
    })()
  }
  onPrompt = () => {
    if (!pending) return
    clearTimeout(promptTimer)
    promptTimer = setTimeout(sendPending, 50)
  }
  const offData = window.turno.pty.onData((id, d) => {
    if (id !== ptyId) return
    term.write(d)
    if (pending) {
      if (!pendingTimer) pendingTimer = setTimeout(sendPending, promptAware ? 6000 : 150)
    } else if (typeAfter && commandSent) {
      clearTimeout(typeTimer)
      typeTimer = setTimeout(typePrompt, 2000)
    } else if (hold && commandSent) {
      clearTimeout(releaseTimer)
      releaseTimer = setTimeout(release, 1500)
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
    bpOn = false
    term.write(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m\r\n`)
    if (!binding && h.itemId) killParked(h.itemId) // morreu escondido: some o indicador
  })
  const spawn = (launchId?: string): void => void window.turno.pty
    .create({ shell: params.shell, cwd: cur.lastCwd ?? params.cwd, profile: params.profile, cols: term.cols, rows: term.rows, launchId })
    .then((id) => {
      if (disposed) return window.turno.pty.kill(id)
      ptyId = id
      dead = false
      if (preSpawn) (window.turno.pty.write(id, preSpawn), (preSpawn = ''))
      bpOn = false // processo novo (inclusive na troca de conta): o modo do anterior nao vale
    })
    .catch((e) => {
      dead = true
      const raw = String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      // 267 = ERROR_DIRECTORY (pasta de trabalho invalida); 2/"not found" = shell inexistente
      const why = /error code: 267/.test(raw) ? 'the working folder is not a folder' : /error code: 2|not found/i.test(raw) ? 'the shell program was not found' : raw
      term.write(`\x1b[31mCouldn't start the shell: ${why}.\x1b[0m\r\n\x1b[90mCheck Default shell in Settings${params.itemId ? ' and this item' + "'" + 's working folder' : ''}.\x1b[0m\r\n`)
    })
  // Aba de agente: o main escolhe a conta (ranking), prepara a pasta isolada + hooks e devolve o comando.
  const launchAgent = (): void => {
    if (!agent) return spawn(params.launchId)
    window.turno.agents
      .prepare({ key: agent.key, agent: agent.agent, accountId: agent.accountId, cwd: cur.lastCwd ?? params.cwd, resumeSessionId: agent.resumeSessionId, prompt: agent.prompt, chrome: agent.chrome, folderId: agent.folderId, model: agent.model })
      .then((l) => {
        pending = l.command
        typeAfter = l.typeAfter
        spawn(l.launchId)
      })
      .catch((e) => {
        dead = true
        const msg = String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        term.write(`\x1b[31m${msg}\x1b[0m\r\n`)
      })
  }
  launchAgent()
  // Texto que estava na caixa de entrada do Claude (lido da tela): a troca de conta o leva para a sessao nova.
  // Linhas de continuacao viram espaco (redigitado antes de o Claude novo subir, quebra de linha seria um Enter).
  const scrapeDraft = (): string => {
    if (!hooked) return ''
    const buf = term.buffer.active
    const rows: string[] = []
    for (let i = buf.viewportY; i < buf.viewportY + term.rows; i++) rows.push(buf.getLine(i)?.translateToString(true) ?? '')
    let at = -1
    for (let i = rows.length - 1; i >= 0; i--) if (/^\s*[>❯]\s/.test(rows[i])) (at = i), (i = -1)
    if (at < 0) return ''
    const parts = [rows[at].replace(/^\s*[>❯]\s?/, '')]
    for (let i = at + 1; i < rows.length && !/^\s*[─━-]{3,}/.test(rows[i]) && rows[i].trim(); i++) parts.push(rows[i].trim())
    // o Claude preenche as linhas da caixa com espacos (e NBSP): tudo vira um espaco so
    const text = parts.join(' ').replace(/[\s\u00a0]+/g, ' ').trim()
    return /^Try ".*"$/.test(text) ? '' : text // dica cinza do Claude com a caixa vazia
  }
  // Troca pedida pelo Turno (menu, paleta, aviso de reset): a partir do pedido o teclado fica guardado (antes ia para o
  // Claude que ia ser fechado). Se a troca nao vier, devolve.
  let switching = false
  let switchTimer: ReturnType<typeof setTimeout> | undefined
  const onSwitching = (e: Event): void => {
    if (!agent || (e as CustomEvent<string>).detail !== agent.key || hold) return
    switching = true
    held = ''
    startHold()
    clearTimeout(switchTimer)
    switchTimer = setTimeout(() => {
      switching = false
      release()
    }, 15_000)
  }
  window.addEventListener('turno:agent-switching', onSwitching)
  const onSwitchCancel = (e: Event): void => {
    if (!agent || (e as CustomEvent<string>).detail !== agent.key || !switching) return
    switching = false
    clearTimeout(switchTimer)
    release()
  }
  window.addEventListener('turno:agent-switch-cancel', onSwitchCancel)
  // Troca de conta/agente na mesma aba: mata o processo atual e sobe o novo no mesmo terminal.
  const offSwap = agent
    ? window.turno.agents.onSwap((l) => {
        if (l.key !== agent.key) return
        const draft = scrapeDraft()
        const typed = switching ? held.replace(/[\r\n]+/g, ' ') : ''
        switching = false
        clearTimeout(switchTimer)
        const old = ptyId
        ptyId = undefined
        if (old) window.turno.pty.kill(old)
        clearTimeout(typeTimer)
        clearTimeout(pendingTimer) // o teto de espera era do pty antigo
        clearTimeout(promptTimer)
        pendingTimer = undefined
        lateFirstPrompt = false
        promptSignal = false // shell novo: o 1o prompt dele ainda nao chegou
        commandSent = false
        // o rascunho da caixa do Claude antigo e o que foi digitado depois do pedido de troca vao para o Claude novo (sem Enter)
        // (espaco no fim: o que a pessoa ainda digitar durante a troca emenda como palavra nova)
        // (espaco depois do rascunho so se nada foi digitado ainda: o que vier emenda como palavra nova; ja digitando, continua)
        held = typed ? [draft, typed].filter(Boolean).join(' ') : draft ? draft + ' ' : ''
        agentUp = false
        startHold()
        term.write(`\r\n\x1b[36m── ${l.banner ?? 'continued on another account'} ──\x1b[0m\r\n`)
        pending = l.command
        typeAfter = l.typeAfter
        spawn(l.launchId)
      })
    : () => {}
  // O broker pede para escrever no agente (ex.: a nota de passagem antes de trocar de agente)
  const offType = agent ? window.turno.agents.onType((key, text) => void (key === agent.key && ptyId && window.turno.pty.write(ptyId, text + '\r'))) : () => {}
  // tecla na aba = respondeu: o "Needs you" dela sai da sidebar (onData nao serve: o xterm manda sozinho o aviso
  // de foco/blur que o Claude Code pede, e trocar de aba ja "respondia")
  const keyAck = term.onKey(() => agent && ackNeeds(agent.key))
  const input = term.onData((d) => {
    // respostas automaticas do terminal (posicao do cursor, atributos, foco...) nao sao digitacao: seguram o CLI
    // que perguntou se ficarem presas (o Codex desiste de ler a posicao do cursor em ~2 s)
    if (hold && !TERMINAL_REPLY.test(d)) held += d
    else if (ptyId) window.turno.pty.write(ptyId, d)
  })
  term.attachCustomKeyEventHandler((e) => {
    // Shift+Enter: nova linha no prompt do agente. Barra o keydown E o keypress: so o keydown deixava o keypress
    // do Enter passar e o xterm mandava um Enter normal (o prompt era enviado).
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.type === 'keydown') {
        e.preventDefault()
        if (hold) held += SHIFT_ENTER
        else if (ptyId) window.turno.pty.write(ptyId, SHIFT_ENTER)
      }
      return false
    }
    // Ctrl+V cola o texto da area de transferencia (como no Windows Terminal). Antes ia um ^V cru para o programa:
    // o Claude Code procurava imagem no clipboard (lento) e o texto nunca era colado. Sem texto, segue o ^V.
    if (e.code === 'KeyV' && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      if (e.type === 'keydown') {
        e.preventDefault()
        void navigator.clipboard
          .readText()
          .catch(() => '')
          .then((t) => (t ? pasteInto(term, t, bracketed()) : term.input('\x16')))
      }
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
      e.preventDefault() // senao o Chromium tambem cola (colar como texto simples) pelo evento nativo, sem limpeza
      void navigator.clipboard.readText().then((t) => void (t && pasteInto(term, t, bracketed())))
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
  // Aba de agente: guarda nos parametros a sessao nativa e a conta atual (reabrir retoma a mesma conversa)
  useEffect(() => {
    const a = params.agent
    if (!a) return
    return window.turno.agents.onSessions((list) => {
      const s = list.find((x) => x.key === a.key)
      if (!s) return
      const p = (api.getParameters?.() as TerminalParams | undefined) ?? params
      const cur = p.agent ?? a
      if (s.sessionId === cur.resumeSessionId && s.accountId === cur.accountId && s.agent === cur.agent && !cur.prompt) return
      // trocou de agente (handoff): a sessao antiga e de outro CLI, nunca reaproveita o id
      const sameAgent = !cur.agent || s.agent === cur.agent
      api.updateParameters({ ...p, agent: { ...cur, agent: s.agent, resumeSessionId: sameAgent ? (s.sessionId ?? cur.resumeSessionId) : s.sessionId, accountId: s.accountId, prompt: undefined } })
      if (p.itemId && s.sessionId && s.agent === 'claude') patchItem(p.itemId, { agent: 'claude', sessionId: s.sessionId })
    })
  }, [])
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
    // foco ja na montagem (tecla digitada logo depois do atalho de nova aba nao cai no vazio) e de novo quando o dock assenta
    // quando o foco chega, as teclas que o layout guardou (digitadas antes disso) entram nesta aba
    // (as tentativas tardias so pegam o foco se ele ainda estiver no vazio: nunca tiram de onde a pessoa clicou)
    const focusAndDrain = (force: boolean): void => {
      const a = document.activeElement
      if (force || !a || a === document.body) focusTerm()
      h.typeEarly(takeEarlyKeys())
    }
    if (api.isActive) for (const ms of [0, 50, 200, 500, 900]) ms ? setTimeout(() => focusAndDrain(ms <= 50), ms) : focusAndDrain(true)

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
      if (itemId && itemExists(itemId) && h.alive() && !discard) {
        h.agent = ((api.getParameters?.() as TerminalParams | undefined) ?? params).agent // reabrir mantem o vinculo com o broker
        park(itemId, h)
      }
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
      <div ref={host} className="term-host" onMouseDown={() => (api.setActive(), ackNeeds(paramsOf({ params, api }).agent?.key))} />
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
              <code className="mono ai-cmd" title={ai.result.explanation}>{ai.result.command}</code>
              {suggestionProblem(ai.result.command) === 'multiline' ? (
                <span className="muted small">More than one line: Turno won't run it. Copy and review it first.</span>
              ) : suggestionProblem(ai.result.command) === 'claude' ? (
                <span className="muted small">Starts Claude: Turno won't run it from a suggestion. Type it yourself if you want it.</span>
              ) : (
                <button className="btn primary" onClick={execAi}>Execute</button>
              )}
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
