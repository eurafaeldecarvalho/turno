import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Agent, fetch as ufetch } from 'undici'
import type { Connection } from '../shared/types'
import { shouldFallback, isBackendFaultMessage, isLimitLike, type Backend } from '../shared/routing'

// modelo local lento (CPU) pode levar minutos ate o primeiro pedaco: sem os tetos de 5 min do fetch padrao.
// O agente ja tem o proprio limite (API_TIMEOUT_MS de 30 min) e o Esc cancela pelo AbortController.
const slowOk = new Agent({ headersTimeout: 30 * 60_000, bodyTimeout: 30 * 60_000 })

// Tradutor local Anthropic Messages -> OpenAI Chat Completions.
// O Claude Code so fala o formato da Anthropic; a maioria dos provedores do catalogo (Groq, OpenRouter, Mistral,
// LM Studio, vLLM...) fala o da OpenAI. A conexao com via='translate' aponta o CLI para http://127.0.0.1:<porta>/c/<id>
// e este servidor repassa ao provedor real, com a chave do cofre (a chave nunca vai para o processo do agente).
// Ideia e mapeamento de campos de um tradutor de terceiros sob licenca MIT (ver CREDITS.md); codigo proprio.

type Json = Record<string, any>

// ---------- pedido: Anthropic -> OpenAI ----------
const textOf = (c: unknown): string =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((b: Json) => (b?.type === 'text' ? String(b.text ?? '') : '')).filter(Boolean).join('\n')
      : ''

function partOf(b: Json): Json | undefined {
  if (b.type === 'text') return { type: 'text', text: String(b.text ?? '') }
  if (b.type === 'image' && b.source?.type === 'base64') return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
  if (b.type === 'image' && b.source?.type === 'url') return { type: 'image_url', image_url: { url: String(b.source.url) } }
  return undefined // thinking, redacted_thinking, documentos etc.: o provedor OpenAI nao entende
}

export function toOpenAI(body: Json, model?: string): Json {
  const messages: Json[] = []
  const sys = textOf(body.system)
  if (sys) messages.push({ role: 'system', content: sys })
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    const blocks: Json[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : []
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('')
      const calls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: String(b.id), type: 'function', function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } }))
      const out: Json = { role: 'assistant', content: text || (calls.length ? null : '') }
      if (calls.length) out.tool_calls = calls
      messages.push(out)
      continue
    }
    // usuario: resultados de ferramenta viram mensagens 'tool' logo depois da chamada; o resto vira a mensagem do usuario
    for (const b of blocks.filter((x) => x.type === 'tool_result')) {
      const content = typeof b.content === 'string' ? b.content : textOf(b.content)
      messages.push({ role: 'tool', tool_call_id: String(b.tool_use_id), content: (b.is_error ? 'Error: ' : '') + (content || '(empty)') })
    }
    const parts = blocks.filter((x) => x.type !== 'tool_result').map(partOf).filter((p): p is Json => !!p)
    if (!parts.length) continue
    messages.push({ role: 'user', content: parts.every((p) => p.type === 'text') ? parts.map((p) => p.text).join('\n') : parts })
  }
  const out: Json = { model: model || body.model, messages }
  if (typeof body.max_tokens === 'number') out.max_tokens = body.max_tokens
  if (typeof body.temperature === 'number') out.temperature = body.temperature
  if (typeof body.top_p === 'number') out.top_p = body.top_p
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) out.stop = body.stop_sequences.slice(0, 4)
  if (Array.isArray(body.tools) && body.tools.length) {
    // ferramentas "server" da Anthropic (web_search etc.) nao existem do outro lado: so as com schema
    const tools = body.tools.filter((t: Json) => t?.name && t.input_schema)
    if (tools.length) out.tools = tools.map((t: Json) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema } }))
    const tc = body.tool_choice
    if (tools.length && tc) out.tool_choice = tc.type === 'any' ? 'required' : tc.type === 'tool' ? { type: 'function', function: { name: tc.name } } : tc.type === 'none' ? 'none' : 'auto'
  }
  if (body.stream) {
    out.stream = true
    out.stream_options = { include_usage: true }
  }
  return out
}

// ---------- resposta: OpenAI -> Anthropic ----------
const STOP: Record<string, string> = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', function_call: 'tool_use', content_filter: 'end_turn' }
const parseArgs = (s: unknown): Json => {
  if (typeof s !== 'string' || !s.trim()) return {}
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v }
  } catch {
    return { _raw: s } // argumento quebrado do modelo: entrega cru em vez de derrubar a resposta
  }
}

