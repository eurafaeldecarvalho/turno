import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Agent, fetch as ufetch } from 'undici'
import type { Connection } from '../shared/types'

// modelo local lento (CPU) pode levar minutos ate o primeiro pedaco: sem os tetos de 5 min do fetch padrao.
// O agente ja tem o proprio limite (API_TIMEOUT_MS de 30 min) e o Esc cancela pelo AbortController.
const slowOk = new Agent({ headersTimeout: 30 * 60_000, bodyTimeout: 30 * 60_000 })

// Tradutor local Anthropic Messages -> OpenAI Chat Completions.
// O Claude Code so fala o formato da Anthropic; a maioria dos provedores do catalogo (Groq, OpenRouter, Mistral,
// LM Studio, vLLM...) fala o da OpenAI. A conexao com via='translate' aponta o CLI para http://127.0.0.1:<porta>/c/<id>
// e este servidor repassa ao provedor real, com a chave do cofre (a chave nunca vai para o processo do agente).
// Ideia e mapeamento de campos inspirados no tradutor do OmniRoute (MIT, (c) 2026 diegosouzapw); codigo proprio.

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
