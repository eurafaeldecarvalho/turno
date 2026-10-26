// Claude aberto pelo Turno comeca em auto mode (--permission-mode auto), qualquer que seja o defaultMode do settings.json
// do usuario (copiado para as contas isoladas). Comando que ja escolhe o modo fica como esta.
// So olha as flags FORA de aspas: o prompt (texto do usuario, de uma tarefa, de um repo) pode citar a flag.
// Vale para `claude` em qualquer posicao de comando (`cd x; claude`, `& claude.exe`), nao so no comeco da linha.
const CLAUDE_AT_COMMAND = /(^\s*|[;&|(]\s*|&\s+)(claude(?:\.exe)?)(?=\s|$|;|&|\|)/g
export const defaultPermissionMode = (cmd: string): string => {
  const bare = cmd.replace(/"[^"]*"|'[^']*'/g, '')
  if (/--permission-mode\b|--dangerously-skip-permissions\b/.test(bare) || !new RegExp(CLAUDE_AT_COMMAND.source).test(bare)) return cmd
  // so fora das aspas (o texto do prompt nao muda); "^" so vale no comeco da linha, nao logo depois de uma aspa
  return cmd.replace(/("[^"]*"|'[^']*')|([^"']+)/g, (_m, quoted: string | undefined, plain: string, at: number) =>
    quoted ?? plain.replace(CLAUDE_AT_COMMAND, (x, pre: string, name: string, i: number) => (i === 0 && !pre.trim() && at > 0 ? x : `${pre}${name} --permission-mode auto`)),
  )
}