export function toAnthropic(r: Json, model: string): Json {
  const ch = r.choices?.[0] ?? {}
  const msg = ch.message ?? {}
  const content: Json[] = []
  const text = typeof msg.content === 'string' ? msg.content : textOf(msg.content)
  if (text) content.push({ type: 'text', text })
  for (const c of msg.tool_calls ?? []) content.push({ type: 'tool_use', id: c.id || `toolu_${randomUUID().replace(/-/g, '')}`, name: c.function?.name ?? '', input: parseArgs(c.function?.arguments) })
  return {
    id: `msg_${String(r.id ?? randomUUID()).replace(/[^A-Za-z0-9_]/g, '')}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: STOP[ch.finish_reason] ?? (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
    stop_sequence: null,
    usage: { input_tokens: r.usage?.prompt_tokens ?? 0, output_tokens: r.usage?.completion_tokens ?? 0 },
  }
}

// Conversor de stream: recebe os "data:" do SSE da OpenAI e devolve os eventos SSE da Anthropic.
export function streamConverter(model: string): { push: (chunk: Json) => string; end: () => string; fail: (message: string, status?: number) => string } {
  let started = false
  let ended = false
  let idx = -1 // indice do bloco aberto (Anthropic)
  let open: 'text' | 'tool' | undefined
  const toolBlock = new Map<number, number>() // indice da tool_call (OpenAI) -> indice do bloco (Anthropic)
  const idBlock = new Map<string, number>() // id da tool_call -> indice do bloco
  let lastTool: number | undefined
  let sawTool = false // qualquer bloco de ferramenta aberto (por id, index ou nenhum): decide o stop_reason no fim
  let stop: string | undefined
  let usage = { input_tokens: 0, output_tokens: 0 }
  const ev = (type: string, data: Json): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const start = (): string => {
    if (started) return ''
    started = true
    return ev('message_start', { message: { id: `msg_${randomUUID().replace(/-/g, '')}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })
  }
  const close = (): string => {
    if (!open) return ''
    open = undefined
    return ev('content_block_stop', { index: idx })
  }
  // erro do provedor no meio do stream (OpenRouter manda {"error":...} depois do 200): vira o evento de erro da Anthropic
  let failed = false
  const fail = (message: string, status = 500): string => {
    if (ended || failed) return ''
    failed = true
    ended = true
    return start() + close() + `event: error\ndata: ${JSON.stringify(anthropicError(status, message))}\n\n`
  }
  const push = (c: Json): string => {
    if (ended) return '' // ja terminou (erro): o resto do stream e descartado
    if (c.error) return fail(String(c.error.message ?? c.error), typeof c.error.code === 'number' ? c.error.code : 500)
    if (c.choices?.[0]?.finish_reason === 'error') return fail('the provider ended the answer with an error')
    let out = start()
    if (c.usage) usage = { input_tokens: c.usage.prompt_tokens ?? usage.input_tokens, output_tokens: c.usage.completion_tokens ?? usage.output_tokens }
    const ch = c.choices?.[0]
    if (!ch) return out
    const d = ch.delta ?? {}
    if (typeof d.content === 'string' && d.content) {
      if (open !== 'text') {
        out += close()
        idx++
        open = 'text'
        out += ev('content_block_start', { index: idx, content_block: { type: 'text', text: '' } })
      }
      out += ev('content_block_delta', { index: idx, delta: { type: 'text_delta', text: d.content } })
    }
    for (const t of d.tool_calls ?? []) {
      // bloco da chamada: pelo id (alguns provedores mandam cada chamada inteira sem "index") ou pelo index;
      // id novo = chamada nova, mesmo que o index se repita (senao duas chamadas viravam um JSON so)
      // sem id nem index: um pedaco com function.name e uma chamada NOVA; sem name e a continuacao da ultima
      let bi = t.id ? idBlock.get(t.id) : typeof t.index === 'number' ? toolBlock.get(t.index) : t.function?.name ? undefined : lastTool
      if (bi === undefined) {
        out += close()
        idx++
        open = 'tool'
        bi = idx
        sawTool = true
        if (typeof t.index === 'number') toolBlock.set(t.index, idx)
        if (t.id) idBlock.set(t.id, idx)
        out += ev('content_block_start', { index: idx, content_block: { type: 'tool_use', id: t.id || `toolu_${randomUUID().replace(/-/g, '')}`, name: t.function?.name ?? '', input: {} } })
      }
      lastTool = bi
      const args = t.function?.arguments
      if (typeof args === 'string' && args) out += ev('content_block_delta', { index: bi, delta: { type: 'input_json_delta', partial_json: args } })
    }
    if (ch.finish_reason) stop = STOP[ch.finish_reason] ?? 'end_turn'
    return out
  }
  const end = (): string => {
    if (ended) return ''
    ended = true
    let out = start() + close()
    out += ev('message_delta', { delta: { stop_reason: stop ?? (sawTool ? 'tool_use' : 'end_turn'), stop_sequence: null }, usage: { output_tokens: usage.output_tokens, input_tokens: usage.input_tokens } })
    out += ev('message_stop', {})
    return out
  }
  return { push, end, fail }
}

