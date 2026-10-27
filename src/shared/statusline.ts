// Rodape do Claude Code nas abas do Turno, no estilo do que existia no Orca: modelo + esforco + conta, e as barras de
// 5h/7d da assinatura com o tempo ate o reset, numa moldura ╭│╰. Desenhado pelo proprio Turno (nao depende de script
// nem de outro app na maquina). Cores 256 (38;5;N): temas nao remapeiam, fica igual em qualquer tema.
const C = { model: 252, sep: 240, label: 245, pct: 252, meta: 243, track: 238, ok: 108, warn: 179, hot: 173, acct: 173, effLow: 245, effMid: 179, effHigh: 173, pillFg: 16 }
const fg = (n: number): string => `\x1b[38;5;${n}m`
const X = '\x1b[0m'
const BOLD = '\x1b[1m'
const WIDTH = 14

// texto vindo de fora (nome do modelo de um provedor, nome da conta): sem caracteres de controle (ESC, OSC, quebra de
// linha) e curto, para nao virar comando de terminal nem quebrar a moldura
// eslint-disable-next-line no-control-regex
const clean = (v: unknown, max = 40): string => String(v ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, max)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

// faixa de uso: calma abaixo de 70, morna 70-89, quente 90+
const band = (p: number): string => fg(p >= 90 ? C.hot : p >= 70 ? C.warn : C.ok)

function bar(p: number): string {
  const n = Math.max(0, Math.min(WIDTH, Math.floor((p * WIDTH) / 100)))
  return `${band(p)}${'━'.repeat(n)}${fg(C.track)}${'━'.repeat(WIDTH - n)}${X}`
}

// tempo ate o reset: 2h39m ou 5d17h ("?" sem horario). Mesma conta do resto do app (agentStore timeLeft): minutos
// para cima e "now" quando ja passou, para o rodape e a barra de status nunca divergirem
function resetIn(epochSec: number | undefined, now: number): string {
  if (!epochSec) return '?'
  const sec = epochSec > 1e11 ? epochSec / 1000 : epochSec // o Claude manda segundos; milissegundos tambem funcionam
  const min = Math.ceil((sec * 1000 - now) / 60_000)
  if (!Number.isFinite(min) || min <= 0) return 'now'
  const two = (v: number): string => String(v).padStart(2, '0')
  const h = Math.floor(min / 60)
  return h >= 24 ? `${Math.floor(min / 1440)}d${two(Math.floor((min % 1440) / 60))}h` : `${h}h${two(min % 60)}m`
}

// o esforco e o unico ajuste que custa dinheiro: e a unica pilula preenchida, e esquenta conforme sobe
function effortPill(level: string): string {
  const fill = level === 'MAX' || level === 'XHIGH' ? C.effHigh : level === 'HIGH' ? C.effMid : C.effLow
  return `\x1b[48;5;${fill}m${fg(C.pillFg)}${BOLD} ${level} ${X}`
}

function windowRow(label: string, w: Record<string, unknown>, now: number): string | undefined {
  const raw = num(w.used_percentage) ?? num(w.utilization)
  if (raw === undefined) return undefined
  // mesmo arredondamento do resto do app (o uso gravado para a troca de conta e Math.round): o rodape nao diverge
  const p = Math.max(0, Math.min(100, Math.round(raw)))
  return `${fg(C.label)}${label}${X}   ${bar(p)}   ${fg(C.pct)}${BOLD}${String(p).padStart(3)}%${X}   ${fg(C.meta)}↺ ${resetIn(num(w.resets_at), now)}${X}`
}

// p = JSON que o Claude Code manda ao statusline; account = nome curto da conta (ou da conexao de API)
export function renderStatusline(p: Record<string, unknown>, account: string, now: number = Date.now()): string {
  const rows: string[] = []
  // "Opus 5 (1M context)" -> "Opus 5 1M"; nome longo e cortado ANTES do sufixo, que fica sempre visivel
  const rawModel = String(obj(p.model).display_name ?? '')
  const ctx = /\(([0-9]+[MK]) context\)/.exec(rawModel)?.[1]
  const base = clean(rawModel.replace(/\(([0-9]+[MK]) context\)/, ''), ctx ? 40 - ctx.length - 1 : 40)
  const model = [base, ctx].filter(Boolean).join(' ')
  const effort = clean(obj(p.effort).level, 10).toUpperCase()
  account = clean(account)
  if (model) {
    let row = `${fg(C.model)}${BOLD}${model}${X}`
    if (effort) row += `  ${effortPill(effort)}`
    if (account) row += `  ${fg(C.sep)}·${X}  ${fg(C.acct)}${BOLD}${account}${X}`
    rows.push(row)
  } else if (account) rows.push(`${fg(C.acct)}${BOLD}${account}${X}`) // sem nome de modelo ainda: a conta continua visivel
  const rl = obj(p.rate_limits)
  for (const [label, key] of [['5h', 'five_hour'], ['7d', 'seven_day']] as const) {
    const r = windowRow(label, obj(rl[key]), now)
    if (r) rows.push(r)
  }
  if (!rows.length) return ''
  // ╭ no topo, ╰ na ultima, │ no meio; uma linha so = regua simples
  const glyph = (i: number): string => (rows.length === 1 ? '▏' : i === 0 ? '╭' : i === rows.length - 1 ? '╰' : '│')
  return rows.map((r, i) => `${fg(C.sep)}${glyph(i)}${X} ${r}`).join('\n') + '\n\n'
}
