// Catalogo de agentes CLI que o Turno sabe abrir, retomar e (quando possivel) isolar por conta.
// Comandos, aliases e argumentos de resume adaptados de um catalogo de terceiros sob licenca MIT (ver CREDITS.md).

export type PromptStyle =
  | 'argv' // `<cmd> "<prompt>"`
  | 'flag' // `<cmd> <promptFlag> "<prompt>"`
  | 'type' // abre o agente e digita o prompt depois que ele subir

export interface AgentDef {
  id: string
  name: string
  cmd: string // binario procurado no PATH
  aliases?: string[]
  launch?: string // comando para abrir (padrao: cmd)
  resume?: (sessionId: string) => string // comando que reabre uma sessao (sem o prompt)
  prompt: PromptStyle
  promptFlag?: string
  homeVar?: string // variavel de ambiente da pasta de config: permite varias contas isoladas
  homeDefault?: string // pasta padrao (relativa ao home do usuario)
  login?: string // comando de login oficial (rodado num terminal visivel, com a pasta da conta)
  usage: 'claude' | 'wall' // como o Turno sabe do limite: hooks/statusline (Claude) ou texto de erro na tela
  url?: string // onde instalar
  install?: string // comando de instalacao do CLI (rodado num terminal visivel); sem ele, o botao abre `url`
}

