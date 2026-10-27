import { execFile } from 'node:child_process'
import { childEnv, claudeInstallCommand } from './env'
import type { DetectedAgent } from '../shared/types'

// CLIs de agentes que o Turno sabe abrir (onboarding mostra os encontrados no PATH primeiro).
const CANDIDATES: Array<{ id: string; name: string; cmd: string; url: string }> = [
  { id: 'claude', name: 'Claude Code', cmd: 'claude', url: 'https://docs.claude.com/en/docs/claude-code/setup' },
  { id: 'codex', name: 'Codex CLI', cmd: 'codex', url: 'https://github.com/openai/codex' },
  { id: 'gemini', name: 'Gemini CLI', cmd: 'gemini', url: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'qwen', name: 'Qwen Code', cmd: 'qwen', url: 'https://github.com/QwenLM/qwen-code' },
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode', url: 'https://opencode.ai' },
  { id: 'copilot', name: 'GitHub Copilot CLI', cmd: 'copilot', url: 'https://github.com/github/copilot-cli' },
  { id: 'ollama', name: 'Ollama (local models)', cmd: 'ollama', url: 'https://ollama.com/download' },
]

const where = (cmd: string): Promise<string | undefined> =>
  new Promise((res) =>
    execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], { env: childEnv(), timeout: 5000, windowsHide: true }, (err, out) =>
      res(err ? undefined : String(out).split(/\r?\n/).find(Boolean)?.trim()),
    ),
  )

export async function detectAgents(): Promise<DetectedAgent[]> {
  return Promise.all(CANDIDATES.map(async (c) => ({ id: c.id, name: c.name, url: c.url, path: await where(c.cmd) })))
}

// Modelos instalados no Ollama (para escolher o da conexao local sem digitar nome de modelo).
export async function ollamaModels(baseUrl = 'http://localhost:11434'): Promise<string[]> {
  try {
    const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return []
    const j = (await r.json()) as { models?: Array<{ name?: string }> }
    return (j.models ?? []).map((m) => m.name ?? '').filter(Boolean)
  } catch {
    return []
  }
}

// Instala o Claude Code sem terminal (introducao): o instalador oficial, nativo, sem Node e sem administrador.
// Devolve o fim do log para mostrar se falhar. Linux/macOS: bash; Windows: PowerShell.
export function installClaude(): Promise<{ ok: boolean; log: string }> {
  const cmd = claudeInstallCommand(process.platform)
  const [file, args] = process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd]] : ['bash', ['-lc', cmd]]
  return new Promise((res) =>
    execFile(file, args, { env: childEnv(), timeout: 10 * 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out, errOut) =>
      res({ ok: !err, log: `${String(out ?? '')}${String(errOut ?? '')}`.trim().split(/\r?\n/).slice(-12).join('\n') }),
    ),
  )
}
