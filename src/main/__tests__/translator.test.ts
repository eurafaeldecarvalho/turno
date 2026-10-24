import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { anthropicError, startTranslator, streamConverter, toAnthropic, toOpenAI, translatorBase, translatorInfo } from '../translator'

describe('pedido Anthropic -> OpenAI', () => {
  it('sistema, texto, imagem, ferramentas e resultados viram o formato OpenAI na ordem certa', () => {
    const o = toOpenAI(
      {
        model: 'x',
        max_tokens: 100,
        system: [{ type: 'text', text: 'be brief' }],
        stop_sequences: ['END'],
        tools: [{ name: 'Read', description: 'read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }, { type: 'web_search_20250305', name: 'web_search' }],
        tool_choice: { type: 'any' },
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }] },
          { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a' } }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'file body' }] }, { type: 'text', text: 'and now?' }] },
        ],
        stream: true,
      },
      'gpt-x',
    )
    expect(o.model).toBe('gpt-x')
    expect(o.messages[0]).toEqual({ role: 'system', content: 'be brief' })
    expect(o.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } })
    expect(o.messages[2]).toEqual({ role: 'assistant', content: 'ok', tool_calls: [{ id: 't1', type: 'function', function: { name: 'Read', arguments: '{"path":"a"}' } }] })
    expect(o.messages[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'file body' })
    expect(o.messages[4]).toEqual({ role: 'user', content: 'and now?' })
    expect(o.tools).toHaveLength(1) // ferramenta "server" da Anthropic fica de fora
    expect(o.tool_choice).toBe('required')
    expect(o.stop).toEqual(['END'])
    expect(o.stream_options).toEqual({ include_usage: true })
  })
})

describe('resposta OpenAI -> Anthropic', () => {
  it('texto e chamada de ferramenta, com motivo de parada e uso', () => {
    const r = toAnthropic({ id: 'c1', choices: [{ finish_reason: 'tool_calls', message: { content: 'reading', tool_calls: [{ id: 'call_1', function: { name: 'Read', arguments: '{"path":"x"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 3 } }, 'm')
    expect(r.content).toEqual([{ type: 'text', text: 'reading' }, { type: 'tool_use', id: 'call_1', name: 'Read', input: { path: 'x' } }])
    expect(r.stop_reason).toBe('tool_use')
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 3 })
  })
  it('argumento JSON quebrado nao derruba a resposta', () => {
    const r = toAnthropic({ choices: [{ finish_reason: 'stop', message: { tool_calls: [{ id: 'a', function: { name: 'X', arguments: '{bad' } }] } }] }, 'm')
    expect(r.content[0].input).toEqual({ _raw: '{bad' })
  })
  it('erro 429 vira rate_limit_error (o Claude Code trata como limite)', () => {
    expect(anthropicError(429, 'slow down').error.type).toBe('rate_limit_error')
  })
})

describe('stream OpenAI -> eventos Anthropic', () => {
  it('abre e fecha blocos de texto e de ferramenta com indices certos', () => {
    const c = streamConverter('m')
    let s = c.push({ choices: [{ delta: { content: 'Hi' } }] })
    s += c.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'Bash', arguments: '{"cmd":' } }] } }] })
    s += c.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] } }] })
    s += c.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 7 } })
    s += c.end()
    const events = s
      .trim()
      .split('\n\n')
      .map((b) => JSON.parse(b.split('\n')[1].slice(6)))
    expect(events.map((e) => e.type)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'])
    expect(events[4].content_block).toMatchObject({ type: 'tool_use', id: 'call_9', name: 'Bash' })
    expect(events[4].index).toBe(1)
    expect(events[6].delta).toEqual({ type: 'input_json_delta', partial_json: '"ls"}' })
    expect(events[8].delta.stop_reason).toBe('tool_use')
    expect(events[8].usage.output_tokens).toBe(7)
  })
})

describe('chamadas de ferramenta sem "index" (Gemini/Ollama mandam cada uma inteira)', () => {
  it('cada id novo vira um bloco proprio', () => {
    const c = streamConverter('m')
    let s = c.push({ choices: [{ delta: { tool_calls: [{ id: 'a', function: { name: 'Read', arguments: '{"file_path":"a"}' } }] } }] })
    s += c.push({ choices: [{ delta: { tool_calls: [{ id: 'b', function: { name: 'Read', arguments: '{"file_path":"b"}' } }] } }] })
    s += c.end()
    const starts = s.split('\n\n').filter((b) => b.startsWith('event: content_block_start')).map((b) => JSON.parse(b.split('\n')[1].slice(6)))
    expect(starts.map((e) => [e.index, e.content_block.id])).toEqual([[0, 'a'], [1, 'b']])
  })
  it('id sem index e sem finish_reason ainda termina com stop_reason tool_use', () => {
    // sem esse fallback o Claude Code veria end_turn e nao rodaria a ferramenta
    const c = streamConverter('m')
    let s = c.push({ choices: [{ delta: { tool_calls: [{ id: 'a', function: { name: 'Read', arguments: '{"file_path":"a"}' } }] } }] })
    s += c.end() // nenhum chunk traz finish_reason
    const delta = JSON.parse(s.split('\n\n').find((b) => b.startsWith('event: message_delta'))!.split('\n')[1].slice(6))
    expect(delta.delta.stop_reason).toBe('tool_use')
  })
  it('duas chamadas inteiras sem id e sem index viram dois blocos (nao se fundem)', () => {
    const c = streamConverter('m')
    let s = c.push({ choices: [{ delta: { tool_calls: [{ function: { name: 'Read', arguments: '{"file_path":"a"}' } }] } }] })
    s += c.push({ choices: [{ delta: { tool_calls: [{ function: { name: 'Read', arguments: '{"file_path":"b"}' } }] } }] })
    s += c.end()
    const starts = s.split('\n\n').filter((b) => b.startsWith('event: content_block_start')).map((b) => JSON.parse(b.split('\n')[1].slice(6)))
    expect(starts.map((e) => e.index)).toEqual([0, 1])
    const deltas = s.split('\n\n').filter((b) => b.startsWith('event: content_block_delta')).map((b) => JSON.parse(b.split('\n')[1].slice(6)))
    expect(deltas.map((e) => e.delta.partial_json)).toEqual(['{"file_path":"a"}', '{"file_path":"b"}'])
  })
})

