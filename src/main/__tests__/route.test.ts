import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { startTranslator, setRouter, translatorInfo } from '../translator'
import type { Backend } from '../../shared/routing'

// Sobe um upstream falso que responde /v1/messages com o status/corpo dados; registra chamadas.
function upstream(status: number, body: unknown): Promise<{ url: string; calls: number; close: () => void; server: Server }> {
  let calls = 0
  const server = createServer((req, res) => {
    calls++
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, get calls() { return calls }, close: () => server.close(), server } as never),
    ),
  )
}

const servers: Array<{ close: () => void }> = []
afterEach(() => servers.forEach((s) => s.close()))

async function up(status: number, body: unknown) {
  const u = await upstream(status, body)
  servers.push(u)
  return u
}

const post = async (path: string, body: unknown): Promise<{ status: number; json: unknown; text: string }> => {
  const { port, token } = translatorInfo()
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': token },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* SSE ou nao-JSON */
  }
  return { status: r.status, json, text }
}

describe('/route: proxy de roteamento com fallback (backends Anthropic)', () => {
  it('cai pro proximo backend quando o primeiro estoura o limite (429), mantendo a requisicao', async () => {
    const a = await up(429, { error: { message: 'limit' } })
    const b = await up(200, { id: 'msg_b', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'de B' }] })
    await startTranslator(() => undefined)
    const plan: Backend[] = [
      { accountId: 'a', kind: 'anthropic', url: a.url },
      { accountId: 'b', kind: 'anthropic', url: b.url },
    ]
    setRouter(() => ({ plan, credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', messages: [{ role: 'user', content: 'oi' }] })
    expect(res.status).toBe(200)
    expect((res.json as { content: { text: string }[] }).content[0].text).toBe('de B')
    expect((a as { calls: number }).calls).toBe(1) // tentou A
    expect((b as { calls: number }).calls).toBe(1) // caiu pra B
  })

  it('NAO cai pro proximo num erro de cliente (400): devolve o erro sem queimar o resto', async () => {
    const a = await up(400, { error: { message: 'bad request' } })
    const b = await up(200, { id: 'msg_b', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'de B' }] })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'anthropic', url: a.url }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', messages: [] })
    expect(res.status).toBe(400)
    expect((b as { calls: number }).calls).toBe(0) // B nao foi tocado
  })

  it('backend OpenAI: traduz a resposta para o formato Anthropic', async () => {
    const o = await up(200, { id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'de openai' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2 } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'o', kind: 'openai', connectionId: 'c', url: o.url, model: 'm' }], credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', messages: [{ role: 'user', content: 'oi' }] })
    expect(res.status).toBe(200)
    const j = res.json as { type: string; content: { type: string; text: string }[] }
    expect(j.type).toBe('message')
    expect(j.content[0].text).toBe('de openai')
  })

  it('sem backend roteavel = 503', async () => {
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [], credOf: () => undefined }))
    const res = await post('/route/v1/messages', { model: 'x', messages: [] })
    expect(res.status).toBe(503)
  })
})

// Upstream flexível: grava os headers recebidos; pode devolver headers e corpo cru (SSE).
function upstream2(opts: { status: number; body?: unknown; raw?: string; chunks?: string[]; headers?: Record<string, string> }): Promise<{ url: string; calls: number; headers: Record<string, string>; close: () => void }> {
  let calls = 0
  let last: Record<string, string> = {}
  const server = createServer((req, res) => {
    calls++
    last = req.headers as Record<string, string>
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', async () => {
      res.writeHead(opts.status, { 'content-type': opts.raw || opts.chunks ? 'text/event-stream' : 'application/json', ...(opts.headers ?? {}) })
      if (opts.chunks) {
        for (const c of opts.chunks) {
          res.write(c)
          await new Promise((r) => setTimeout(r, 15))
        }
        res.end()
      } else res.end(opts.raw ?? JSON.stringify(opts.body ?? {}))
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, get calls() { return calls }, get headers() { return last }, close: () => server.close() } as never)),
  )
}
async function up2(opts: Parameters<typeof upstream2>[0]) {
  const u = await upstream2(opts)
  servers.push(u)
  return u
}

// Upstream que escreve algo e SEGURA o socket aberto (nunca dá end) — simula gateway meio-caído/half-open.
async function upHang(raw: string): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(raw) // sem res.end(): mantem a conexao pendurada
    })
  })
  const u = await new Promise<{ url: string; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() })),
  )
  servers.push(u)
  return u
}

