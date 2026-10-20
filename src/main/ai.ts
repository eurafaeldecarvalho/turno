import { execFile } from 'node:child_process'
import { buildNlPrompt, parseSuggestion, type NlContext, type Suggestion } from './nl'
import { effectiveModel, requireConnection, resolveProviderEnv } from './providers'
import { getSettings } from './settings'
import { connectionToken } from './secrets'
import { childEnv } from './env'

// NL -> comando: roda o `claude` em one-shot (modo print) com o provedor escolhido e devolve a sugestao parseada.
// So GERA texto: '--permission-prompts none' sem allowlist = TODA ferramenta negada (o prompt vem com o output
// do terminal embutido = entrada potencialmente hostil; sem isso, prompt-injection poderia executar ferramenta).
// O usuario decide Executar depois, no terminal.
export function suggestCommand(connId: string, ctx: NlContext): Promise<Suggestion> {
  let conn
  try {
    conn = requireConnection(getSettings(), connId)
  } catch (e) {
    return Promise.resolve({ command: null, explanation: String((e as Error).message) })
  }
  const model = effectiveModel(conn, undefined)
  const args = ['-p', ...(model ? ['--model', model] : []), '--permission-mode', 'dontAsk', '--permission-prompts', 'none', buildNlPrompt(ctx)]
  const env = childEnv({ ...resolveProviderEnv(conn, connectionToken(conn)) })
  return new Promise((res) => {
    execFile('claude', args, { env, timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err && !out) return res({ command: null, explanation: `erro ao consultar: ${err.message}` })
      res(parseSuggestion(out))
    })
  })
}