describe('erros dentro do stream', () => {
  it('chunk de erro do provedor vira o evento de erro da Anthropic e encerra', () => {
    const c = streamConverter('m')
    let s = c.push({ choices: [{ delta: { content: 'part' } }] })
    s += c.push({ error: { message: 'upstream overloaded', code: 529 } })
    s += c.push({ choices: [{ delta: { content: 'ignored' } }] })
    s += c.end()
    expect(s).toContain('event: error')
    expect(s).toContain('overloaded_error')
    expect(s).not.toContain('ignored')
    expect(s).not.toContain('message_stop')
  })
})

describe('servidor do tradutor (ponta a ponta com um provedor OpenAI falso)', () => {
  let upstream: Server | undefined
  afterEach(() => upstream?.close())

  it('exige o token da sessao, repassa a chave do cofre e traduz o stream', async () => {
    let seenAuth = ''
    let seenBody: Record<string, unknown> = {}
    upstream = createServer((req, res) => {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => {
        seenAuth = String(req.headers.authorization)
        seenBody = JSON.parse(b)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'pong' } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
        res.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', r))
    const upPort = (upstream.address() as { port: number }).port
    await startTranslator((id) => (id === 'groq' ? { conn: { id: 'groq', name: 'Groq', kind: 'endpoint', baseUrl: `http://127.0.0.1:${upPort}/v1`, model: 'llama', via: 'translate' }, key: 'sk-secret' } : undefined))
    const base = translatorBase('groq')
    const denied = await fetch(`${base}/v1/messages`, { method: 'POST', body: '{}' })
    expect(denied.status).toBe(401)
    const r = await fetch(`${base}/v1/messages?beta=true`, {
      method: 'POST',
      headers: { 'x-api-key': translatorInfo().token, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'ping' }] }),
    })
    const text = await r.text()
    expect(seenAuth).toBe('Bearer sk-secret')
    expect(seenBody.model).toBe('llama')
    expect(text).toContain('"text_delta","text":"pong"')
    expect(text).toContain('event: message_stop')
    // provedor que recusa max_tokens (modelo de raciocinio da OpenAI): o tradutor tenta de novo com max_completion_tokens
    upstream.removeAllListeners('request')
    const seen: Array<Record<string, unknown>> = []
    upstream.on('request', (req, res) => {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => {
        const j = JSON.parse(b)
        seen.push(j)
        if ('max_tokens' in j) {
          res.writeHead(400, { 'content-type': 'application/json' })
          return res.end(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } }))
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }))
      })
    })
    const r2 = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'x-api-key': translatorInfo().token }, body: JSON.stringify({ max_tokens: 32000, messages: [{ role: 'user', content: 'hi' }] }) })
    expect(r2.status).toBe(200)
    expect(seen[1]).toMatchObject({ max_completion_tokens: 32000 })
    const unknown = await fetch(`${translatorBase('nope')}/v1/messages`, { method: 'POST', headers: { 'x-api-key': translatorInfo().token }, body: '{}' })
    expect(unknown.status).toBe(404)
  })

  it('processa a ultima linha data: mesmo sem \\n no fim do stream do provedor', async () => {
    upstream = createServer((req, res) => {
      req.on('data', () => {})
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`)
        // ultima linha SEM \n no fim: antes era descartada (perdia conteudo/finish_reason)
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'END' }, finish_reason: 'stop' }] })}`)
      })
    })
    await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', r))
    const upPort = (upstream.address() as { port: number }).port
    await startTranslator((id) => (id === 'groq' ? { conn: { id: 'groq', name: 'Groq', kind: 'endpoint', baseUrl: `http://127.0.0.1:${upPort}/v1`, model: 'llama', via: 'translate' }, key: 'k' } : undefined))
    const base = translatorBase('groq')
    const r = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'x-api-key': translatorInfo().token, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] }) })
    const text = await r.text()
    expect(text).toContain('"text":"END"')
    expect(text).toContain('event: message_stop')
  })
})
