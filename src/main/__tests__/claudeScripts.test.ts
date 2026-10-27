import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  // no Linux/macOS "\\" e caractere valido de nome de pasta (no Windows e o separador)
  dir = join(mkdtempSync(join(tmpdir(), 'turno-scripts-')), win ? "José $x O'Brien [1]" : "José $x O'Brien [1] a\\b")
  mkdirSync(dir)
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
  rmSync(join(dir, '..'), { recursive: true, force: true })
})
// Git Bash do Windows (o Claude usa ele quando existe; senao o PowerShell): os dois caminhos sao testados no CI
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'

// roda o comando como o Claude Code roda: statusline e hook sempre por um shell (sh no Linux/macOS; Git Bash ou PowerShell no Windows)
function run(kind: 'statusline' | 'hook', input: string, withTurno = true, shell: 'native' | 'gitbash' = 'native'): Promise<string> {
  const w = claudeSessionWiring(process.platform, dir)
  const env = { ...process.env, TMPDIR: dir, TEMP: dir, ...(withTurno ? { TURNO_HOOK_PORT: String(port), TURNO_HOOK_TOKEN: 'tok', TURNO_AGENT_KEY: 'k1', TURNO_ACCOUNT_ID: 'acc' } : { TURNO_HOOK_PORT: '' }) }
  const command = kind === 'statusline' ? w.statusLine.command : w.hook('Stop').command
  // como o Claude roda: sh -c no Linux/macOS; no Windows pelo Git Bash (se houver) ou pelo PowerShell
  const [file, args]: [string, string[]] = !win ? ['sh', ['-c', command]] : shell === 'gitbash' ? [GIT_BASH, ['-c', command]] : ['powershell.exe', ['-NoProfile', '-Command', command]]
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
  it('deveFuncionarPeloGitBashNoWindowsTambem', async () => {
    if (!win || !existsSync(GIT_BASH)) return // so no Windows com Git Bash (o CI tem)
    const out = await run('statusline', '{"model":{"display_name":"Opus 5"}}', true, 'gitbash')
    expect(out).toContain('╭ Opus 5')
    const before = got.filter((g) => g.url === '/hook/k1/acc/Stop').length
    await run('hook', '{"session_id":"gb"}', true, 'gitbash')
    expect(got.filter((g) => g.url === '/hook/k1/acc/Stop').length).toBe(before + 1)
  }, 30_000)
  it('naoDeveMostrarRodapeVelhoQuandoOTurnoNaoResponde', async () => {
    await new Promise((r) => setTimeout(r, 2200)) // passa o cache de 2 s
    const env = { TURNO_HOOK_PORT: '1', TURNO_HOOK_TOKEN: 'tok', TURNO_AGENT_KEY: 'k1', TURNO_ACCOUNT_ID: 'acc' } // porta sem ninguem
    const w = claudeSessionWiring(process.platform, dir)
    const [file, args]: [string, string[]] = win ? ['powershell.exe', ['-NoProfile', '-Command', w.statusLine.command]] : ['sh', ['-c', w.statusLine.command]]
    const out = await new Promise<string>((res, rej) => {
      const p = execFile(file, args, { env: { ...process.env, TMPDIR: dir, TEMP: dir, ...env }, encoding: 'buffer', timeout: 20000 }, (err, o) => (err ? rej(err) : res((o as Buffer).toString('utf8'))))
      p.stdin?.end('{}')
    })
    expect(out.trim()).toBe('')
  }, 40_000)
  it('naoDeveFazerNadaForaDoTurno', async () => {
    const n = got.length
    expect((await run('statusline', '{}', false)).trim()).toBe('')
    await run('hook', '{}', false)
    expect(got.length).toBe(n)
  }, 30_000)
})

describe('configuracao dos scripts por sistema', () => {
  it('deveUsarPowerShellComOCaminhoCodificadoNoWindows (nenhum shell mexe em $, aspas ou colchetes)', () => {
    const w = claudeSessionWiring('win32', "C:/Users/José $x O'Brien [1]/AppData/turno")
    const enc = /^powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(w.statusLine.command)
    expect(enc).not.toBeNull()
    expect(Buffer.from(enc![1], 'base64').toString('utf16le')).toBe("& 'C:/Users/José $x O''Brien [1]/AppData/turno/turno-statusline.ps1'")
    const h = /-EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(w.hook('Stop').command)!
    expect(Buffer.from(h[1], 'base64').toString('utf16le')).toBe("& 'C:/Users/José $x O''Brien [1]/AppData/turno/turno-hook.ps1' 'Stop'")
    expect(w.hook('Stop')).toMatchObject({ type: 'command', timeout: 10 })
  })
  it('deveManterABarraInvertidaDoCaminhoNoLinuxEMac (so o Windows troca \\ por /)', () => {
    expect(claudeSessionWiring('linux', '/home/eu/a\\b').statusLine.command).toBe("sh '/home/eu/a\\b/turno-statusline.sh'")
    expect(claudeSessionWiring('win32', 'C:\\Users\\eu').statusLine.command).toContain('-EncodedCommand')
  })
  it('deveUsarShComAspasSimplesNoLinuxEMac', () => {
    const w = claudeSessionWiring('linux', "/home/eu $x/O'Brien")
    expect(w.statusLine.command).toBe("sh '/home/eu $x/O'\\''Brien/turno-statusline.sh'")
    expect(w.hook('Stop').command).toBe("sh '/home/eu $x/O'\\''Brien/turno-hook.sh' 'Stop'") // evento tambem entre aspas
  })
})