export const AGENTS: AgentDef[] = [
  { id: 'claude', name: 'Claude Code', cmd: 'claude', resume: (id) => `claude --resume ${id}`, prompt: 'argv', homeVar: 'CLAUDE_CONFIG_DIR', homeDefault: '.claude', login: 'claude auth login', usage: 'claude', url: 'https://docs.claude.com/en/docs/claude-code/setup', install: 'npm install -g @anthropic-ai/claude-code' },
  { id: 'codex', name: 'Codex', cmd: 'codex', resume: (id) => `codex resume ${id}`, prompt: 'argv', homeVar: 'CODEX_HOME', homeDefault: '.codex', login: 'codex login', usage: 'wall', url: 'https://github.com/openai/codex', install: 'npm install -g @openai/codex' },
  { id: 'gemini', name: 'Gemini', cmd: 'gemini', resume: (id) => `gemini --resume ${id}`, prompt: 'flag', promptFlag: '-i', homeVar: 'GEMINI_CLI_HOME', usage: 'wall', url: 'https://github.com/google-gemini/gemini-cli', install: 'npm install -g @google/gemini-cli' },
  { id: 'antigravity', name: 'Antigravity', cmd: 'agy', resume: (id) => `agy --conversation ${id}`, prompt: 'type', usage: 'wall', url: 'https://antigravity.google' },
  { id: 'copilot', name: 'GitHub Copilot', cmd: 'copilot', resume: (id) => `copilot --resume=${id}`, prompt: 'flag', promptFlag: '-i', homeVar: 'COPILOT_HOME', homeDefault: '.copilot', usage: 'wall', url: 'https://github.com/github/copilot-cli', install: 'npm install -g @github/copilot' },
  { id: 'kiro', name: 'Kiro', cmd: 'kiro-cli', launch: 'kiro-cli chat --tui', resume: (id) => `kiro-cli chat --tui --resume-id ${id}`, prompt: 'type', homeVar: 'KIRO_HOME', homeDefault: '.kiro', login: 'kiro-cli login', usage: 'wall', url: 'https://kiro.dev/cli' },
  { id: 'cursor', name: 'Cursor', cmd: 'cursor-agent', resume: (id) => `cursor-agent --resume ${id}`, prompt: 'argv', login: 'cursor-agent login', usage: 'wall', url: 'https://cursor.com/cli' },
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode', resume: (id) => `opencode --session ${id}`, prompt: 'flag', promptFlag: '--prompt', homeVar: 'XDG_DATA_HOME', login: 'opencode auth login', usage: 'wall', url: 'https://opencode.ai', install: 'npm install -g opencode-ai' },
  { id: 'opencode2', name: 'OpenCode 2', cmd: 'opencode2', launch: 'opencode2 --standalone', resume: (id) => `opencode2 --session ${id}`, prompt: 'flag', promptFlag: '--prompt', usage: 'wall' },
  { id: 'qwen-code', name: 'Qwen Code', cmd: 'qwen', resume: (id) => `qwen --resume ${id}`, prompt: 'flag', promptFlag: '-i', usage: 'wall', url: 'https://github.com/QwenLM/qwen-code' },
  { id: 'grok', name: 'Grok', cmd: 'grok', resume: (id) => `grok --resume ${id}`, prompt: 'argv', homeVar: 'GROK_HOME', homeDefault: '.grok', usage: 'wall', url: 'https://x.ai/cli' },
  { id: 'amp', name: 'Amp', cmd: 'amp', prompt: 'type', login: 'amp login', usage: 'wall', url: 'https://ampcode.com' },
  { id: 'droid', name: 'Droid', cmd: 'droid', resume: (id) => `droid --resume ${id}`, prompt: 'argv', usage: 'wall', url: 'https://factory.ai' },
  { id: 'devin', name: 'Devin', cmd: 'devin', resume: (id) => `devin --resume ${id}`, prompt: 'argv', usage: 'wall' },
  { id: 'kimi', name: 'Kimi', cmd: 'kimi', resume: (id) => `kimi --session ${id}`, prompt: 'argv', usage: 'wall' },
  { id: 'aug', name: 'Auggie', cmd: 'auggie', prompt: 'argv', usage: 'wall', url: 'https://www.augmentcode.com' },
  { id: 'aider', name: 'Aider', cmd: 'aider', prompt: 'type', usage: 'wall', url: 'https://aider.chat' },
  { id: 'goose', name: 'Goose', cmd: 'goose', prompt: 'type', usage: 'wall', url: 'https://block.github.io/goose' },
  { id: 'kilo', name: 'Kilocode', cmd: 'kilo', prompt: 'argv', usage: 'wall' },
  { id: 'cline', name: 'Cline', cmd: 'cline', prompt: 'argv', usage: 'wall' },
  { id: 'crush', name: 'Charm Crush', cmd: 'crush', prompt: 'type', usage: 'wall' },
  { id: 'continue', name: 'Continue', cmd: 'cn', prompt: 'argv', usage: 'wall' },
  { id: 'mistral-vibe', name: 'Mistral Vibe', cmd: 'vibe', prompt: 'argv', usage: 'wall' },
  { id: 'rovo', name: 'Rovo Dev', cmd: 'acli', launch: 'acli rovodev run', prompt: 'type', usage: 'wall' },
  { id: 'qoder', name: 'Qoder CLI', cmd: 'qodercli', resume: (id) => `qodercli --resume ${id}`, prompt: 'argv', usage: 'wall' },
  { id: 'qoder-cn', name: 'Qoder CLI China', cmd: 'qoderclicn', resume: (id) => `qoderclicn --resume ${id}`, prompt: 'argv', usage: 'wall' },
  { id: 'codebuddy', name: 'CodeBuddy', cmd: 'codebuddy', aliases: ['cbc'], resume: (id) => `codebuddy --resume ${id}`, prompt: 'argv', usage: 'wall' },
  { id: 'openclaude', name: 'OpenClaude', cmd: 'openclaude', prompt: 'argv', usage: 'wall' },
  { id: 'trae', name: 'Trae', cmd: 'traecli', prompt: 'argv', usage: 'wall' },
  { id: 'mimo-code', name: 'MiMo Code', cmd: 'mimo', resume: (id) => `mimo --session ${id}`, prompt: 'flag', promptFlag: '--prompt', usage: 'wall' },
  { id: 'pi', name: 'Pi', cmd: 'pi', prompt: 'argv', usage: 'wall' },
  { id: 'omp', name: 'OMP', cmd: 'omp', resume: (id) => `omp --resume ${id}`, prompt: 'argv', usage: 'wall' },
  { id: 'prime-agent', name: 'Prime Agent', cmd: 'prime-agent', prompt: 'type', usage: 'wall' },
  { id: 'autohand', name: 'Autohand Code', cmd: 'autohand', prompt: 'type', usage: 'wall' },
  { id: 'ante', name: 'Ante', cmd: 'ante', prompt: 'type', usage: 'wall' },
  { id: 'muse', name: 'Muse', cmd: 'muse', resume: (id) => `muse resume ${id}`, prompt: 'type', usage: 'wall' },
  { id: 'dsh', name: 'DeepSeek Harness', cmd: 'dsh-tui', launch: 'dsh-tui .', resume: (id) => `dsh-tui --resume ${id}`, prompt: 'type', usage: 'wall' },
  { id: 'zcode', name: 'ZCode', cmd: 'zcode', resume: (id) => `zcode --resume ${id}`, prompt: 'type', usage: 'wall' },
  { id: 'codebuff', name: 'Codebuff', cmd: 'codebuff', prompt: 'argv', usage: 'wall' },
  { id: 'freebuff', name: 'Freebuff', cmd: 'freebuff', prompt: 'argv', usage: 'wall' },
  { id: 'command-code', name: 'Command Code', cmd: 'command-code', prompt: 'type', usage: 'wall' },
  { id: 'hermes', name: 'Hermes', cmd: 'hermes', launch: 'hermes --tui', prompt: 'type', usage: 'wall' },
  { id: 'openclaw', name: 'OpenClaw', cmd: 'openclaw', prompt: 'type', usage: 'wall' },
  { id: 'jcode', name: 'Jcode', cmd: 'jcode', resume: (id) => `jcode --resume ${id}`, prompt: 'type', usage: 'wall' },
]

