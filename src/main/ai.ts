import { execFile } from 'node:child_process'
import { buildNlPrompt, parseSuggestion, type NlContext, type Suggestion } from './nl'
import { effectiveModel, getConnection, resolveProviderEnv } from './providers'
import { getSettings } from './settings'
import { connectionToken } from './secrets'
import { childEnv } from './env'

// NL -> comando: roda o `claude` em one-shot (modo print) com o provedor escolhido e devolve a sugestao parseada.
// O usuario sempre decide Executar; aqui so geramos o texto.
export function suggestCommand(connId: string, ctx: NlContext): Promise<Suggestion> {
  const conn = getConnection(getSettings(), connId)
  const model = effectiveModel(conn, undefined)
  const args = ['-p', ...(model ? ['--model', model] : []), '--permission-mode', 'dontAsk', buildNlPrompt(ctx)]
  const env = childEnv({ ...resolveProviderEnv(conn, connectionToken(conn)) })
  return new Promise((res) => {
    execFile('claude', args, { env, timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err && !out) return res({ command: null, explanation: `erro ao consultar: ${err.message}` })
      res(parseSuggestion(out))
    })
  })
}