// Erro do provedor no formato que o Claude Code entende (429 vira rate_limit_error, que ele trata como limite)
export function anthropicError(status: number, message: string): Json {
  const type = status === 429 ? 'rate_limit_error' : status === 401 || status === 403 ? 'authentication_error' : status === 400 || status === 404 || status === 422 ? 'invalid_request_error' : status === 529 ? 'overloaded_error' : 'api_error'
  return { type: 'error', error: { type, message } }
}

// ---------- servidor ----------
let port = 0
let token = ''
let lookup: (id: string) => { conn: Connection; key?: string } | undefined = () => undefined
let ready: Promise<void> | undefined

export const translatorInfo = (): { port: number; token: string } => ({ port, token })
export const translatorBase = (connId: string): string => (port ? `http://127.0.0.1:${port}/c/${encodeURIComponent(connId)}` : '')

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((res, rej) => {
    let n = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      n += c.length
      if (n > 64 * 1024 * 1024) req.destroy(new Error('body too large'))
      else chunks.push(c)
    })
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rej)
  })

const sendJson = (res: ServerResponse, status: number, body: Json): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// Teto da RESPOSTA do provedor (o pedido ja tem teto em readBody). Um provedor hostil ou quebrado nao
// derruba o processo principal mandando um corpo gigante ou uma linha SSE sem fim.
const MAX_RESP = 64 * 1024 * 1024
async function readCapped(r: Response, max: number): Promise<string> {
  const reader = r.body?.getReader()
  if (!reader) return ''
  const dec = new TextDecoder()
  let out = ''
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.byteLength
    if (n > max) {
      try {
        await reader.cancel()
      } catch {
        /* ja fechado */
      }
      throw new Error('provider response too large')
    }
    out += dec.decode(value, { stream: true })
  }
  return out + dec.decode()
}

