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
  // Chamada interna do Turno: sem os MCPs e hooks do usuario (custo e seguranca); se uma politica da empresa
  // recusar o --strict-mcp-config, tenta de novo sem ele (padrao do Orca).
  const base = ['-p', ...(model ? ['--model', model] : []), '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--settings', '{"disableAllHooks":true}']
  const env = childEnv({ ...resolveProviderEnv(conn, connectionToken(conn)) })
  const run = (extra: string[]): Promise<{ err: Error | null; out: string }> =>
    new Promise((res) =>
      execFile('claude', [...base, ...extra, buildNlPrompt(ctx)], { env, timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => res({ err, out: String(out ?? '') })),
    )
  return run(['--strict-mcp-config']).then(async (r) => {
    if (r.err && !r.out) r = await run([])
    if (r.err && !r.out) return { command: null, explanation: `erro ao consultar: ${r.err.message}` }
    return parseSuggestion(r.out)
  })
}
