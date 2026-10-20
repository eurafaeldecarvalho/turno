import type { SandboxMode } from '../shared/types'

export interface SandboxOpts {
  image?: string
  cwd?: string
}

// Envolve o comando a executar conforme o modo de sandbox.
// 'none' (DEFAULT) = no-op: o comando roda exatamente como hoje, sem sandbox.
// 'docker'/'wsl' = ponto de extensao; a imagem/montagem concreta e configurada depois (ver ticket T13).
// Windows-first: sandbox real = WSL2 ou Docker Desktop.
export function wrapForSandbox(cmd: string, args: string[], mode: SandboxMode, opts: SandboxOpts = {}): { cmd: string; args: string[] } {
  if (mode === 'none') return { cmd, args }
  if (mode === 'wsl') return { cmd: 'wsl', args: ['--', cmd, ...args] }
  // docker
  const mount = opts.cwd ? ['-v', `${opts.cwd}:/work`, '-w', '/work'] : []
  return { cmd: 'docker', args: ['run', '--rm', '-i', ...mount, opts.image ?? 'turno-sandbox', cmd, ...args] }
}