// Comparacao do token em tempo constante (o token tem 192 bits e e loopback, mas o custo e zero)
const safeEq = (a: string, b: string): boolean => {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function startTranslator(find: (id: string) => { conn: Connection; key?: string } | undefined): Promise<void> {
  lookup = find
  if (ready) return ready
  token = randomBytes(24).toString('hex')
  const server = createServer((req, res) =>
    void handle(req, res).catch((e) => {
      if (!res.headersSent) return sendJson(res, 502, anthropicError(502, String((e as Error).message)))
      // stream ja comecou: termina com o evento de erro em vez de deixar a conexao pendurada
      try {
        res.end(`event: error\ndata: ${JSON.stringify(anthropicError(502, String((e as Error).message)))}\n\n`)
      } catch {
        res.destroy()
      }
    }),
  )
  ready = new Promise((res) => server.listen(0, '127.0.0.1', () => ((port = (server.address() as { port: number }).port), res())))
  return ready
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // so quem tem o token da sessao (o agente que o Turno abriu) usa o tradutor; navegador nao manda esse header
  const auth = String(req.headers['x-api-key'] ?? '') || String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!token || !safeEq(auth, token)) return sendJson(res, 401, anthropicError(401, 'invalid Turno translator token'))
  // /route: um endpoint so que escolhe o melhor backend por request e cai pro proximo no erro (switch + contexto)
  const rm = /^\/route(\/v1\/messages(?:\/count_tokens)?)\/?(?:\?.*)?$/.exec(req.url ?? '')
  if (rm) return req.method === 'POST' ? handleRoute(req, res, rm[1].endsWith('count_tokens')) : void sendJson(res, 404, anthropicError(404, 'not found'))
  const m = /^\/c\/([^/]+)(\/v1\/messages(?:\/count_tokens)?)\/?(?:\?.*)?$/.exec(req.url ?? '')
  if (!m || req.method !== 'POST') return sendJson(res, 404, anthropicError(404, 'not found'))
  const found = lookup(decodeURIComponent(m[1]))
  if (!found || found.conn.kind !== 'endpoint' || !found.conn.baseUrl) return sendJson(res, 404, anthropicError(404, 'unknown connection'))
  let body: Json
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return sendJson(res, 400, anthropicError(400, 'invalid JSON'))
  }
  // contagem de tokens: estimativa (o provedor OpenAI nao tem esse endpoint); o CLI usa so para o medidor de contexto
  if (m[2].endsWith('count_tokens')) return sendJson(res, 200, { input_tokens: Math.ceil(JSON.stringify(body.messages ?? []).length / 4 + textOf(body.system).length / 4) })
  const model = found.conn.model || String(body.model ?? '')
  const upstream = `${found.conn.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const ac = new AbortController()
  res.on('close', () => !res.writableEnded && ac.abort()) // Esc no agente: corta o pedido ao provedor
  const send = (payload: Json): Promise<Response> =>
    ufetch(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(found.key ? { authorization: `Bearer ${found.key}` } : {}) },
      body: JSON.stringify(payload),
      signal: ac.signal,
      dispatcher: slowOk,
    }) as unknown as Promise<Response>
  const payload = toOpenAI(body, model)
  let r = await send(payload)
  // limite de saida: modelos de raciocinio da OpenAI so aceitam max_completion_tokens, e varios provedores recusam o
  // valor alto que o Claude Code manda. Recusou por causa do campo: tenta de novo com o nome novo, depois sem ele.
  if (r.status === 400 && typeof payload.max_tokens === 'number') {
    const t = await readCapped(r.clone(), 1 << 20).catch(() => '')
    if (/max_(completion_)?tokens/i.test(t)) {
      const { max_tokens, ...rest } = payload
      r = /max_completion_tokens/i.test(t) && !/max_completion_tokens.*(exceed|too large|greater|maximum)/i.test(t) ? await send({ ...rest, max_completion_tokens: max_tokens }) : await send(rest)
    }
  }
  if (!r.ok) {
    const t = await readCapped(r, 1 << 20).catch(() => '')
    let msg = t.slice(0, 2000)
    try {
      const j = JSON.parse(t)
      msg = String(j.error?.message ?? j.message ?? msg)
    } catch {
      /* texto cru */
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const ra = r.headers.get('retry-after')
    if (ra) headers['retry-after'] = ra
    res.writeHead(r.status, headers)
    return void res.end(JSON.stringify(anthropicError(r.status, msg || `provider returned ${r.status}`)))
  }
  if (!body.stream) return sendJson(res, 200, toAnthropic(JSON.parse(await readCapped(r, MAX_RESP)) as Json, model))
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const conv = streamConverter(model)
  const reader = r.body?.getReader()
  const dec = new TextDecoder()
  let buf = ''
  // provedor caiu no meio da resposta: fecha o stream com erro (senao o agente esperaria o timeout de 30 min)
  const read = async (): Promise<ReadableStreamReadResult<Uint8Array> | undefined> => {
    try {
      return await reader!.read()
    } catch (e) {
      res.end(conv.fail(`the provider connection dropped: ${(e as Error).message}`, 502))
      return undefined
    }
  }
  let total = 0
  while (reader) {
    const r2 = await read()
    if (!r2) return
    const { done, value } = r2
    if (done) break
    total += value.byteLength
    if (total > MAX_RESP) {
      ac.abort()
      return void res.end(conv.fail('provider response too large', 502))
    }
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        res.write(conv.push(JSON.parse(data)))
      } catch {
        /* linha que nao e JSON (keep-alive de alguns provedores) */
      }
    }
  }
  buf += dec.decode() // esvazia bytes multibyte pendentes do decoder (o loop usa stream:true), senao a cauda sem \n viria truncada
  // ultima linha "data:" sem \n no fim (alguns provedores nao terminam com newline): processa antes de fechar
  const tail = buf.trim()
  if (tail.startsWith('data:')) {
    const data = tail.slice(5).trim()
    if (data && data !== '[DONE]') {
      try {
        res.write(conv.push(JSON.parse(data)))
      } catch {
        /* idem: ignora linha nao-JSON */
      }
    }
  }
  res.end(conv.end())
}

// ---- /route: proxy de roteamento (um endpoint, varios backends, fallback mantendo o contexto) ----
// O main injeta, por request, o plano de backends (ordenado melhor->pior), de onde vem a credencial de cada um, e como
// marcar uma conta que falhou. Codigo novo que REUSA as primitivas testadas (toOpenAI/toAnthropic/streamConverter) e
// NAO toca no caminho /c que ja funciona.
export interface RouterPlan {
  plan: Backend[]
  credOf: (b: Backend) => string | undefined // setup-token (assinatura) ou chave da conexao
  anthropicUrl?: string // base da assinatura (default api.anthropic.com)
  version?: string
  // marca a conta que bateu LIMITE (so limite; auth/transitorio NAO persiste — um 401/403 pontual nao deve bloquear a
  // conta para sempre). retryAfterMs = quanto segurar, se o provedor informou (senao o chamador usa um default curto).
  mark?: (accountId: string, retryAfterMs?: number) => void
}
let routerFn: (() => RouterPlan) | undefined
export function setRouter(fn: () => RouterPlan): void {
  routerFn = fn
}
export const routeBase = (): string => (port ? `http://127.0.0.1:${port}/route` : '')

