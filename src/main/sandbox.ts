import type { SandboxMode } from '../shared/types'

export interface SandboxOpts {
  image?: string
  cwd?: string
  env?: string[] // chaves de env a repassar ao sandbox (ANTHROPIC_*, TURNO_* etc.)
}

export interface Wrapped {
  cmd: string
  args: string[]
  env?: Record<string, string> // env extra a mesclar no spawn (ex. WSLENV no modo wsl)
}

// Envolve o comando a executar conforme o modo de sandbox.
// 'none' (DEFAULT) = no-op: o comando roda exatamente como hoje, sem sandbox.
// 'docker'/'wsl' = ponto de extensao; a imagem (com o `claude` instalado) e provisionada no ambiente.
// Windows-first: sandbox real = WSL2 ou Docker Desktop. O env do provedor e repassado (senao o claude
// rodaria sem ANTHROPIC_BASE_URL/TOKEN dentro do sandbox).
export function wrapForSandbox(cmd: string, args: string[], mode: SandboxMode, opts: SandboxOpts = {}): Wrapped {
  if (mode === 'none') return { cmd, args }
  const keys = opts.env ?? []
  if (mode === 'wsl') {
    // WSLENV repassa as env vars nomeadas do Windows para o Linux do WSL.
    return { cmd: 'wsl', args: ['--', cmd, ...args], env: keys.length ? { WSLENV: keys.join(':') } : undefined }
  }
  // docker: -e KEY faz pass-through da env do processo host (que o spawn ja setou) para o container.
  const passEnv = keys.flatMap((k) => ['-e', k])
  const mount = opts.cwd ? ['-v', `${opts.cwd}:/work`, '-w', '/work'] : []
  return { cmd: 'docker', args: ['run', '--rm', '-i', ...passEnv, ...mount, opts.image ?? 'turno-sandbox', cmd, ...args] }
}