export const agentDef = (id: string): AgentDef | undefined => AGENTS.find((a) => a.id === id)

// Aspas para um argumento de linha de comando (pwsh, cmd e bash aceitam aspas duplas; aspas internas viram simples)
// O comando e DIGITADO no shell da aba (pwsh, bash ou cmd), entao dentro das aspas duplas nada pode ser interpretado:
// some com $ ` % ! (variaveis/subexpressoes/escapes nos tres shells), troca aspas duplas (inclusive as curvas, que o
// pwsh tambem aceita) por simples e evita barra invertida no fim (escaparia a aspa de fechamento).
export const quoteArg = (s: string): string => {
  const t = s
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["“”„‟]/g, "'")
    .replace(/[$`%!\u0000-\u001F\u007F]/g, '')
  return `"${t.endsWith('\\') ? `${t} ` : t}"`
}

// Comando para abrir o agente, opcionalmente retomando uma sessao e/ou ja com um primeiro prompt.
// Prompt no estilo 'type' nao vai no comando: quem abriu digita depois (retornado em `typeAfter`).
// "14:05" hoje; "Sun 14:05" em outro dia (limite semanal fica a dias) — ingles e 24h, como o resto do app
export function whenText(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'later' // data estragada no arquivo: nunca derruba a tela
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
}

// Hora em que uma conta no limite volta a ser usada: o Turno espera 1 min de folga depois do reset informado
// (arredonda para o minuto SEGUINTE: na hora mostrada a conta ja esta livre)
export const backText = (iso: string): string => (Number.isNaN(Date.parse(iso)) ? 'later' : whenText(new Date(Math.ceil((Date.parse(iso) + 60_000) / 60_000) * 60_000).toISOString()))

// Por que nenhuma conta serve agora — UM texto so para o botao Agent, a aba de Chat e o main (antes cada um dizia
// uma coisa). accounts: as contas do agente em questao (ou todas). '' = ha conta utilizavel.
export function unavailableText(
  accounts: Array<{ id: string; label: string; enabled: boolean }>,
  usage: Record<string, { state: string; until?: string; reason?: string } | undefined>,
  signedOut: string[],
  what = 'account',
): string {
  const on = accounts.filter((a) => a.enabled)
  if (!accounts.length) return `No ${what} found. Install the agent CLI or add an account in Settings › Agents & accounts.`
  if (!on.length) return `Every ${what} is turned off. Turn one on in Settings › Agents & accounts.`
  const signed = on.filter((a) => !signedOut.includes(a.id))
  if (!signed.length) {
    // a unica logada esta desligada: o caminho e ligar, nao entrar de novo
    const offSigned = accounts.find((a) => !a.enabled && !signedOut.includes(a.id))
    return offSigned ? `${offSigned.label} is turned off, and the other accounts are not signed in. Turn it on in Settings › Agents & accounts.` : `No ${what} is signed in yet. Use Sign in in Settings › Agents & accounts.`
  }
  const st = (id: string): string => usage[id]?.state ?? 'unknown'
  if (signed.some((a) => !['exhausted', 'blocked'].includes(st(a.id)))) return ''
  const back = signed.map((a) => usage[a.id]).filter((u) => u?.state === 'exhausted' && u.until).map((u) => u!.until!).sort()[0]
  const anyLimit = signed.some((a) => st(a.id) === 'exhausted')
  return [
    anyLimit ? `No ${what} is available right now${back ? `; the first one at its limit is back at ${backText(back)}` : ''}.` : '',
    ...signed.filter((a) => st(a.id) === 'blocked').map((a) => blockedText(a.label, usage[a.id]?.reason)),
    signed.length < on.length ? 'Accounts that are not signed in are skipped (Sign in in Settings › Agents & accounts).' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// Texto para conta bloqueada: login vencido pede novo login; problema de conta (plano, organizacao) so explica
export const blockedText = (label: string, reason?: string): string =>
  !reason || /^login expired/.test(reason)
    ? `${label} needs a new sign-in: use Sign in in Settings › Agents & accounts, then Check sign-in.`
    : `${label}: ${reason}.`

// nunca comeca com "-": o id vai solto na linha de comando e viraria uma opcao do CLI
export const SESSION_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/

export function agentCommand(a: AgentDef, opts: { resumeId?: string; prompt?: string; extraArgs?: string }): { command: string; typeAfter?: string } {
  // id de sessao vira texto do comando: fora do formato (letras, numeros, - e _) e ignorado em vez de ir para o shell
  const resumeId = opts.resumeId && SESSION_ID.test(opts.resumeId) ? opts.resumeId : undefined
  let cmd = resumeId && a.resume ? a.resume(resumeId) : a.launch ?? a.cmd
  if (opts.extraArgs) cmd += ` ${opts.extraArgs}`
  if (!opts.prompt) return { command: cmd }
  if (a.prompt === 'argv') return { command: `${cmd} ${quoteArg(opts.prompt)}` }
  if (a.prompt === 'flag' && a.promptFlag) return { command: `${cmd} ${a.promptFlag} ${quoteArg(opts.prompt)}` }
  return { command: cmd, typeAfter: opts.prompt }
}

// Texto de "bateu no limite" na tela de agentes sem hooks: frases fortes, nunca as que falam de contexto.
const WALL = [
  /usage limit (reached|exceeded)/i,
  /you(?:'|’)ve (hit|reached) your (usage |weekly |daily |monthly |session )?limit/i,
  /\bhit your (usage )?limit\b/i,
  /quota (exceeded|exhausted)/i,
  /RESOURCE_EXHAUSTED/,
  /rate limit(ed)? (reached|exceeded)\b.*(try again|resets?)/i,
  /out of (credits|requests)\b/i,
  /UsageLimitExceeded|user_weekly_rate_limited|FreeUsageLimitError|TerminalQuotaError/,
]
const NOT_WALL = /context window|max(imum)? tokens|context length|concurrent subagent|<html/i

// Linha que e conteudo (diff, grep, codigo, citacao), nao mensagem do CLI: nunca e a parede.
const CONTENT_LINE = /^\s*(\+|@@|>|\/\/|#\s|\d+\s*[:|]|\S+\.(ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php|md|json|ya?ml|txt|log)[:(])|\b(expect|isWallText|assert\w*|console\.\w+|print)\(|=>/

// Cabeca da mensagem (sem URL, icones, prefixos) ou undefined se a linha e conteudo e nao mensagem do CLI
function messageHead(line: string): string | undefined {
  // URLs saem antes do teste: a mensagem de limite do Codex traz links de upgrade/uso na mesma linha
  const t = line.replace(/https?:\/\/\S+/g, '').trim()
  if (!t || t.length > 400 || NOT_WALL.test(t) || CONTENT_LINE.test(t)) return undefined
  // a frase tem de vir logo no comeco da mensagem (depois de icones/"Error:"), como o CLI imprime
  return t.replace(/^[^A-Za-z[{]+/, '')
}
const early = (r: RegExp, head: string): boolean => {
  const m = r.exec(head)
  return !!m && m.index <= 60
}

export function isWallText(line: string): boolean {
  const head = messageHead(line)
  return !!head && WALL.some((r) => early(r, head))
}

// O que a parede diz: limite que volta sozinho no reset,
// credito pago que acabou, ou conta suspensa/desativada (nao adianta esperar nem trocar para a mesma conta).
export type WallKind = 'limit' | 'credits' | 'banned'
// so a redacao das mensagens dos CLIs ("your account…", "credits"): "insufficient balance" de um teste ou
// "402 Payment Required" de um log nao contam
const CREDITS = /\b(out of credits|insufficient credits|no credits (left|remaining)|credit balance (is )?too low|purchase more credits|add (more )?credits to continue)\b/i
const BANNED = /\byour (account|organization|org) (has been |was |is )?(suspended|disabled|deactivated|banned|terminated)\b/i
export function wallKind(line: string): WallKind | undefined {
  const head = messageHead(line)
  if (!head) return undefined
  if (early(BANNED, head)) return 'banned'
  if (early(CREDITS, head)) return 'credits'
  return WALL.some((r) => early(r, head)) ? 'limit' : undefined
}

// Horario de volta escrito na mensagem: "try again in 1h 20m", "resets in 45 minutes", "try again at 3:05 PM",
// "reset at 14:00". Sem horario reconhecivel = undefined (o chamador usa um padrao).
export function parseReset(text: string, now = Date.now()): string | undefined {
  const dur = /(?:try again|resets?|available( again)?|retry|wait)\s+(?:in|after|for)\s+((?:\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,]*(?:and\s+)?)+)/i.exec(text)
  if (dur) {
    let ms = 0
    for (const [, n, u] of dur[2].matchAll(/(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)) {
      const k = u.toLowerCase()[0]
      ms += Number(n) * (k === 'd' ? 86_400_000 : k === 'h' ? 3_600_000 : k === 'm' ? 60_000 : 1000)
    }
    if (ms > 0 && ms < 31 * 86_400_000) return new Date(now + ms).toISOString()
  }
  const at = /(?:try again|resets?|available( again)?|retry|until)\b[^\n]*?\b(?:at|after)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text)
  if (at && (at[3] || at[4])) {
    let h = Number(at[2]) % 24
    const m = Number(at[3] ?? 0)
    if (at[4]) h = (h % 12) + (at[4].toLowerCase() === 'pm' ? 12 : 0)
    if (h > 23 || m > 59) return undefined
    const d = new Date(now)
    d.setHours(h, m, 0, 0)
    if (d.getTime() <= now) d.setDate(d.getDate() + 1) // horario ja passou hoje: e amanha
    return d.toISOString()
  }
  return undefined
}

// Pasta onde um agente abre: a que a origem pediu (Tasks, pasta da barra lateral) vence; senao a pasta inicial de
// Settings › Agents (e do rodape); vazia = home do usuario (o pty cai nela, como antes).
export const agentStartCwd = (explicit?: string, startDir?: string): string | undefined => explicit || startDir?.trim() || undefined
// Nome curto da pasta inicial para o rodape ("home" quando nao ha uma)
export const startFolderLabel = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'home'
// Pastas recentes do popup do New agent: a ultima primeiro, sem repetir (barra final nao conta), no maximo 5
export function pushRecentDir(list: string[], dir: string): string[] {
  const norm = (p: string): string => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p)
  const d = norm(dir.trim())
  const rest = list.map(norm).filter((x) => x && x !== d)
  return (d ? [d, ...rest] : rest).slice(0, 5)
}
