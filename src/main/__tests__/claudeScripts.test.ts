import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { scriptFiles, claudeSessionWiring } from '../claudeScripts'

// Os scripts que o Claude Code roda (statusline e hooks) executados de verdade: sh no Linux/macOS, PowerShell no Windows
// (o CI de testes roda nos dois). Um servidor local faz o papel do Turno.
const win = process.platform === 'win32'
let dir = ''
let server: Server
let port = 0
const got: Array<{ url: string; token: string; body: string }> = []
const REPLY = '╭ Opus 5  HIGH  ·  eu\n╰ 5h   ━━━━  13%   ↺ 3h54m\n\n'

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'turno-scripts-'))
  for (const [name, text] of Object.entries(scriptFiles())) writeFileSync(join(dir, name), text)
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      got.push({ url: req.url ?? '', token: String(req.headers['x-turno-token'] ?? ''), body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(req.url?.startsWith('/statusline/') ? REPLY : '')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as { port: number }).port
})
afterAll(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

// roda o comando como o Claude Code roda: statusline pela string de comando num shell; hook na forma exec (sem shell)
function run(kind: 'statusline' | 'hook', input: string, withTurno = true): Promise<string> {
  const w = claudeSessionWiring(process.platform, dir)
  const env = { ...process.env, TMPDIR: dir, TEMP: dir, ...(withTurno ? { TURNO_HOOK_PORT: String(port), TURNO_HOOK_TOKEN: 'tok', TURNO_AGENT_KEY: 'k1', TURNO_ACCOUNT_ID: 'acc' } : { TURNO_HOOK_PORT: '' }) }
  const [file, args] =
    kind === 'statusline'
      ? win
        ? ['powershell.exe', ['-NoProfile', '-Command', w.statusLine.command]]
        : ['sh', ['-c', w.statusLine.command]]
      : win
        ? ['powershell.exe', ['-NoProfile', '-Command', w.hook('Stop').command]] // Windows sem Git Bash: o Claude usa o PowerShell
        : ['sh', ['-c', w.hook('Stop').command]]
  return new Promise((res, rej) => {
    const p = execFile(file, args as string[], { env, encoding: 'buffer', timeout: 20000 }, (err, out) => (err ? rej(err) : res((out as Buffer).toString('utf8'))))
    p.stdin?.end(input)
  })
}

describe('scripts do Claude Code (statusline e hooks) em qualquer computador', () => {
  it('deveMandarOStatuslineAoTurnoEMostrarARespostaEmUtf8', async () => {
    const out = await run('statusline', '{"model":{"display_name":"Opus 5"},"cwd":"/x/ção"}')
    expect(out.replace(/\r\n/g, '\n')).toBe(REPLY) // exatamente a resposta do Turno (UTF-8 intacto)
    expect(out).toContain('━━━━')
    expect(out).toContain('╭ Opus 5')
    const req = got.find((g) => g.url === '/statusline/k1/acc')!
    expect(req.token).toBe('tok')
    expect(JSON.parse(req.body).cwd).toBe('/x/ção')
  }, 30_000)
  it('deveUsarOCacheDentroDe2sSemConsultarDeNovo', async () => {
    const before = got.filter((g) => g.url.startsWith('/statusline/')).length
    const out = await run('statusline', '{}')
    expect(out).toContain('╭ Opus 5')
    expect(got.filter((g) => g.url.startsWith('/statusline/')).length).toBe(before)
  }, 30_000)
  it('deveMandarOHookComOEvento', async () => {
    await run('hook', '{"session_id":"abc"}')
    const req = got.find((g) => g.url === '/hook/k1/acc/Stop')!
    expect(req.token).toBe('tok')
    expect(JSON.parse(req.body).session_id).toBe('abc')
  }, 30_000)
  it('naoDeveFazerNadaForaDoTurno', async () => {
    const n = got.length
    expect((await run('statusline', '{}', false)).trim()).toBe('')
    await run('hook', '{}', false)
    expect(got.length).toBe(n)
  }, 30_000)
})

describe('configuracao dos scripts por sistema', () => {
  it('deveUsarPowerShellNoWindows (Git Bash e opcional)', () => {
    const w = claudeSessionWiring('win32', 'C:/Users/eu/AppData/turno')
    // forma shell (powershell -File), igual ao statusline: um Claude antigo que ignore "args" rodaria powershell.exe puro
    // lendo o JSON do hook como comando; -File funciona pelo Git Bash e pelo PowerShell
    expect(w.hook('Stop')).toEqual({ type: 'command', command: 'powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Users/eu/AppData/turno/turno-hook.ps1" Stop', timeout: 10 })
    expect(w.statusLine.command).toBe('powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Users/eu/AppData/turno/turno-statusline.ps1"')
  })
  it('deveUsarShNoLinuxEMac', () => {
    const w = claudeSessionWiring('linux', '/home/eu/.config/turno')
    expect(w.hook('Stop')).toMatchObject({ type: 'command', command: 'sh "/home/eu/.config/turno/turno-hook.sh" Stop' })
    expect(w.statusLine.command).toBe('sh "/home/eu/.config/turno/turno-statusline.sh"')
  })
})
