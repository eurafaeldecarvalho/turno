import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../Toast'
import { ListInput } from '../ListInput'
import { Cron } from 'croner'
import { NumInput } from '../NumInput'
import type { IDockviewPanelProps } from 'dockview-react'
import type { McpServerDef } from '../../../shared/types'
import { WEEKDAYS, type Effort, type PermissionMode, type RoutineConfig, type Weekday } from '../../../shared/types'
import { useStore, reloadRuns } from '../store'
import { useSettings } from '../appearance'
import { askConfirm } from '../ConfirmDialog'
import { ModelSelect } from '../ModelSelect'
import { dockApi, setRoutineEditGuard, openHistory, openRoutine } from '../layout'
import { scheduleSummary, when } from '../fmt'
import { IconFolder, IconHistory, IconPlay, IconPlus, IconClose } from '../icons'

const DAY_LABEL: Record<Weekday, string> = { sun: 'Su', mon: 'Mo', tue: 'Tu', wed: 'We', thu: 'Th', fri: 'Fr', sat: 'Sa' }
const DAY_TITLE: Record<Weekday, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' }
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const PERMS: Array<{ v: PermissionMode; t: string; d: string }> = [
  { v: 'manual', t: 'Ask', d: 'Asks for approval in the app (and pings your phone). Without an answer, the run stays paused waiting.' },
  { v: 'dontAsk', t: 'Allowed only', d: 'Uses only the tools in the list below; everything else is denied without asking.' },
  { v: 'auto', t: 'Auto', d: 'A classifier approves safe actions and blocks risky ones.' },
  { v: 'acceptEdits', t: 'Accept edits', d: 'Edits files without asking; commands not on the list are denied.' },
  { v: 'bypassPermissions', t: 'Bypass all', d: 'Same as --dangerously-skip-permissions. Does anything without asking.' },
]

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') // cortado no meio: sem hifen sobrando no fim

// Erros que o renderer ja sabe ver (cron/fuso): nao manda salvar so para o main recusar.
function localError(c: RoutineConfig): string | undefined {
  const errs: string[] = []
  if (!c.name.trim()) errs.push('name: give the routine a name')
  const expr = c.schedule.cron?.trim()
  if (expr) {
    try {
      new Cron(expr, { paused: true })
    } catch (e) {
      errs.push(`schedule.cron: invalid cron: ${(e as Error).message}`)
    }
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: c.timezone })
  } catch {
    errs.push('timezone: unknown time zone (use an IANA name like America/Sao_Paulo)')
  }
  return errs.length ? errs.join('; ') : undefined
}
// Parte da mensagem que fala de um campo ("schedule.cron: ...; timezone: ...").
const fieldErr = (msg: { tone: string; text: string } | undefined, re: RegExp): string | undefined =>
  msg?.tone === 'err' ? msg.text.split('; ').find((p) => re.test(p)) : undefined