type Fault = { status: number; message: string; retryAfter?: number }
type Tried = { ok: true; r: Response } | ({ ok: false } & Fault)

// Retry-After do provedor -> ms (segundos ou data HTTP). Para a janela do mark ser a que o provedor pediu.
const RETRY_CAP_MS = 24 * 60 * 60 * 1000 // teto: um Retry-After absurdo nao pode estourar o Date nem segurar a conta por anos
function retryAfterMs(r: Response): number | undefined {
  const h = r.headers.get('retry-after')
  if (!h) return undefined
  const s = Number(h)
  if (Number.isFinite(s)) return Math.min(Math.max(0, s * 1000), RETRY_CAP_MS)
  const d = Date.parse(h)
  return Number.isFinite(d) ? Math.min(Math.max(0, d - Date.now()), RETRY_CAP_MS) : undefined
}

const jsonErrMsg = (j: Json): string => {
  const e = j?.error as Json
  return String((e && typeof e === 'object' ? e.message : e) ?? j?.message ?? 'provider error')
}

async function readErr(r: Response): Promise<string> {
  const t = await readCapped(r, 1 << 20).catch(() => '')
  try {
    return jsonErrMsg(JSON.parse(t) as Json)
  } catch {
    return t.slice(0, 2000) || `provider returned ${r.status}`
  }
}

// Forward OpenAI-compat (mesma logica do /c: tradutor + retry de max_tokens), sem escrever no res (o chamador decide).
async function tryOpenAI(url: string, model: string, body: Json, key: string | undefined, ac: AbortController): Promise<Tried> {
  const send = (payload: Json): Promise<Response> =>
    ufetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(payload), signal: ac.signal, dispatcher: slowOk }) as unknown as Promise<Response>
  const payload = toOpenAI(body, model)
  let r = await send(payload)
  if (r.status === 400 && typeof payload.max_tokens === 'number') {
    const t = await readCapped(r.clone(), 1 << 20).catch(() => '')
    if (/max_(completion_)?tokens/i.test(t)) {
      const { max_tokens, ...rest } = payload
      r = /max_completion_tokens/i.test(t) && !/max_completion_tokens.*(exceed|too large|greater|maximum)/i.test(t) ? await send({ ...rest, max_completion_tokens: max_tokens }) : await send(rest)
    }
  }
  return r.ok ? { ok: true, r } : { ok: false, status: r.status, message: await readErr(r), retryAfter: retryAfterMs(r) }
}

