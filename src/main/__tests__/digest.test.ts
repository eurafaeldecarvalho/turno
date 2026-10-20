import { describe, it, expect } from 'vitest'
import { buildDigest } from '../digest'
import type { RunRecord } from '../../shared/types'

const run = (over: Partial<RunRecord>): RunRecord => ({
  id: 'id', routine: 'r1', trigger: 'cron', status: 'ok',
  scheduled_at: null, started_at: '2026-10-20T08:00:00.000Z', ended_at: null,
  skip_reason: null, exit_code: 0, cost_usd: null, session_id: null,
  result: null, profile: 'claude-max', model: null, cwd: null, parent_id: null,
  ...over,
})

const from = new Date('2026-10-20T00:00:00.000Z')
const to = new Date('2026-10-20T23:59:59.000Z')

describe('buildDigest', () => {
  it('agrupa por rotina com ok/failed e soma de custo', () => {
    const d = buildDigest(
      [
        run({ routine: 'r1', status: 'ok', cost_usd: 0.1 }),
        run({ routine: 'r1', status: 'failed', cost_usd: 0.2 }),
        run({ routine: 'r2', status: 'ok', cost_usd: null }),
      ],
      from, to,
    )
    expect(d.total).toBe(3)
    const r1 = d.routines.find((x) => x.routine === 'r1')!
    expect(r1).toMatchObject({ total: 2, ok: 1, failed: 1 })
    expect(r1.costUsd).toBeCloseTo(0.3)
  })

  it('a janela exclui runs de fora do periodo', () => {
    const d = buildDigest([run({ started_at: '2026-10-19T08:00:00.000Z' })], from, to)
    expect(d.total).toBe(0)
    expect(d.empty).toBe(true)
  })

  it('runs em andamento nao contam como failed', () => {
    const d = buildDigest([run({ status: 'running' }), run({ status: 'queued' })], from, to)
    expect(d.routines[0]).toMatchObject({ total: 2, ok: 0, failed: 0 })
  })

  it('sem runs: digest vazio', () => {
    const d = buildDigest([], from, to)
    expect(d.empty).toBe(true)
    expect(d.routines).toEqual([])
  })
})
