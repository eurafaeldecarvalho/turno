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

const post = async (path: string, body: unknown): Promise<{ status: number; json: unknown }> => {
  const { port, token } = translatorInfo()
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': token },
    body: JSON.stringify(body),
  })
  return { status: r.status, json: await r.json().catch(() => null) }
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
