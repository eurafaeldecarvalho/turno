import { DatabaseSync } from 'node:sqlite'
import type { RunRecord, RunStatus, RunTrigger } from '../shared/types'

let db: DatabaseSync

const MIGRATIONS = [
  `CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    routine TEXT,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    scheduled_at TEXT,
    started_at TEXT,
    ended_at TEXT,
    skip_reason TEXT,
    exit_code INTEGER,
    cost_usd REAL,
    session_id TEXT,
    result TEXT,
    profile TEXT NOT NULL,
    model TEXT,
    cwd TEXT
  );
  CREATE INDEX runs_routine ON runs(routine, started_at);
  CREATE INDEX runs_sched ON runs(routine, scheduled_at);`,
  `CREATE TABLE routine_state (routine TEXT PRIMARY KEY, armed_at TEXT);`,
  `ALTER TABLE runs ADD COLUMN parent_id TEXT;`,
  `ALTER TABLE runs ADD COLUMN resume_at TEXT;`,
  `UPDATE runs SET status='aborted' WHERE status='over_budget';`,
]

export function openDb(file: string): void {
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN')
    db.exec(MIGRATIONS[i])
    db.exec(`PRAGMA user_version = ${i + 1}`)
    db.exec('COMMIT')
  }
  // Runs que estavam "rodando" quando o app caiu nao vao terminar mais.
  db.prepare(
    `UPDATE runs SET status='failed', ended_at=COALESCE(ended_at, ?), skip_reason='app closed during the run'
     WHERE status IN ('running','queued')`,
  ).run(new Date().toISOString())
}

export function insertRun(r: {
  id: string
  routine: string | null
  trigger: RunTrigger
  status: RunStatus
  scheduled_at?: string | null
  profile: string
  model?: string | null
  cwd?: string | null
  skip_reason?: string | null
  parent_id?: string | null
}): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO runs (id, routine, trigger, status, scheduled_at, started_at, ended_at, skip_reason, profile, model, cwd, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.id,
    r.routine,
    r.trigger,
    r.status,
    r.scheduled_at ?? null,
    r.status === 'skipped' ? null : now,
    r.status === 'skipped' ? now : null,
    r.skip_reason ?? null,
    r.profile,
    r.model ?? null,
    r.cwd ?? null,
    r.parent_id ?? null,
  )
}

const UPDATABLE = ['status', 'started_at', 'ended_at', 'skip_reason', 'exit_code', 'cost_usd', 'session_id', 'result', 'resume_at', 'cwd'] as const
type Patch = Partial<Pick<RunRecord, (typeof UPDATABLE)[number]>>

export function updateRun(id: string, patch: Patch): void {
  const keys = Object.keys(patch).filter((k) => (UPDATABLE as readonly string[]).includes(k)) as Array<keyof Patch>
  if (!keys.length) return
  db.prepare(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => (patch[k] ?? null) as string | number | null),
    id,
  )
}

export function getRun(id: string): RunRecord | undefined {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRecord | undefined
}

export function listRuns(routine?: string, limit = 200): RunRecord[] {
  const sql = routine
    ? 'SELECT * FROM runs WHERE routine = ? ORDER BY COALESCE(started_at, ended_at) DESC LIMIT ?'
    : 'SELECT * FROM runs ORDER BY COALESCE(started_at, ended_at) DESC LIMIT ?'
  const stmt = db.prepare(sql)
  return (routine ? stmt.all(routine, limit) : stmt.all(limit)) as unknown as RunRecord[]
}

export function lastRuns(): Map<string, RunRecord> {
  const rows = db
    .prepare(
      `SELECT r.* FROM runs r JOIN (
         SELECT routine, MAX(COALESCE(started_at, ended_at)) t FROM runs WHERE routine IS NOT NULL GROUP BY routine
       ) x ON x.routine = r.routine AND COALESCE(r.started_at, r.ended_at) = x.t`,
    )
    .all() as unknown as RunRecord[]
  return new Map(rows.map((r) => [r.routine!, r]))
}

// Ja existe execucao (ou skip) registrada para este horario agendado?
export function hasRunFor(routine: string, scheduledAt: string): boolean {
  return !!db.prepare('SELECT 1 FROM runs WHERE routine = ? AND scheduled_at = ? LIMIT 1').get(routine, scheduledAt)
}

export function lastScheduledAt(routine: string): string | undefined {
  const r = db.prepare('SELECT MAX(scheduled_at) s FROM runs WHERE routine = ?').get(routine) as { s: string | null }
  return r?.s ?? undefined
}

// Runs pausadas cujo reset do limite ja passou: prontas pra retomar.
export function duePausedRuns(nowIso: string): RunRecord[] {
  return db.prepare("SELECT * FROM runs WHERE status = 'paused' AND resume_at IS NOT NULL AND resume_at <= ? ORDER BY resume_at").all(nowIso) as unknown as RunRecord[]
}

export function getArmedAt(routine: string): string | undefined {
  const r = db.prepare('SELECT armed_at FROM routine_state WHERE routine = ?').get(routine) as { armed_at: string } | undefined
  return r?.armed_at ?? undefined
}

export function setArmed(routine: string, at: string | null): void {
  if (at === null) db.prepare('DELETE FROM routine_state WHERE routine = ?').run(routine)
  else db.prepare('INSERT OR REPLACE INTO routine_state (routine, armed_at) VALUES (?, ?)').run(routine, at)
}

// Conversa inteira: sobe pelos parent_id ate a run original.
export function threadOf(runId: string): RunRecord[] {
  const out: RunRecord[] = []
  let cur = getRun(runId)
  while (cur && out.length < 50) {
    out.unshift(cur)
    cur = cur.parent_id ? getRun(cur.parent_id) : undefined
  }
  return out
}

// Mantem as ultimas `keep` execucoes terminadas de cada rotina. Devolve os ids apagados.
export function pruneRuns(routine: string, keep = 200): string[] {
  const old = db
    .prepare(
      `SELECT id FROM runs WHERE routine = ? AND status NOT IN ('running','queued')
       AND NOT (status = 'paused' AND resume_at IS NOT NULL)
       ORDER BY COALESCE(started_at, ended_at) DESC LIMIT -1 OFFSET ?`,
    )
    .all(routine, keep) as Array<{ id: string }>
  const del = db.prepare('DELETE FROM runs WHERE id = ?')
  for (const r of old) del.run(r.id)
  return old.map((r) => r.id)
}

// Pasta da rotina renomeada: runs e estado do agendador passam para o id novo (senao o historico vira "(removed)").
export function renameRoutineRuns(from: string, to: string): void {
  db.prepare('UPDATE runs SET routine = ? WHERE routine = ?').run(to, from)
  db.prepare('UPDATE OR REPLACE routine_state SET routine = ? WHERE routine = ?').run(to, from)
}
