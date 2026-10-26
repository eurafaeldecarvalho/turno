import { describe, it, expect } from 'vitest'
import { evaluateThresholds, matchedRateLimit, policiesFromConfig, parseProviderLimit, parseRateLimit, priorCost, type AbortPolicy } from '../abort'

describe('evaluateThresholds', () => {
  const m = { costUsd: 0.2, steps: 10, durationMin: 5 }
  it('sem policies nunca aborta', () => {
    expect(evaluateThresholds(m, []).abort).toBe(false)
  })
  it('cost_usd estourado aborta', () => {
    expect(evaluateThresholds(m, [{ kind: 'cost_usd', limit: 0.1 }]).abort).toBe(true)
  })
  it('cost_usd sob o teto nao aborta', () => {
    expect(evaluateThresholds(m, [{ kind: 'cost_usd', limit: 1 }]).abort).toBe(false)
  })
  it('steps estourado aborta', () => {
    expect(evaluateThresholds(m, [{ kind: 'steps', limit: 5 }]).abort).toBe(true)
  })
  it('duration_min estourado aborta', () => {
    expect(evaluateThresholds(m, [{ kind: 'duration_min', limit: 3 }]).abort).toBe(true)
  })
  it('policies de rate-limit NAO sao threshold (ignoradas aqui)', () => {
    expect(evaluateThresholds(m, [{ kind: 'session_limit' }, { kind: 'weekly_limit' }]).abort).toBe(false)
  })
})

describe('matchedRateLimit', () => {
  const pols: AbortPolicy[] = [{ kind: 'session_limit' }]
  it('five_hour casa session_limit quando habilitada', () => {
    expect(matchedRateLimit('five_hour', pols)).toBe('session_limit')
  })
  it('seven_day sem weekly_limit habilitada -> undefined', () => {
    expect(matchedRateLimit('seven_day', pols)).toBeUndefined()
  })
  it('tipo desconhecido -> undefined', () => {
    expect(matchedRateLimit('monthly', [{ kind: 'session_limit' }, { kind: 'weekly_limit' }])).toBeUndefined()
  })
  it('seven_day casa weekly_limit quando habilitada', () => {
    expect(matchedRateLimit('seven_day', [{ kind: 'weekly_limit' }])).toBe('weekly_limit')
  })
})

describe('parseRateLimit (so pausa quando REJECTED)', () => {
  const rejected = '{"type":"system","rate_limit_info":{"status":"rejected","resetsAt":1790012400,"rateLimitType":"five_hour","overageStatus":"rejected"}}'
  const allowed = '{"type":"system","rate_limit_info":{"status":"allowed","resetsAt":1790012400,"rateLimitType":"five_hour"}}'
  const flat = '{"status":"rejected","resetsAt":1790012400,"rateLimitType":"seven_day"}'

  it('status rejected -> rejected:true + tipo + resetsAt', () => {
    expect(parseRateLimit(rejected)).toMatchObject({ rateLimitType: 'five_hour', resetsAt: 1790012400, rejected: true, status: 'rejected' })
  })
  it('status allowed -> rejected:false (NAO pausa)', () => {
    expect(parseRateLimit(allowed)?.rejected).toBe(false)
  })
  it('acha o objeto mesmo no topo (plano)', () => {
    expect(parseRateLimit(flat)).toMatchObject({ rateLimitType: 'seven_day', rejected: true })
  })
  it('linha sem rateLimitType -> undefined', () => {
    expect(parseRateLimit('{"type":"result","total_cost_usd":0.1}')).toBeUndefined()
  })
  it('linha nao-JSON com o texto -> undefined (nao quebra)', () => {
    expect(parseRateLimit('bla "rateLimitType" bla')).toBeUndefined()
  })
})

describe('priorCost (custo cumulativo pela thread p/ nao reiniciar teto no resume)', () => {
  it('soma cost_usd dos segmentos (ignora null)', () => {
    expect(priorCost([{ cost_usd: 1.5 }, { cost_usd: null }, { cost_usd: 2 }])).toBe(3.5)
  })
  it('thread vazia = 0', () => {
    expect(priorCost([])).toBe(0)
  })
})

describe('policiesFromConfig (compat budget_usd)', () => {
  it('budget_usd vira policy cost_usd', () => {
    const p = policiesFromConfig({ budget_usd: 0.5, abort: [] })
    expect(p).toContainEqual({ kind: 'cost_usd', limit: 0.5 })
  })
  it('nao duplica cost_usd se ja houver no abort', () => {
    const p = policiesFromConfig({ budget_usd: 0.5, abort: [{ kind: 'cost_usd', limit: 0.9 }] })
    expect(p.filter((x) => x.kind === 'cost_usd')).toHaveLength(1)
    expect(p.find((x) => x.kind === 'cost_usd')).toEqual({ kind: 'cost_usd', limit: 0.9 })
  })
  it('sem budget nem abort -> vazio', () => {
    expect(policiesFromConfig({})).toEqual([])
  })
})

describe('parseProviderLimit (conexao de API sem cota: linhas reais do claude -p)', () => {
  const r = (status: number, text: string) =>
    JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: status, terminal_reason: 'api_error', result: text, session_id: 's' })
  it('deveDetectarLimiteQuando429', () => {
    expect(parseProviderLimit(r(429, 'API Error: Request rejected (429) · You are using a Trial key, which is limited to 1000 API calls / month'))).toEqual({ kind: 'limit', message: 'API Error: Request rejected (429) · You are using a Trial key, which is limited to 1000 API calls / month' })
  })
  it('deveDetectarSemCreditoQuando402', () => {
    expect(parseProviderLimit(r(402, 'API Error: 402 Insufficient credits'))?.kind).toBe('credits')
  })
  it('naoDeveTirarContaPorErroTemporarioDoServidor', () => {
    expect(parseProviderLimit(r(500, 'API Error: 500 boom'))).toBeUndefined()
  })
  it('naoDeveConfundirResultadoDeSucessoOuOutraLinha', () => {
    expect(parseProviderLimit(JSON.stringify({ type: 'result', is_error: false, result: 'ok 429' }))).toBeUndefined()
    expect(parseProviderLimit('{"type":"assistant","message":{"content":[{"type":"text","text":"api_error_status 429"}]}}')).toBeUndefined()
    expect(parseProviderLimit('nao e json "api_error_status":429')).toBeUndefined()
  })
})