// Forward Anthropic-compat (assinatura via api.anthropic.com, ou conexao/gateway direto): corpo passa como esta.
// Auth: x-api-key SO para a API da propria Anthropic (api.anthropic.com ou chave sk-ant-api); gateways compativeis
// (CCR, z.ai...) usam Authorization: Bearer — mandar x-api-key neles daria 401. Mesma regra do resolveProviderEnv.
async function tryAnthropic(url: string, body: Json, cred: string | undefined, kind: 'subscription' | 'anthropic', model: string | undefined, version: string | undefined, beta: string | undefined, ac: AbortController): Promise<Tried> {
  const payload = model ? { ...body, model } : body // gateway/conexao fixa o modelo; assinatura mantem o do request
  const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': version || '2023-06-01' }
  if (beta) headers['anthropic-beta'] = beta
  if (cred) {
    const xkey = kind === 'anthropic' && (/^https?:\/\/api\.anthropic\.com(\/|:|$)/i.test(url) || /^sk-ant-api/.test(cred))
    if (xkey) headers['x-api-key'] = cred
    else headers.authorization = `Bearer ${cred}`
  }
  const r = (await ufetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: ac.signal, dispatcher: slowOk })) as unknown as Response
  return r.ok ? { ok: true, r } : { ok: false, status: r.status, message: await readErr(r), retryAfter: retryAfterMs(r) }
}

// Alguns gateways respondem HTTP 200 com um corpo de ERRO (OpenAI-compat faz isso). Detecta no inicio do stream (1a
// linha data:) ou no corpo inteiro (200 nao-SSE). Retorna o erro para o chamador cair pro proximo backend.
function earlyStreamError(buf: string): Fault | undefined {
  // 1o evento SSE 'error' (mesmo com data: vazio): gateway sinalizou falha -> cai pro proximo
  if (/^event:\s*error\b/m.test(buf)) {
    const d = /^data:\s*(.+)$/m.exec(buf)?.[1]?.trim()
    let msg = 'provider error'
    if (d) {
      try {
        msg = jsonErrMsg(JSON.parse(d) as Json)
      } catch {
        /* data parcial/vazio */
      }
    }
    return { status: 502, message: msg }
  }
  for (const raw of buf.split('\n')) {
    const l = raw.trim()
    if (!l.startsWith('data:')) continue
    const data = l.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const j = JSON.parse(data) as Json
      if (j?.error) return { status: 502, message: jsonErrMsg(j) }
    } catch {
      /* linha parcial/nao-JSON: trata como conteudo normal (comita) */
    }
    return undefined // primeira linha data: valida sem erro => comita
  }
  if (!/\bdata:/.test(buf)) {
    try {
      const j = JSON.parse(buf.trim()) as Json
      if (j?.error && !j?.choices) return { status: 502, message: jsonErrMsg(j) }
    } catch {
      /* corpo ainda chegando: comita */
    }
  }
  return undefined
}

// Le o inicio do stream (ate a 1a linha data: ou um teto) para inspecionar ANTES de comitar; devolve os bytes lidos.
async function peekStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{ chunks: Buffer[]; text: string; drop?: Fault }> {
  const chunks: Buffer[] = []
  const dec = new TextDecoder()
  let text = ''
  for (;;) {
    let c: ReadableStreamReadResult<Uint8Array>
    try {
      c = await reader.read()
    } catch (e) {
      return { chunks, text, drop: { status: 502, message: `the provider connection dropped: ${(e as Error).message}` } }
    }
    if (c.done) break
    chunks.push(Buffer.from(c.value))
    text += dec.decode(c.value, { stream: true })
    // Para na 1a linha SSE COMPLETA (event: OU data:, com \n) — assim um "event: error" sem data: ainda e detectado
    // (nao fica pendurado esperando um data: que nunca vem) e um erro partido no 1o chunk espera a linha fechar.
    if (/(^|\n)(event|data):[^\n]*\n/.test(text) || text.length > 1 << 18) break
  }
  return { chunks, text }
}