// Upstream que escreve `raw`, SEGURA o socket aberto, e registra quando a conexão fecha (para provar o cancel).
async function upProbe(raw: string): Promise<{ url: string; closed: boolean; close: () => void }> {
  let closed = false
  const server = createServer((req, res) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.on('close', () => (closed = true))
      res.write(raw) // sem end: fica aberto ate o cliente (o Turno) cancelar
    })
  })
  const u = await new Promise<{ url: string; closed: boolean; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, get closed() { return closed }, close: () => server.close() })),
  )
  servers.push(u)
  return u
}

// Upstream que promete 200 mas derruba o socket no meio do corpo (leitura falha).
async function upBroken(): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '500' })
      res.write('{"partial')
      setTimeout(() => res.socket?.destroy(), 10)
    })
  })
  const u = await new Promise<{ url: string; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() })),
  )
  servers.push(u)
  return u
}

describe('/route: achados do review (regressão)', () => {
  it('backend OpenAI que responde 200 com erro no corpo CAI pro proximo (não entrega turno vazio)', async () => {
    const a = await up2({ status: 200, body: { error: { message: 'Rate limit exceeded' } } }) // gateway OpenAI-compat
    const b = await up2({ status: 200, body: { choices: [{ message: { role: 'assistant', content: 'de B' }, finish_reason: 'stop' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'openai', url: a.url, model: 'm' }, { accountId: 'b', kind: 'openai', url: b.url, model: 'm' }], credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', messages: [{ role: 'user', content: 'oi' }] })
    expect(res.status).toBe(200)
    expect((res.json as { content: { text: string }[] }).content[0].text).toBe('de B')
    expect(a.calls).toBe(1)
    expect(b.calls).toBe(1)
  })

  it('backend OpenAI que streama um evento de erro logo no inicio CAI pro proximo', async () => {
    const a = await up2({ status: 200, raw: 'data: {"error":{"message":"overloaded"}}\n\n' })
    const b = await up2({ status: 200, body: { choices: [{ message: { role: 'assistant', content: 'de B' }, finish_reason: 'stop' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'openai', url: a.url, model: 'm' }, { accountId: 'b', kind: 'openai', url: b.url, model: 'm' }], credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', stream: true, messages: [{ role: 'user', content: 'oi' }] })
    expect(b.calls).toBe(1) // caiu pra B
  })

  it('401/403 NÃO marca a conta (não bloqueia pra sempre) — só cai pro proximo', async () => {
    const a = await up2({ status: 403, body: { error: { message: 'forbidden' } } })
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'de B' }] } })
    const marks: unknown[] = []
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'anthropic', url: a.url }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k', mark: (id, ra) => marks.push([id, ra]) }))
    const res = await post('/route/v1/messages', { model: 'x', messages: [] })
    expect(res.status).toBe(200)
    expect(b.calls).toBe(1) // caiu pra B
    expect(marks).toEqual([]) // conta NÃO foi marcada por um 403 pontual
  })

  it('429 com Retry-After marca a conta com a janela do provedor', async () => {
    const a = await up2({ status: 429, headers: { 'retry-after': '30' }, body: { error: { message: 'slow down' } } })
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'de B' }] } })
    const marks: Array<[string, number | undefined]> = []
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'anthropic', url: a.url }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k', mark: (id, ra) => marks.push([id, ra]) }))
    await post('/route/v1/messages', { model: 'x', messages: [] })
    expect(marks).toEqual([['a', 30000]])
  })

  it('404 "model not found" num gateway CAI pro proximo (fan-out com modelo heterogêneo)', async () => {
    const a = await up2({ status: 404, body: { error: { message: 'model xyz not found' } } })
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'de B' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'anthropic', url: a.url }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', messages: [] })
    expect(res.status).toBe(200)
    expect(b.calls).toBe(1)
  })

  it('resposta Anthropic válida cujo CONTEÚDO contém "event: error" NÃO é descartada (só o 1º evento SSE conta)', async () => {
    const good =
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m","content":[]}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"use an event: error handler"}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    const a = await up2({ status: 200, raw: good })
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'de B' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'anthropic', url: a.url }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k' }))
    const { port, token } = translatorInfo()
    const r = await fetch(`http://127.0.0.1:${port}/route/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': token }, body: JSON.stringify({ model: 'x', stream: true, messages: [] }) })
    expect(r.status).toBe(200)
    await r.text()
    expect(a.calls).toBe(1)
    expect(b.calls).toBe(0) // o backend A foi comitado, NAO descartado
  })

  it('leitura do corpo que falha (socket cai) CAI pro próximo, não devolve 200 vazio', async () => {
    const a = await upBroken()
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'de B' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'anthropic', url: a.url }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', messages: [] })
    expect(res.status).toBe(200)
    expect((res.json as { content: { text: string }[] }).content[0].text).toBe('de B') // caiu pra B, nao 200 vazio
  })

  it('erro de 200 partido DENTRO da 1ª linha data: ainda CAI pro próximo (peek espera a linha completar)', async () => {
    const a = await up2({ status: 200, chunks: ['data: {"err', 'or":{"message":"upstream exploded"}}\n\n'] })
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FROM_B' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'openai', url: a.url, model: 'm' }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', stream: true, messages: [] })
    expect(res.text).toContain('FROM_B') // caiu pra B, nao comitou o erro de A
  })

  it('stream Anthropic cuja 1ª linha é um data: {"type":"error"} (sem linha event:) CAI pro próximo', async () => {
    const a = await up2({ status: 200, raw: 'data: {"type":"error","error":{"message":"boom"}}\n\n' })
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FROM_B' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'anthropic', url: a.url }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', stream: true, messages: [] })
    expect(res.text).toContain('FROM_B')
  })

  it('Retry-After absurdo NÃO derruba a cadeia (cap de 24h, mark guardado)', async () => {
    const a = await up2({ status: 429, headers: { 'retry-after': '99999999999999' }, body: { error: { message: 'slow' } } })
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FROM_B' }] } })
    const marks: Array<[string, number | undefined]> = []
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'anthropic', url: a.url }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k', mark: (id, ra) => marks.push([id, ra]) }))
    const res = await post('/route/v1/messages', { model: 'x', messages: [] })
    expect(res.status).toBe(200) // caiu pra B, nao estourou 502 RangeError
    expect((res.json as { content: { text: string }[] }).content[0].text).toBe('FROM_B')
    expect(marks[0][0]).toBe('a')
    expect(marks[0][1]).toBe(24 * 60 * 60 * 1000) // cap aplicado
  })

  it('callback de mark que lança NÃO derruba o roteamento (safeMark)', async () => {
    const a = await up2({ status: 429, body: { error: { message: 'slow' } } })
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FROM_B' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'anthropic', url: a.url }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k', mark: () => { throw new Error('mark exploded') } }))
    const res = await post('/route/v1/messages', { model: 'x', messages: [] })
    expect(res.status).toBe(200)
    expect((res.json as { content: { text: string }[] }).content[0].text).toBe('FROM_B')
  })

  it('"event: error" completo seguido de socket pendurado (sem data:) CAI pro próximo — não trava', async () => {
    const a = await upHang('event: error\n') // sinaliza erro e segura a conexao
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FROM_B' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'anthropic', url: a.url }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', stream: true, messages: [] })
    expect(res.text).toContain('FROM_B') // detectou o event:error e caiu pra B em vez de pendurar
  })

  it('OpenAI "event: error" com data: vazio CAI pro próximo (não comita turno vazio)', async () => {
    const a = await up2({ status: 200, raw: 'event: error\ndata:\n\n' })
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FROM_B' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'openai', url: a.url, model: 'm' }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', stream: true, messages: [] })
    expect(res.text).toContain('FROM_B')
  })

  it('ao cair pro próximo, CANCELA o stream do backend abandonado (não vaza conexão nem tokens cobrados)', async () => {
    const a = await upProbe('event: error\ndata: {"type":"error","error":{"message":"x"}}\n\n') // erro + segura o socket
    const b = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'FROM_B' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'a', kind: 'anthropic', url: a.url }, { accountId: 'b', kind: 'anthropic', url: b.url }], credOf: () => 'k' }))
    const res = await post('/route/v1/messages', { model: 'x', stream: true, messages: [] })
    expect(res.text).toContain('FROM_B')
    await new Promise((r) => setTimeout(r, 200))
    expect(a.closed).toBe(true) // o Turno cancelou o reader de A -> a conexao de A fechou
  })

  it('gateway Anthropic-compat (não api.anthropic.com, chave não sk-ant-api) recebe Authorization: Bearer, não x-api-key', async () => {
    const g = await up2({ status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }] } })
    await startTranslator(() => undefined)
    setRouter(() => ({ plan: [{ accountId: 'g', kind: 'anthropic', url: g.url }], credOf: () => 'my-gateway-key' }))
    await post('/route/v1/messages', { model: 'x', messages: [] })
    expect(g.headers.authorization).toBe('Bearer my-gateway-key')
    expect(g.headers['x-api-key']).toBeUndefined()
  })
})
