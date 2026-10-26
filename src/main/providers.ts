import type { Connection } from '../shared/types'
import { translatorBase, translatorInfo } from './translator'

// Provedores semeados por padrao. Viram dados editaveis em settings.json; nada aqui e hardcode de codigo.
// 'claude-max' = login do CLI. 'qwen-local' = preset de endpoint Ollama (editavel/removivel pelo usuario).
export const DEFAULT_CONNECTIONS: Connection[] = [
  { id: 'claude-max', name: 'Claude (assinatura)', kind: 'claude' },
  {
    id: 'qwen-local',
    name: 'Ollama (local)',
    kind: 'endpoint',
    baseUrl: 'http://localhost:11434',
    token: 'ollama',
    model: 'qwen3:14b', // so instalacoes novas; o settings.json existente continua valendo
    bootCommand: 'ollama serve',
    healthUrl: 'http://localhost:11434/api/version',
    extraEnv: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '131072' },
  },
]

// Endpoint que e a API da propria Anthropic (chave de API, cobrada por uso), nao um provedor compativel.
export const isAnthropicApi = (conn: Connection, token?: string): boolean =>
  conn.kind === 'endpoint' && conn.via !== 'translate' && (/^https?:\/\/api\.anthropic\.com(\/|:|$)/i.test(conn.baseUrl ?? '') || /^sk-ant-api/.test(token ?? conn.token ?? ''))

// Env que o binario `claude` recebe para falar com este provedor.
// claude = sem env (auth e do proprio CLI). endpoint = aponta o CLI para o baseUrl/model/token.
export function resolveProviderEnv(conn: Connection, token?: string): Record<string, string> {
  if (conn.kind === 'claude') return { ...(conn.extraEnv ?? {}) }
  // via tradutor: o CLI recebe so o endereco local e o token da sessao do tradutor; a chave do provedor fica no main
  const tr = conn.via === 'translate'
  // a API da propria Anthropic so aceita a chave em x-api-key (ANTHROPIC_API_KEY); compativeis (z.ai etc.) usam Bearer
  const apiKeyStyle = isAnthropicApi(conn, token)
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: tr ? translatorBase(conn.id) : (conn.baseUrl ?? ''),
    ANTHROPIC_AUTH_TOKEN: tr || apiKeyStyle ? (tr ? translatorInfo().token : '') : (token ?? conn.token ?? ''),
    ANTHROPIC_API_KEY: apiKeyStyle ? (token ?? conn.token ?? '') : '',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    API_TIMEOUT_MS: '1800000',
  }
  const model = conn.model
  if (model) {
    env.ANTHROPIC_MODEL = model
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = model
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = model
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model
    env.CLAUDE_CODE_SUBAGENT_MODEL = model
  }
  return { ...env, ...(conn.extraEnv ?? {}) }
}

// Modelo efetivo passado em --model: endpoint usa o model do provedor; claude usa o do request.
export function effectiveModel(conn: Connection, reqModel?: string): string | undefined {
  return conn.kind === 'endpoint' ? (conn.model ?? reqModel) : reqModel
}

// Busca estrita: devolve undefined para id desconhecido (sem fallback). Use quando rodar no provedor
// errado custaria dinheiro silenciosamente (ex. rotina cujo profile foi removido) — o chamador deve PULAR.
export function findConnection(settings: { connections?: Connection[] }, id: string): Connection | undefined {
  return (settings.connections ?? []).find((c) => c.id === id)
}

// Resolve o id com fallback tolerante (primeira connection; senao o claude semeado). Para caminhos nao
// criticos (terminal interativo, exibicao). Para DISPARAR qualquer run, use requireConnection.
export function getConnection(settings: { connections?: Connection[] }, id: string): Connection {
  const list = settings.connections ?? []
  return findConnection(settings, id) ?? list[0] ?? DEFAULT_CONNECTIONS[0]
}

// Guard central de execucao: id desconhecido LANCA em vez de cair no provedor (pago) do fallback.
// Usado por startRun, entao cobre runRoutine, followUp E adhoc de uma vez. Dinheiro > conveniencia.
export function requireConnection(settings: { connections?: Connection[] }, id: string): Connection {
  const c = findConnection(settings, id)
  if (!c) throw new Error(`connection "${id}" doesn't exist anymore; pick one in Settings › Connections or in the routine`)
  return c
}

// Provedor em que a run roda de fato: a conta escolhida no ranking pode ser uma conexao de API (Cohere, OpenRouter...)
// e ai o modelo, o env e o "cobrado por uso" vem dela. Conexao removida LANCA: nunca cai na assinatura em silencio.
export function runConnection(base: Connection, account: { connection?: string } | undefined, conns: Connection[]): Connection {
  if (!account?.connection) return base
  const c = conns.find((x) => x.id === account.connection)
  if (!c) throw new Error(`connection "${account.connection}" doesn't exist anymore; pick another account in Settings › Agents & accounts`)
  return c
}