// Comita a resposta OpenAI no res, OU devolve um Fault (sem escrever nada) se o backend 200 escondeu um erro no corpo.
async function commitOpenAI(r: Response, res: ServerResponse, model: string, ac: AbortController, stream: boolean): Promise<Fault | undefined> {
  if (!stream) {
    const text = await readCapped(r, MAX_RESP).catch(() => '')
    let j: Json
    try {
      j = JSON.parse(text) as Json
    } catch {
      return { status: 502, message: 'non-JSON response from provider' }
    }
    if (j?.error && !j?.choices) return { status: 502, message: jsonErrMsg(j) }
    sendJson(res, 200, toAnthropic(j, model))
    return undefined
  }
  const reader = r.body?.getReader()
  if (!reader) return { status: 502, message: 'empty response from provider' }
  // Ao abandonar este backend (cair pro proximo), cancela o stream upstream — senao ele segue gerando (cobrado) e o
  // socket fica aberto ate o bodyTimeout. So antes do commit; depois o proprio loop drena ate o fim.
  const bail = (f: Fault): Fault => (reader.cancel().catch(() => {}), f)
  const peek = await peekStream(reader)
  if (peek.drop) return bail(peek.drop)
  const early = earlyStreamError(peek.text)
  if (early) return bail(early)
  // comita: escreve o que ja foi lido e continua
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const conv = streamConverter(model)
  const dec = new TextDecoder()
  let buf = dec.decode(Buffer.concat(peek.chunks), { stream: true })
  let total = peek.chunks.reduce((n, c) => n + c.byteLength, 0)
  const processBuf = (): void => {
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        res.write(conv.push(JSON.parse(data)))
      } catch {
        /* linha nao-JSON */
      }
    }
  }
  processBuf()
  for (;;) {
    let c: ReadableStreamReadResult<Uint8Array>
    try {
      c = await reader.read()
    } catch (e) {
      res.end(conv.fail(`the provider connection dropped: ${(e as Error).message}`, 502))
      return undefined
    }
    if (c.done) break
    total += c.value.byteLength
    if (total > MAX_RESP) {
      ac.abort()
      res.end(conv.fail('provider response too large', 502))
      return undefined
    }
    buf += dec.decode(c.value, { stream: true })
    processBuf()
  }
  buf += dec.decode()
  const tail = buf.trim()
  if (tail.startsWith('data:')) {
    const data = tail.slice(5).trim()
    if (data && data !== '[DONE]') {
      try {
        res.write(conv.push(JSON.parse(data)))
      } catch {
        /* idem */
      }
    }
  }
  res.end(conv.end())
  return undefined
}

