import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

// Antes de o Turno abrir o Claude num terminal: pasta ja confiavel e Chrome ligado,
// para nao parar nas perguntas "trust this folder" e do Claude in Chrome.
const configFile = (): string =>
  process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json')

const norm = (p: string): string => resolve(p).replace(/\\/g, '/').replace(/\/+$/, '')

export function prepareClaude(cwd: string | undefined, chrome: boolean): void {
  const file = configFile()
  if (!existsSync(file)) return
  let j: Record<string, any>
  try {
    j = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return // arquivo sendo gravado pelo Claude: melhor nao mexer
  }
  let changed = false
  const dir = norm(cwd && existsSync(cwd) ? cwd : homedir()) // homedir() ja e o USERPROFILE no Windows
  j.projects ??= {}
  const key = Object.keys(j.projects).find((k) => norm(k).toLowerCase() === dir.toLowerCase()) ?? dir
  const proj = (j.projects[key] ??= {
    allowedTools: [],
    mcpContextUris: [],
    mcpServers: {},
    enabledMcpjsonServers: [],
    disabledMcpjsonServers: [],
  })
  if (proj.hasTrustDialogAccepted !== true) {
    proj.hasTrustDialogAccepted = true
    changed = true
  }
  if (chrome && (j.claudeInChromeDefaultEnabled !== true || j.hasCompletedClaudeInChromeOnboarding !== true)) {
    j.claudeInChromeDefaultEnabled = true
    j.hasCompletedClaudeInChromeOnboarding = true
    changed = true
  }
  if (!changed) return
  const tmp = `${file}.turno-${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(j, null, 2))
  renameSync(tmp, file)
}