export function RoutineEditor({ params, api }: IDockviewPanelProps<{ routineId: string | null }>) {
  const routines = useStore((s) => s.routines)
  const [savedId, setSavedId] = useState<string | null>(params.routineId)
  const existing = routines.find((r) => r.id === savedId)
  const [cfg, setCfg] = useState<RoutineConfig>()
  const [prompt, setPrompt] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string }>()
  const [newTime, setNewTime] = useState('')
  const [timeKey, setTimeKey] = useState(0)
  const timeInput = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [running, setRunning] = useState(false)
  const conns = useSettings()?.connections ?? []

  // Carrega do disco; recarrega se o arquivo mudar e nao houver edicao pendente.
  useEffect(() => {
    if (existing && !dirty) {
      setCfg(existing.config)
      setPrompt(existing.prompt)
      setId(existing.id)
    }
  }, [existing, dirty])
  // Arquivo mudou no disco por fora (outro editor) com edicao pendente aqui: o disco vence. Sem isso, um
  // arquivo quebrado e consertado por fora era sobrescrito pelo formulario montado com valores padrao.
  const ownKey = useRef('') // conteudo que o proprio editor acabou de gravar (o que voltar igual nao e mudanca externa)
  const lastSaveAt = useRef(0)
  const saving = useRef(false)
  // conteudo do arquivo que o editor conhece (do disco ou do proprio save): base do compare-and-swap.
  // Mesmo formato do contentKey do main: JSON [config, prompt].
  const diskKey = (r: { config: RoutineConfig; prompt: string }): string => JSON.stringify([r.config, r.prompt])
  const knownContent = useRef<string | undefined>(existing ? diskKey(existing) : undefined)
  useEffect(() => {
    // sem edicao pendente, o que esta no disco e o que o editor mostra
    if (existing && !saving.current && !dirty) knownContent.current = diskKey(existing)
  }, [existing, dirty])
  // compara o conteudo do arquivo, nao a identidade: o objeto muda a cada run (lastRun) sem o arquivo mudar
  const fileKey = existing ? JSON.stringify([existing.config, existing.prompt, existing.error ?? null]) : ''
  const seenFile = useRef(fileKey)
  useEffect(() => {
    const prev = seenFile.current
    seenFile.current = fileKey
    if (!prev || !existing || prev === fileKey || !dirty) return
    if (fileKey === ownKey.current || saving.current) return // e o que nos mesmos gravamos (ou esta gravando agora)
    knownContent.current = diskKey(existing)
    setDirty(false)
    setMsg(undefined)
    setCfg(existing.config)
    setPrompt(existing.prompt)
    setId(existing.id)
    toast('ROUTINE.md changed on disk; the editor reloaded it (your unsaved edits here were dropped).', 'warn')
  }, [fileKey])
  useEffect(() => {
    if (!params.routineId)
      void window.turno.routines.template().then((t) => {
        setCfg({ ...t.config, enabled: false, allowed_tools: t.config.allowed_tools.length ? t.config.allowed_tools : ['Read'], schedule: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], times: ['09:00'] } })
        setPrompt('')
      })
  }, [])

  // Auto save: rotina existente grava sozinha ~0,6s depois da ultima mudanca.
  // A pasta (id) so grava ao sair do campo, para nao renomear o diretorio a cada tecla.
  const rev = useRef(0)
  const saveRef = useRef<() => Promise<boolean>>(undefined)
  const [folderFocus, setFolderFocus] = useState(false)
  const [status, setStatus] = useState<'saving' | 'saved'>()
  const touch = (): void => {
    rev.current++
    setDirty(true)
    setStatus(undefined)
  }
  // ROUTINE.md com campo invalido: o editor mostra o padrao no lugar; so grava depois que o usuario aceitar
  const [acceptFix, setAcceptFix] = useState(false)
  // card "Accounts, MCP and context" numa conexao nao-Claude: depois de aparecer, fica ate fechar o editor
  // (limpar o ultimo valor desmontava o card com o foco dentro e o teclado caia no body)
  const cardSticky = useRef(false)
  const [createTried, setCreateTried] = useState(false) // apertou Create: mostra o erro da pasta mesmo sem ter mexido nela
  // Advanced fechado esconderia o aviso de um campo invalido do arquivo (fuso/cron): abre sozinho
  const advRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (/(^|; )(timezone|schedule\.cron|catchup_window_h|catchup)[.:]/.test(existing?.error ?? '')) advRef.current?.setAttribute('open', '')
  }, [existing?.error, !!cfg])
  // rotina ja salva que sumiu da lista (pasta apagada/movida por fora), fora da janela de um rename nosso
  const loadedAll = useStore((s) => s.loaded)
  const fileGone = !!savedId && loadedAll && !existing && Date.now() - lastSaveAt.current > 3000
  // pasta que tinha sumido voltou: o que esta no disco vence (a edicao feita sem a pasta nao e gravada)
  const wasGone = useRef(false)
  useEffect(() => {
    if (fileGone) return void (wasGone.current = true)
    if (!wasGone.current || !existing) return
    wasGone.current = false
    knownContent.current = diskKey(existing)
    setCfg(existing.config)
    setPrompt(existing.prompt)
    setDirty(false)
    setMsg(undefined)
    setStatus(undefined)
    toast("The routine's folder is back; the editor reloaded it from disk.", 'warn')
  }, [fileGone, existing])
  // YAML que nao parseia: o formulario mostra so valores padrao (nada do arquivo); salvar daqui apagaria tudo
  const fileUnreadable = /^(invalid YAML|ROUTINE\.md has no frontmatter)/.test(existing?.error ?? '')
  // cada erro novo no arquivo (editado por fora depois de um "Replace and save") pede confirmacao de novo
  useEffect(() => setAcceptFix(false), [existing?.error])
  const fileBroken = !!existing?.error && /:/.test(existing.error) && !acceptFix
  useEffect(() => {
    if (!dirty || !savedId || folderFocus || fileBroken || fileGone) return
    const t = setTimeout(() => void saveRef.current?.(), 600)
    return () => clearTimeout(t)
  }, [dirty, savedId, folderFocus, cfg, prompt, id, fileBroken])
  // Fechar o modal com rascunho novo (nunca salvo) ou mudanca que falhou ao salvar pergunta antes de descartar.
  const guardRef = useRef({ isNew: false, dirty: false, failed: false, broken: false })
  useEffect(() => {
    setRoutineEditGuard(() => {
      const g = guardRef.current
      return g.dirty && (g.isNew || g.failed || g.broken)
    })
    return () => setRoutineEditGuard(undefined)
  }, [])
  const pendingRef = useRef(false)
  pendingRef.current = dirty && !!savedId && !fileBroken && !fileGone // arquivo com valor invalido: fechar nao grava por cima
  useEffect(() => () => void (pendingRef.current && saveRef.current?.()), []) // fechou a aba antes do debounce

  // campos que o usuario ja mexeu: o aviso "invalido no arquivo" some deles
  const edited = useRef(new Set<string>())
  const up = (patch: Partial<RoutineConfig>): void => {
    for (const k of Object.keys(patch)) edited.current.add(k)
    if (patch.schedule) for (const k of Object.keys(patch.schedule)) edited.current.add(`schedule.${k}`)
    setCfg((c) => (c ? { ...c, ...patch } : c))
    touch()
    setMsg(undefined)
  }
  const upSched = (patch: Partial<RoutineConfig['schedule']>): void => up({ schedule: { ...cfg!.schedule, ...patch } })

  const preview = useMemo(() => (cfg ? scheduleSummary(cfg) : ''), [cfg])
  const shownPreview = fieldErr(msg, /cron/i) ? 'invalid cron' : preview
  // Cron valido mas impossivel (ex. 31 de fevereiro): nunca dispara.
  const cronNever = useMemo(() => {
    const expr = cfg?.schedule.cron?.trim()
    if (!expr) return false
    try {
      return new Cron(expr, { paused: true }).nextRun() === null
    } catch {
      return false
    }
  }, [cfg?.schedule.cron])
  const [mcpServers, setMcpServers] = useState<McpServerDef[]>([])
  useEffect(() => {
    // servidores mudaram no Settings com o editor aberto: lista, avisos de segredo e de sandbox acompanham
    const load = (): void => void window.turno.mcp.list().then(setMcpServers)
    load()
    window.addEventListener('turno:mcp-changed', load)
    return () => window.removeEventListener('turno:mcp-changed', load)
  }, [])
  if (!cfg) return <div className="panel-empty">Loading…</div>

  const isNew = !savedId
  // problema da pasta checado a cada tecla: valor igual ao salvo nunca e erro
  const folderNow = isNew && !idTouched ? slug(cfg.name) : id
  const folderProblem =
    folderNow === savedId ? undefined
    : !folderNow ? (isNew ? "Couldn't make a folder name from the routine name. Type one here." : 'Type a folder name for this routine.')
    : /^-/.test(folderNow) ? 'Start the folder name with a letter or number.'
    : folderNow.length > 63 ? 'Use at most 63 characters.'
    : !/^[a-z0-9][a-z0-9-]{0,62}$/.test(folderNow) ? 'Use only lowercase letters, numbers and hyphens (e.g. daily-summary).'
    : /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(folderNow) ? `"${folderNow}" is a name reserved by Windows. Pick a different one.`
    : routines.some((r) => r.id === folderNow) ? 'Another routine already uses this folder. Pick a different name.'
    : undefined
  // campo com erro no ROUTINE.md (o parse descartou so ele): avisa no proprio campo
  const fileErr = (key: string): boolean => !edited.current.has(key) && new RegExp(`(^|; )${key.replace('.', '\\.')}[.:]`).test(existing?.error ?? '')
  guardRef.current = { isNew, dirty, failed: msg?.tone === 'err', broken: fileBroken }
  const folder = isNew && !idTouched ? slug(cfg.name) : id

  async function save(): Promise<boolean> {
    const clash = folder !== savedId && routines.some((r) => r.id === folder)
    const badName = !/^[a-z0-9][a-z0-9-]{0,62}$/.test(folder) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(folder)
    // apagar o prompt inteiro de uma rotina existente nao vai para o disco (o arquivo perdia o texto em ~2 s)
    const emptyPrompt = !prompt.trim() ? 'prompt: the prompt is empty; write what the agent should do (not saved)' : undefined
    // pasta da rotina apagada/movida por fora: nao recria sozinho
    if (fileGone) {
      setMsg({ tone: 'err', text: "This routine's folder was deleted or moved outside Turno. Close the editor; nothing was saved." })
      return false
    }
    if (fileUnreadable) {
      setMsg({ tone: 'err', text: `ROUTINE.md can't be read (${existing!.error}). Fix the file (Folder button) — saving from here would replace every setting with defaults.` })
      return false
    }
    const local = [emptyPrompt, badName ? 'folder name: use only lowercase letters, numbers and hyphens' : clash ? 'folder: another routine already uses this folder' : undefined, localError(cfg!)].filter(Boolean).join('; ')
    if (local) {
      setMsg({ tone: 'err', text: local })
      return false
    }
    // nada mudou de fato (ex. pasta trocada e desfeita): nao regrava o arquivo
    if (savedId && folder === savedId && !existing?.error && knownContent.current === diskKey({ config: cfg!, prompt })) {
      setDirty(false)
      setMsg(undefined)
      setStatus('saved')
      return true
    }
    const at = rev.current
    setStatus('saving')
    try {
      lastSaveAt.current = Date.now()
      saving.current = true
      const r = await window.turno.routines
        .save({ id: folder, originalId: savedId ?? undefined, config: cfg!, prompt, expectContent: savedId ? knownContent.current : undefined })
        .finally(() => (saving.current = false))
      if (r) {
        ownKey.current = JSON.stringify([r.config, r.prompt, r.error ?? null])
        knownContent.current = diskKey(r)
      }
      if (savedId && savedId !== folder) void reloadRuns()
      setSavedId(folder)
      if (rev.current === at) setDirty(false) // mudou durante a gravacao: o proximo auto save pega
      api.setTitle(cfg!.name)
      setMsg(r?.error ? { tone: 'err', text: `Saved, but with an error: ${r.error}` } : undefined)
      setStatus('saved')
      return !r?.error
    } catch (e) {
      setStatus(undefined)
      const text = String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (/changed on disk/.test(text) && existing) {
        // outro editor gravou o arquivo: o disco vence (recarrega quando a lista atualizar, ou ja)
        setDirty(false)
        setMsg(undefined)
        void window.turno.routines.list().then((rs) => {
          const fresh = rs.find((x) => x.id === savedId)
          if (!fresh) return
          knownContent.current = diskKey(fresh)
          setCfg(fresh.config)
          setPrompt(fresh.prompt)
        })
        toast('ROUTINE.md changed on disk; the editor reloaded it (your unsaved edits here were dropped).', 'warn')
        return false
      }
      setMsg({ tone: 'err', text })
      return false
    }
  }
  saveRef.current = save

  async function remove(): Promise<void> {
    if (!savedId) return
    const ok = await askConfirm({ title: 'Delete routine', message: `Delete the routine "${cfg!.name}"? Its folder goes to the Recycle Bin; past runs stay in the history.` })
    if (!ok) return
    try {
      pendingRef.current = false // nao regravar no fechamento da aba
      setDirty(false)
      await window.turno.routines.delete(savedId)
      api.close()
      for (const pid of [`routine:${savedId}`, `session:${savedId}`]) dockApi()?.getPanel(pid)?.api.close()
      requestAnimationFrame(() => (!document.activeElement || document.activeElement === document.body) && window.dispatchEvent(new Event('turno:focus-active-panel')))
    } catch (e) {
      setMsg({ tone: 'err', text: String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  async function runNow(): Promise<void> {
    if (dirty && !(await save())) return
    setRunning(true)
    try {
      const runId = await window.turno.run.startRoutine(folder)
      if (runId) openRoutine(folder, cfg!.name)
      else setMsg({ tone: 'err', text: 'Did not run: see the reason in the history.' })
    } catch (e) {
      setMsg({ tone: 'err', text: String((e as Error).message) })
    } finally {
      setRunning(false)
    }
  }

  const toggleDay = (d: Weekday): void => {
    const days = cfg.schedule.days.includes(d) ? cfg.schedule.days.filter((x) => x !== d) : [...cfg.schedule.days, d]
    upSched({ days })
  }
  const addTime = (): void => {
    // hora pela metade (ex. "01:--"): o campo devolve vazio; avisa e limpa, senao os proximos digitos se juntam a ela
    if (!newTime) {
      if (timeInput.current?.validity.badInput) {
        toast('Type a full time (HH:MM).', 'warn')
        setTimeKey((k) => k + 1)
      }
      return
    }
    if (cfg.schedule.times.includes(newTime)) {
      toast(`${newTime} is already in the list.`, 'warn')
      setNewTime('')
      setTimeKey((k) => k + 1)
      return
    }
    upSched({ times: [...cfg.schedule.times, newTime].sort() })
    setNewTime('')
    setTimeKey((k) => k + 1) // remonta o campo: o cursor volta para as horas (senao a proxima hora caia nos minutos)
  }
  const conn = conns.find((c) => c.id === cfg.profile)
  const isClaude = conn ? conn.kind === 'claude' : true
  // conexao nao-Claude ignora estes campos, mas valor invalido neles ainda trava a rotina: mostra o card para corrigir
  const claudeOnlyErr = ['account_pool', 'mcp', 'strict_mcp', 'context_card'].some((k) => fileErr(k))
  // valores guardados nesses campos tambem mantem o card visivel (para ver e limpar), mesmo sem erro
  const claudeOnlySet = !!(cfg?.account_pool || cfg?.mcp?.length || cfg?.strict_mcp || cfg?.context_card)
  const showClaudeCard = isClaude || claudeOnlyErr || claudeOnlySet || cardSticky.current
  if (!isClaude && showClaudeCard) cardSticky.current = true
  const hasPolicy = (k: 'session_limit' | 'weekly_limit'): boolean => (cfg.abort ?? []).some((p) => p.kind === k)
  const togglePolicy = (k: 'session_limit' | 'weekly_limit'): void =>
    up({ abort: hasPolicy(k) ? (cfg.abort ?? []).filter((p) => p.kind !== k) : [...(cfg.abort ?? []), { kind: k }] })
  type NumericPolicyKind = 'cost_usd' | 'steps' | 'duration_min'
  // Custo: um controle so. O budget_usd antigo vale como limite de custo (o runner ja trata assim) e e
  // convertido ao mexer, para nao existirem dois valores e um deles ser ignorado.
  const getNumericPolicy = (k: NumericPolicyKind): number | undefined =>
    (cfg.abort ?? []).find((p): p is Extract<typeof p, { limit: number }> => p.kind === k)?.limit ?? (k === 'cost_usd' ? cfg.budget_usd : undefined)
  const setNumericPolicy = (k: NumericPolicyKind, limit: number | undefined): void =>
    up({
      abort: limit !== undefined
        ? [...(cfg.abort ?? []).filter((p) => p.kind !== k), { kind: k, limit }]
        : (cfg.abort ?? []).filter((p) => p.kind !== k),
      ...(k === 'cost_usd' ? { budget_usd: undefined } : {}),
    })
  // Conexao Claude (assinatura) nao tem custo por conversa: trocar para ela remove o limite de custo
  const pickConnection = (id: string): void => {
    const toClaude = conns.find((c) => c.id === id)?.kind === 'claude'
    up(toClaude ? { profile: id, budget_usd: undefined, abort: (cfg.abort ?? []).filter((p) => p.kind !== 'cost_usd') } : { profile: id })
  }

  return (
    <div className="editor">
      <header className="editor-head">
        <div className="editor-title">
          <input
            className="title-input"
            aria-invalid={!cfg.name.trim() ? true : undefined}
            aria-describedby={!cfg.name.trim() ? 'routine-name-err' : undefined}
            autoFocus={!savedId}
            onFocus={(e) => !savedId && !dirty && e.target.select()}
            value={cfg.name}
            onChange={(e) => up({ name: e.target.value })}
            placeholder="Routine name"
            aria-label="Routine name"
          />
          {!cfg.name.trim() && <small id="routine-name-err" className="tone-err">Give the routine a name.</small>}
          <div className="editor-sub">
            <span className={`pill ${cfg.enabled ? 'pill-on' : ''}`}>{cfg.enabled ? 'on' : 'off'}</span>
            <span className="muted">{shownPreview}</span>
            {existing?.nextRuns[0] && <span className="muted">· next {when(existing.nextRuns[0])}</span>}
            {!isNew && (fileGone ? <span className="tone-warn">· not saved (folder missing)</span> : fileUnreadable ? <span className="tone-warn">· file can't be read</span> : fileBroken && dirty ? <span className="tone-warn">· not saved ({fileUnreadable ? "file can't be read" : 'file has invalid values'})</span> : msg?.tone === 'err' && dirty ? <span className="tone-warn">· not saved</span> : folderFocus && dirty ? <span className="muted">· saves when you leave the folder field</span> : status === 'saving' || dirty ? <span className="muted">· saving…</span> : status === 'saved' && <span className="muted">· saved</span>)}
          </div>
        </div>
        <div className="editor-actions">
          {!isNew && (
            <>
              <button className="btn ghost" disabled={fileGone} onClick={() => openHistory(savedId ?? folder)} title="History for this routine">
                <IconHistory /> History
              </button>
              <button className="btn ghost" disabled={fileGone} onClick={() => void window.turno.routines.openFolder(savedId ?? folder)} title="Open folder">
                <IconFolder /> Folder
              </button>
              <button className="btn" onClick={() => void runNow()} disabled={!!existing?.error || running || fileGone} title={existing?.error ? `Fix the routine first: ${existing.error}` : undefined}>
                {running ? <span className="spinner sm" /> : <IconPlay />} Run now
              </button>
              <button className="btn danger" disabled={fileGone} onClick={() => void remove()} title="Delete routine (folder goes to the Recycle Bin)">
                Delete
              </button>
            </>
          )}
          {isNew && (
            <button
              className="btn primary"
              onClick={() => {
                setCreateTried(true)
                if (!cfg.name.trim()) return document.querySelector<HTMLElement>('.editor .title-input')?.focus() // primeiro campo com problema
                if (!prompt.trim()) {
                  setMsg({ tone: 'err', text: 'Write the prompt first: it is what the agent does on each run.' })
                  promptRef.current?.scrollIntoView({ block: 'center' })
                  return promptRef.current?.focus()
                }
                void save().then((ok) => {
                  if (ok) return void requestAnimationFrame(() => document.querySelector<HTMLElement>('.editor .title-input')?.focus())
                  // erro de campo (cron/fuso/pasta): abre o Advanced e leva ate o primeiro campo marcado
                  requestAnimationFrame(() => {
                    const bad = document.querySelector<HTMLElement>('.editor [aria-invalid="true"]')
                    bad?.closest('details')?.setAttribute('open', '')
                    bad?.scrollIntoView({ block: 'center' })
                    bad?.focus()
                  })
                })
              }}
            >
              Create routine
            </button>
          )}
        </div>
      </header>
      {fileGone && (
        <div className="banner banner-err" role="alert">This routine's folder was deleted or moved outside Turno. Nothing will be saved here; close the editor.</div>
      )}
      {fileUnreadable && (
        <div className="banner banner-err" role="alert">
          ROUTINE.md can't be read, so saving from here is disabled (the form may not match the file). Fix it with the Folder button above.
          <pre className="pre banner-pre">{existing!.error}</pre>
        </div>
      )}
      {/* aparece desde a abertura (nao so na 1a edicao): o formulario nao pula para baixo debaixo do mouse */}
      {fileBroken && !fileUnreadable && (
        <div className="banner banner-warn">
          ROUTINE.md has invalid values (marked below). Saving replaces them with the values shown here.{' '}
          <button className="link" onClick={() => (document.querySelector<HTMLElement>('.editor .title-input')?.focus(), setAcceptFix(true), touch() /* grava ja, mesmo sem edicao pendente */, setTimeout(() => {
            // sem campo marcado para onde ir, o foco sai do nome (a proxima tecla renomeava a rotina)
            const bad = document.querySelector<HTMLElement>('.editor [aria-invalid="true"]')
            const body = document.querySelector<HTMLElement>('.editor .editor-body')
            if (bad) bad.focus()
            else if (body && document.activeElement?.classList.contains('title-input')) (body.tabIndex = -1, body.focus({ preventScroll: true }))
          }, 900))}>Replace and save</button>
        </div>
      )}
      {((msg && !(msg.tone === 'err' && msg.text.split('; ').every((p) => /cron|time ?zone|^folder|^name/i.test(p)))) || (existing?.error && !fileUnreadable)) && !(fileUnreadable && msg?.text.startsWith("ROUTINE.md can't be read")) && (
        <div id="editor-msg" role={msg?.tone === 'err' ? 'alert' : undefined} className={`banner ${msg?.tone === 'ok' ? 'banner-ok' : 'banner-err'}`}>{msg?.text ?? `Error in ROUTINE.md: ${existing!.error}`}</div>
      )}

      <div className="editor-body settings-body">
        <div className="settings-col">
        <section className="card">
          <h3>General</h3>
          <div className="grid2 folder-row">
            <label className="field">
              <span>Folder</span>
              <input
                value={folder}
                onChange={(e) => {
                  setIdTouched(true)
                  setId(e.target.value)
                  touch()
                }}
                onFocus={() => setFolderFocus(true)}
                onBlur={() => setFolderFocus(false)}
                placeholder="daily-summary"
                spellCheck={false}
                aria-invalid={folderProblem && (idTouched || !isNew || createTried) ? true : undefined}
                aria-describedby={folderProblem && (idTouched || !isNew || createTried) ? 'ferr-folder' : undefined}
              />
              {folderProblem && (idTouched || !isNew || createTried) && <small id="ferr-folder" className="tone-warn">{folderProblem}</small>}
            </label>
            <label className="field toggle-field">
              <span>Enabled</span>
              <Switch checked={cfg.enabled} onChange={(v) => up({ enabled: v })} describedBy={fileErr('enabled') ? 'ferr-enabled' : undefined} />
            </label>
            {fileErr('enabled') && <small id="ferr-enabled" className="tone-err" style={{ gridColumn: '1 / -1' }}>ROUTINE.md had an invalid Enabled value; the routine was kept off.</small>}
          </div>
          <label className="field">
            <span>Description</span>
            <input value={cfg.description} onChange={(e) => up({ description: e.target.value })} placeholder="What this routine does" />
          </label>
        </section>

        <section className="card">
          <h3>Connection</h3>
          <div className="seg">
            {conns.map((c) => (
              <button key={c.id} className={cfg.profile === c.id ? 'on' : ''} aria-pressed={cfg.profile === c.id} onClick={() => pickConnection(c.id)}>
                {c.name} <small>{c.kind === 'claude' ? 'subscription' : 'endpoint'}</small>
              </button>
            ))}
          </div>
          <div className="stack">
            <label className="field">
              <span>Model</span>
              {isClaude ? (
                <ModelSelect value={cfg.model} onChange={(v) => up({ model: v })} />
              ) : (
                <>
                  <input value={conn?.model ?? ''} disabled />
                  <small className="muted">Set by the connection (Settings → Connections).</small>
                </>
              )}
            </label>
            <div className="field">
              <span>Effort</span>
              <div className="seg small" role="group" aria-label="Effort" aria-describedby={fileErr('effort') ? 'ferr-effort' : undefined}>
                {EFFORTS.map((e) => (
                  <button key={e} className={cfg.effort === e ? 'on' : ''} aria-pressed={cfg.effort === e} onClick={() => up({ effort: e })}>
                    {e}
                  </button>
                ))}
              </div>
              {fileErr('effort') && <small id="ferr-effort" className="tone-err">Invalid in ROUTINE.md; using the default.</small>}
            </div>
          </div>
        </section>

        <section className="card">
          <h3>Execution</h3>
          <div className="grid3">
            <label className="field">
              <span>Max time (min)</span>
              <NumInput integer min={1} max={10080} value={cfg.timeout_min} aria-invalid={fileErr('timeout_min') || undefined} aria-describedby={fileErr('timeout_min') ? 'ferr-timeout_min' : undefined} onChange={(v) => up({ timeout_min: v })} />
              {fileErr('timeout_min') && <small id="ferr-timeout_min" className="tone-warn">Invalid in ROUTINE.md; using the default.</small>}
            </label>
            <label className="field">
              <span>Stop if idle for (min)</span>
              <NumInput integer min={1} max={10080} value={cfg.idle_timeout_min} aria-invalid={fileErr('idle_timeout_min') || undefined} aria-describedby={fileErr('idle_timeout_min') ? 'ferr-idle_timeout_min' : undefined} onChange={(v) => up({ idle_timeout_min: v })} />
              {fileErr('idle_timeout_min') && <small id="ferr-idle_timeout_min" className="tone-warn">Invalid in ROUTINE.md; using the default.</small>}
            </label>
            <label className="field">
              <span>Notify</span>
              <select value={cfg.notify} onChange={(e) => up({ notify: e.target.value as RoutineConfig['notify'] })}>
                <option value="failures">failures only</option>
                <option value="always">always</option>
                <option value="never">never</option>
              </select>
              {fileErr('notify') && <small className="tone-warn">Invalid in ROUTINE.md; using the default.</small>}
            </label>
            <label className="field">
              <span>Extra locks</span>
              <ListInput separator="," value={cfg.locks} onChange={(v) => up({ locks: v })} placeholder="e.g. site-x" />
            </label>
            <label className="field">
              <span>If the lock is busy</span>
              <select value={cfg.lock_policy} onChange={(e) => up({ lock_policy: e.target.value as 'skip' | 'queue' })}>
                <option value="queue">wait (max 45 min)</option>
                <option value="skip">skip</option>
              </select>
              {fileErr('lock_policy') && <small className="tone-warn">Invalid in ROUTINE.md; using the default.</small>}
            </label>
            <label className="field">
              <span>Precheck (command; error = skip)</span>
              <input className="mono" value={cfg.precheck ?? ''} onChange={(e) => up({ precheck: e.target.value || undefined })} placeholder="python check.py" />
            </label>
          </div>
          <small className="muted">
            Automatic locks: <code>chrome</code> when using Chrome, <code>gpu</code> for Qwen. Two routines with the same lock never run at the same time.
          </small>
        </section>
        </div>

        <div className="settings-col">
        <section className="card">
          <h3>When it runs</h3>
          <div className="field">
            <span>Days{cfg.schedule.cron ? ' (ignored: cron set in Advanced)' : ''}</span>
            {fileErr('schedule.days') && <small className="tone-warn">ROUTINE.md has an invalid day (use sun, mon, tue, wed, thu, fri, sat). It was ignored.</small>}
            <div className={`days ${cfg.schedule.cron ? 'is-overridden' : ''}`}>
              {WEEKDAYS.map((d) => (
                <button
                  key={d}
                  className={`day ${cfg.schedule.days.includes(d) ? 'on' : ''}`}
                  onClick={() => toggleDay(d)}
                  title={DAY_TITLE[d]}
                  aria-pressed={cfg.schedule.days.includes(d)}
                >
                  {DAY_LABEL[d]}
                </button>
              ))}
              <span className="day-presets">
                <button className="link" onClick={() => upSched({ days: [...WEEKDAYS] })}>all</button>
                <button className="link" onClick={() => upSched({ days: ['mon', 'tue', 'wed', 'thu', 'fri'] })}>weekdays</button>
              </span>
            </div>
          </div>
          <div className="field">
            <span>Times{cfg.schedule.cron ? ' (ignored: cron set in Advanced)' : ''}</span>
            <div className={`times ${cfg.schedule.cron ? 'is-overridden' : ''}`}>
              {cfg.schedule.times.map((t) => (
                <span className="chip" key={t}>
                  {t}
                  <button aria-label={`remove ${t}`} onClick={() => (upSched({ times: cfg.schedule.times.filter((x) => x !== t) }), requestAnimationFrame(() => timeInput.current?.focus()))}>
                    <IconClose size={12} />
                  </button>
                </span>
              ))}
              <span className="time-add">
                <input ref={timeInput} key={timeKey} autoFocus={timeKey > 0} aria-label="New time" aria-invalid={/schedule\.times/.test(existing?.error ?? '') || undefined} aria-describedby={/schedule\.times/.test(existing?.error ?? '') ? 'ferr-times' : undefined} type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTime()} />
                <button className="btn small" onClick={addTime} disabled={!newTime || cfg.schedule.times.includes(newTime)} title={cfg.schedule.times.includes(newTime) ? 'This time is already in the list' : undefined}>
                  <IconPlus size={14} /> add
                </button>
              </span>
            </div>
            {/schedule\.times/.test(existing?.error ?? '') ? (
              <small id="ferr-times" className="tone-err">ROUTINE.md has an invalid time (use HH:MM, 24h). It was ignored: add the time again here.</small>
            ) : (
              !cfg.schedule.times.length && !cfg.schedule.cron && <small className="muted">No times: only runs via the "Run now" button.</small>
            )}
            {!cfg.schedule.days.length && !!cfg.schedule.times.length && !cfg.schedule.cron && <small className="tone-warn">No days selected: this routine never runs on schedule.</small>}
          </div>
          <details className="advanced" ref={advRef}>
            <summary>Advanced</summary>
            <div className="grid2">
              <label className="field">
                <span>Cron (overrides days/times)</span>
                <input value={cfg.schedule.cron ?? ''} aria-invalid={fieldErr(msg, /cron/i) || fileErr('schedule.cron') ? true : undefined} aria-describedby={fieldErr(msg, /cron/i) || fileErr('schedule.cron') ? 'ferr-cron' : undefined} onChange={(e) => upSched({ cron: e.target.value || undefined })} placeholder="15 9,12,15,18 * * *" />
                {fieldErr(msg, /cron/i) && <small id="ferr-cron" className="tone-warn">{fieldErr(msg, /cron/i)!.replace(/^.*?invalid cron: (CronPattern: )?/i, 'Invalid cron: ').replace(/\.?$/, '.')} Format: minute hour day month weekday.</small>}
                {cronNever && <small className="tone-warn">This cron never matches a date, so it never runs.</small>}
                {!fieldErr(msg, /cron/i) && fileErr('schedule.cron') && <small id="ferr-cron" className="tone-warn">ROUTINE.md has an invalid cron; it was removed here. Type a valid one or leave it empty to use days and times.</small>}
              </label>
              <label className="field">
                <span>Time zone</span>
                <input value={cfg.timezone} aria-invalid={fieldErr(msg, /time ?zone/i) || fileErr('timezone') ? true : undefined} aria-describedby={fieldErr(msg, /time ?zone/i) || fileErr('timezone') ? 'ferr-timezone' : undefined} onChange={(e) => up({ timezone: e.target.value })} />
                {fieldErr(msg, /time ?zone/i) && <small id="ferr-timezone" className="tone-warn">Unknown time zone. Use an IANA name like America/Sao_Paulo.</small>}
                {!fieldErr(msg, /time ?zone/i) && fileErr('timezone') && <small id="ferr-timezone" className="tone-warn">Invalid in ROUTINE.md; using the default.</small>}
              </label>
              <label className="field toggle-field">
                <span>Catch up on missed runs (PC off/asleep)</span>
                <Switch checked={cfg.catchup} onChange={(v) => up({ catchup: v })} />
              </label>
              {fileErr('catchup') && <small className="tone-warn" style={{ gridColumn: '1 / -1' }}>Catch-up was invalid in ROUTINE.md; using the default.</small>}
              <label className="field">
                <span>Catch-up window (hours)</span>
                <NumInput integer min={1} max={720} value={cfg.catchup_window_h} aria-invalid={fileErr('catchup_window_h') || undefined} aria-describedby={fileErr('catchup_window_h') ? 'ferr-catchup_window_h' : undefined} onChange={(v) => up({ catchup_window_h: v })} />
                {fileErr('catchup_window_h') && <small id="ferr-catchup_window_h" className="tone-warn">Invalid in ROUTINE.md; using the default.</small>}
              </label>
            </div>
          </details>
        </section>

        {showClaudeCard && (
          <section className="card">
            <h3>Accounts, MCP and context</h3>
            {!isClaude && (
              <small className="tone-warn">
                {claudeOnlyErr
                  ? "This connection doesn't use these settings, but ROUTINE.md has invalid values here: fix or clear them so the routine can run."
                  : "This connection doesn't use these settings: they are ignored. Clear them if you don't need them."}
              </small>
            )}
            <label className="field toggle-field">
              <span>Use the account ranking: run on the best Claude account and continue on the next one at the limit</span>
              <Switch checked={!!cfg.account_pool} onChange={(v) => up({ account_pool: v || undefined })} />
            </label>
            {fileErr('account_pool') && <small className="tone-warn">Invalid in ROUTINE.md (use true or false); kept off.</small>}
            {cfg.sandbox !== 'none' && (cfg.account_pool || mcpServers.some((m) => cfg.mcp?.includes(m.id))) && (
              <small className="tone-warn">This routine uses a sandbox ({cfg.sandbox}): the account ranking and MCP servers don't work there, so scheduled runs will be skipped. Turn the sandbox off in Limits & safety, or turn these off.</small>
            )}
            <fieldset className="field" id="routine-mcp" tabIndex={-1}>
              <legend>MCP servers for this routine</legend>
              {mcpServers.map((m) => (
                <label key={m.id} className="check-row">
                  <input type="checkbox" checked={(cfg.mcp ?? []).includes(m.id)} onChange={(e) => up({ mcp: e.target.checked ? [...(cfg.mcp ?? []), m.id] : (cfg.mcp ?? []).filter((x) => x !== m.id) })} />
                  <span>{m.name}</span>
                  <small className="muted mono">{m.url ?? m.command}</small>
                </label>
              ))}
              {mcpServers
                .filter((m) => (cfg.mcp ?? []).includes(m.id) && (m.secrets ?? []).some((n) => !m.secretSet?.[n]))
                .map((m) => (
                  <small key={`sec-${m.id}`} className="tone-warn">"{m.name}" has no value for its secret yet: scheduled runs will be skipped until you set it in Settings › MCP.</small>
                ))}
              {(cfg.mcp ?? []).filter((id) => !mcpServers.some((m) => m.id === id)).map((id) => (
                <small key={id} className="tone-warn">
                  A removed MCP server (id "{id}") is still listed in this routine: it is ignored.{' '}
                  <button
                    className="link"
                    onClick={() => {
                      up({ mcp: (cfg.mcp ?? []).filter((x) => x !== id) })
                      // o link some junto com o aviso: o foco fica no grupo de servidores, nao cai no body
                      setTimeout(() => document.getElementById('routine-mcp')?.focus())
                    }}
                  >
                    Remove it
                  </button>
                </small>
              ))}
              {!mcpServers.length && <small className="muted">No servers in Settings › MCP yet.</small>}
              {fileErr('mcp') && <small className="tone-warn">Invalid in ROUTINE.md (use a list of server ids); none selected.</small>}
            </fieldset>
            <label className="field toggle-field">
              <span>Only these servers (ignore your own MCP config and the repo's .mcp.json)</span>
              <Switch checked={!!cfg.strict_mcp} onChange={(v) => up({ strict_mcp: v || undefined })} />
            </label>
            {fileErr('strict_mcp') && <small className="tone-warn">Invalid in ROUTINE.md (use true or false); kept off.</small>}
            <label className="field">
              <span>Context card (5 to 15 lines the agent can't find out alone)</span>
              <textarea rows={4} maxLength={2000} value={cfg.context_card ?? ''} aria-invalid={fileErr('context_card') || undefined} onChange={(e) => up({ context_card: e.target.value || undefined })} placeholder={'This repo = Sentry project "api-web".\nNever push to main.'} />
              {fileErr('context_card') && <small className="tone-warn">Invalid in ROUTINE.md (use text, up to 2000 characters); left empty.</small>}
              {(cfg.context_card ?? '').trim().split(/\r?\n/).length > 15 && <small className="tone-warn">Only the first 15 lines are sent.</small>}
            </label>
          </section>
        )}

        <section className="card">
          <h3>Permissions</h3>
          {fileErr('permission_mode') && <small className="tone-warn">The permission mode in ROUTINE.md is invalid; showing the default. Pick one below.</small>}
          <div className="perm-grid">
            {PERMS.map((p) => (
              <button
                key={p.v}
                className={`perm ${cfg.permission_mode === p.v ? 'on' : ''} ${p.v === 'bypassPermissions' ? 'danger' : ''}`}
                aria-pressed={cfg.permission_mode === p.v}
                onClick={() => up({ permission_mode: p.v })}
              >
                <strong>{p.t}</strong>
                <span>{p.d}</span>
              </button>
            ))}
          </div>
          {cfg.permission_mode !== 'bypassPermissions' && (
            <label className="field">
              <span>Allowed tools (one per line)</span>
              <ListInput
                multiline
                separator={'\n'}
                rows={3}
                className="mono"
                value={cfg.allowed_tools}
                onChange={(v) => up({ allowed_tools: v })}
                placeholder={'Read\nBash(python tools/*)\nmcp__claude-in-chrome__*'}
              />
              {cfg.permission_mode === 'dontAsk' && !cfg.allowed_tools.length && (
                <small className="tone-warn">No tools allowed: the agent can only answer with text.</small>
              )}
            </label>
          )}
          <label className="field toggle-field">
            <span>Use Chrome (Claude in Chrome, signed-in session)</span>
            <Switch checked={cfg.chrome} onChange={(v) => up({ chrome: v })} />
          </label>
        </section>

        <section className="card">
          <h3>Limits &amp; safety</h3>
          <div className="grid2">
            <label className="field">
              <span>Isolation</span>
              <select value={cfg.isolation} onChange={(e) => up({ isolation: e.target.value as RoutineConfig['isolation'] })}>
                <option value="none">none</option>
                <option value="worktree">git worktree</option>
              </select>
              {cfg.isolation === 'worktree' && (
                <small className="muted">Runs in a dedicated git worktree (branch turno/…). Requires the working dir to be a git repo. An empty worktree is removed afterwards; if the run left changes or commits, the worktree and its branch are kept for you to review.</small>
              )}
            </label>
          </div>
          {isClaude && (
            <div className="field">
              <span>Pause when the subscription limit is hit (resumes after reset)</span>
              <div className="row">
                <label className="row small muted">
                  <Switch checked={hasPolicy('session_limit')} onChange={() => togglePolicy('session_limit')} /> 5h session
                </label>
                <label className="row small muted">
                  <Switch checked={hasPolicy('weekly_limit')} onChange={() => togglePolicy('weekly_limit')} /> weekly
                </label>
              </div>
            </div>
          )}
          <div className="field">
            <span>Abort conversation when it reaches</span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
              {(!isClaude || getNumericPolicy('cost_usd') !== undefined) && (
                <div className="row small muted" style={{ gap: 4 }}>
                  <Switch
                    label="Abort on cost"
                    checked={getNumericPolicy('cost_usd') !== undefined}
                    onChange={(v) => setNumericPolicy('cost_usd', v ? 1 : undefined)}
                  />
                  <NumInput
                    aria-label="Abort when the cost reaches (USD)"
                    step={0.5}
                    min={0.1}
                    value={getNumericPolicy('cost_usd')}
                    disabled={getNumericPolicy('cost_usd') === undefined}
                    style={{ width: 56 }}
                    onChange={(v) => setNumericPolicy('cost_usd', v)}
                  />
                  USD
                </div>
              )}
              <div className="row small muted" style={{ gap: 4 }}>
                <Switch
                  label="Abort on steps"
                  checked={getNumericPolicy('steps') !== undefined}
                  onChange={(v) => setNumericPolicy('steps', v ? 100 : undefined)}
                />
                <NumInput
                  aria-label="Abort after this many steps"
                  integer
                  min={1}
                  value={getNumericPolicy('steps')}
                  disabled={getNumericPolicy('steps') === undefined}
                  style={{ width: 64 }}
                  onChange={(v) => setNumericPolicy('steps', v)}
                />
                steps
              </div>
              <div className="row small muted" style={{ gap: 4 }}>
                <Switch
                  label="Abort on duration"
                  checked={getNumericPolicy('duration_min') !== undefined}
                  onChange={(v) => setNumericPolicy('duration_min', v ? 30 : undefined)}
                />
                <NumInput
                  aria-label="Abort after this many minutes"
                  integer
                  min={1}
                  value={getNumericPolicy('duration_min')}
                  disabled={getNumericPolicy('duration_min') === undefined}
                  style={{ width: 56 }}
                  onChange={(v) => setNumericPolicy('duration_min', v)}
                />
                min
              </div>
            </div>
          </div>
          <div className="grid2">
            <label className="field">
              <span>Sandbox (opt-in)</span>
              <select value={cfg.sandbox} onChange={(e) => up({ sandbox: e.target.value as RoutineConfig['sandbox'] })}>
                <option value="none">none (default)</option>
                <option value="docker">docker</option>
                <option value="wsl">wsl</option>
              </select>
              <small className="muted">docker/wsl need a sandbox image with the <code>claude</code> CLI installed.</small>
              {isClaude && cfg.sandbox !== 'none' && (cfg.account_pool || mcpServers.some((m) => cfg.mcp?.includes(m.id))) && (
                <small className="tone-warn">The account ranking and MCP servers don't work inside a sandbox: scheduled runs will be skipped until you turn one of them off.</small>
              )}
            </label>
            <label className="field">
              <span>Run on file change (path)</span>
              <input
                className="mono"
                value={cfg.triggers?.[0]?.path ?? ''}
                placeholder="src/ (relative to routine)"
                onChange={(e) => up({ triggers: e.target.value ? [{ kind: 'watch', path: e.target.value }] : undefined })}
              />
            </label>
          </div>
        </section>
        </div>

        <section className="card grow">
          <h3>Prompt</h3>
          <textarea
            aria-label="Prompt"
            ref={promptRef}
            aria-invalid={!prompt.trim() && (dirty || !!msg) ? true : undefined}
            aria-describedby={!prompt.trim() && (dirty || !!msg) ? 'editor-msg' : undefined}
            className="prompt mono"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              if (msg?.text.startsWith('Write the prompt first')) setMsg(undefined)
              touch()
            }}
            placeholder="What the agent should do on each run. Be explicit: nobody will be watching to answer questions."
          />
        </section>
      </div>
    </div>
  )
}

export function Switch({ checked, onChange, label, describedBy }: { checked: boolean; onChange: (v: boolean) => void; label?: string; describedBy?: string }) {
  // nome acessivel: o rotulo passado ou o texto do <label>/<span> ao lado (senao o leitor de tela so diz "switch")
  const nameFrom = (el: HTMLButtonElement | null): void => {
    if (!el || label || el.getAttribute('aria-label')) return
    const text = (el.closest('label')?.querySelector('span')?.textContent ?? el.nextSibling?.textContent ?? el.parentElement?.textContent ?? '').trim()
    if (text) el.setAttribute('aria-label', text)
  }
  return (
    <button ref={nameFrom} role="switch" aria-label={label} aria-describedby={describedBy} aria-invalid={describedBy ? true : undefined} aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  )
}