// Comita a resposta Anthropic (passthrough de bytes), OU devolve um Fault se o 200 escondeu um erro no corpo/stream.
async function commitAnthropic(r: Response, res: ServerResponse, stream: boolean): Promise<Fault | undefined> {
  if (!stream) {
    const text = await readCapped(r, MAX_RESP).catch(() => null) // drop/limite de corpo = falha do backend, nao 200 vazio
    if (text == null || text.trim() === '') return { status: 502, message: 'empty or unreadable response from provider' }
    try {
      const j = JSON.parse(text) as Json
      if (j?.type === 'error' || (j?.error && !j?.content)) return { status: 502, message: jsonErrMsg(j) }
    } catch {
      /* nao-JSON: passa como esta */
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(text)
    return undefined
  }
  const reader = r.body?.getReader()
  if (!reader) return { status: 502, message: 'empty response from provider' }
  // Abandonar o backend = cancelar o stream upstream (senao segue gerando/cobrando + socket aberto ate o bodyTimeout).
  const bail = (f: Fault): Fault => (reader.cancel().catch(() => {}), f)
  const peek = await peekStream(reader)
  if (peek.drop) return bail(peek.drop)
  // Erro logo no inicio: 1o evento SSE 'error', OU a 1a linha data: cujo JSON e {type:error} (gateway que omite
  // 'event:'), OU um 200 nao-SSE cujo corpo inteiro e erro. So o PRIMEIRO evento conta — conteudo valido que mencione
  // "event: error" no texto nao derruba o backend.
  const firstEvent = /^event:\s*(\S+)/m.exec(peek.text)?.[1]
  const firstDataRaw = /^data:\s*(.+)$/m.exec(peek.text)?.[1]?.trim()
  let firstDataJson: Json | undefined
  if (firstDataRaw) {
    try {
      firstDataJson = JSON.parse(firstDataRaw) as Json
    } catch {
      /* linha parcial (nao deveria, apos peekStream completar a 1a data:) */
    }
  }
  if (firstEvent === 'error' || firstDataJson?.type === 'error' || (firstDataJson?.error && !firstDataJson?.content)) {
    return bail({ status: 502, message: firstDataJson ? jsonErrMsg(firstDataJson) : 'provider error' })
  }
  if (!/^(event|data):/m.test(peek.text)) {
    try {
      const j = JSON.parse(peek.text.trim()) as Json
      if (j?.type === 'error' || (j?.error && !j?.content)) return bail({ status: 502, message: jsonErrMsg(j) })
    } catch {
      /* corpo ainda chegando: comita */
    }
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  for (const c of peek.chunks) res.write(c)
  let total = peek.chunks.reduce((n, c) => n + c.byteLength, 0)
  for (;;) {
    let c: ReadableStreamReadResult<Uint8Array>
    try {
      c = await reader.read()
    } catch (e) {
      res.end(`event: error\ndata: ${JSON.stringify(anthropicError(502, `the provider connection dropped: ${(e as Error).message}`))}\n\n`)
      return undefined
    }
    if (c.done) break
    total += c.value.byteLength
    if (total > MAX_RESP) {
      res.end(`event: error\ndata: ${JSON.stringify(anthropicError(502, 'provider response too large'))}\n\n`)
      return undefined
    }
    res.write(Buffer.from(c.value))
  }
  res.end()
  return undefined
}

async function handleRoute(req: IncomingMessage, res: ServerResponse, isCount: boolean): Promise<void> {
  if (!routerFn) return sendJson(res, 503, anthropicError(503, 'router not configured'))
  let body: Json
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return sendJson(res, 400, anthropicError(400, 'invalid JSON'))
  }
  if (isCount) return sendJson(res, 200, { input_tokens: Math.ceil(JSON.stringify(body.messages ?? []).length / 4 + textOf(body.system).length / 4) })
  const { plan, credOf, anthropicUrl, version, mark } = routerFn()
  const safeMark = (id: string, ra?: number): void => {
    try {
      mark?.(id, ra)
    } catch {
      /* um callback de mark quebrado NAO pode derrubar o roteamento (perder o fallback) */
    }
  }
  if (!plan.length) return sendJson(res, 503, anthropicError(503, 'no account available to route to'))
  const ac = new AbortController()
  res.on('close', () => !res.writableEnded && ac.abort())
  const reqVersion = String(req.headers['anthropic-version'] ?? '') || version
  const beta = String(req.headers['anthropic-beta'] ?? '') || undefined
  let last: Fault = { status: 503, message: 'no backend available' }
  for (const b of plan) {
    if (ac.signal.aborted) return // cliente desistiu (Esc): nao adianta tentar os proximos backends
    const cred = credOf(b)
    if (b.kind === 'subscription' && !cred) continue // sem setup-token ainda: pula (a captura e follow-up)
    const fail = (e: unknown): Tried => ({ ok: false, status: 0, message: String((e as Error)?.message ?? e) })
    const t =
      b.kind === 'openai'
        ? await tryOpenAI(`${b.url!.replace(/\/+$/, '')}/chat/completions`, b.model || String(body.model ?? ''), body, cred, ac).catch(fail)
        : await tryAnthropic(`${(b.kind === 'subscription' ? anthropicUrl ?? 'https://api.anthropic.com' : b.url!).replace(/\/+$/, '')}/v1/messages`, body, cred, b.kind, b.kind === 'subscription' ? undefined : b.model, reqVersion, beta, ac).catch(fail)
    if (!t.ok) {
      // backend-fault = status de falha do backend OU mensagem clara (modelo desconhecido, credito, sobrecarga) num 400/404
      if (shouldFallback(t.status) || isBackendFaultMessage(t.message)) {
        if (isLimitLike(t.status)) safeMark(b.accountId, t.retryAfter) // so limite (429/402) persiste; auth/transitorio nao
        last = { status: t.status || 502, message: t.message }
        continue
      }
      res.writeHead(t.status, { 'content-type': 'application/json' }) // erro da REQUISICAO: devolve, nao queima os outros
      return void res.end(JSON.stringify(anthropicError(t.status, t.message)))
    }
    // 200: comita; mas pode descobrir um erro no corpo (gateway 200+erro) e, se nada foi escrito, cai pro proximo
    const fb = await (b.kind === 'openai' ? commitOpenAI(t.r, res, b.model || String(body.model ?? ''), ac, !!body.stream) : commitAnthropic(t.r, res, !!body.stream)).catch(
      (e: unknown): Fault => ({ status: 502, message: String((e as Error)?.message ?? e) }),
    )
    if (!fb) return // comitou
    if (res.headersSent || res.writableEnded) return void (res.writableEnded || res.end()) // ja comprometeu o stream: nao da pra cair
    if (isLimitLike(fb.status)) safeMark(b.accountId, fb.retryAfter)
    last = fb
  }
  const status = last.status === 429 ? 429 : 502 // nunca devolve 401/403 do backend como se fosse do router (confunde o CLI)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(anthropicError(status, last.message)))
}
