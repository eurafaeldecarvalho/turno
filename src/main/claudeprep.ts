import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

// Antes de o Turno abrir o Claude num terminal: Chrome ligado e, numa conta isolada, a confianca na pasta que o
// usuario JA deu em outra conta (a troca de conta nao para no dialogo "trust this folder").
// O Turno nunca decide confiar numa pasta nova: o dialogo do Claude e a unica barreira contra hooks, agentes,
// skills e MCPs de um repo de terceiros (e a confianca e herdada pelas subpastas).
const configFile = (configDir?: string): string =>
  configDir ? join(configDir, '.claude.json') : process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json')

const norm = (p: string): string => resolve(p).replace(/\\/g, '/').replace(/\/+$/, '')

const trustedIn = (file: string, dir: string): boolean => {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    const k = Object.keys(j.projects ?? {}).find((x) => norm(x).toLowerCase() === dir.toLowerCase())
    return !!k && j.projects[k]?.hasTrustDialogAccepted === true
  } catch {
    return false
  }
}

// configDir: pasta de uma conta isolada (botao Agent); sem ela, a pasta padrao do usuario.
// peers: .claude.json das outras contas, de onde a confianca ja dada pode ser copiada.
export function prepareClaude(cwd: string | undefined, chrome: boolean, configDir?: string, peers: string[] = []): void {
  const file = configFile(configDir)
  if (!existsSync(file)) return
  let j: Record<string, any>
  try {
    j = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return // arquivo sendo gravado pelo Claude: melhor nao mexer
  }
  let changed = false
  const dir = norm(cwd && existsSync(cwd) ? cwd : homedir()) // homedir() ja e o USERPROFILE no Windows
  const home = norm(homedir()).toLowerCase()
  // confianca so e copiada (nunca criada) e nunca para a pasta do usuario (o Claude nem grava essa)
  const copyTrust = dir.toLowerCase() !== home && !trustedIn(file, dir) && [configFile(), ...peers].some((f) => norm(f).toLowerCase() !== norm(file).toLowerCase() && trustedIn(f, dir))
  if (copyTrust) {
    j.projects ??= {}
    const key = Object.keys(j.projects).find((k) => norm(k).toLowerCase() === dir.toLowerCase()) ?? dir
    const proj = (j.projects[key] ??= {
      allowedTools: [],
      mcpContextUris: [],
      mcpServers: {},
      enabledMcpjsonServers: [],
      disabledMcpjsonServers: [],
    })
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
