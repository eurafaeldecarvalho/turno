// Gatilhos de evento local (file-watch, on-fail). A parte pura e testavel; o fs.watch e ligado no engine.

// Coalesce chamadas em rajada num unico disparo apos `ms` de silencio.
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...a: A): void => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}

// Gatilho "quando o comando falhar": dispara so quando o processo sai com codigo != 0.
export function shouldFireOnExit(code: number | null): boolean {
  return code != null && code !== 0
}

// Decide se um gatilho file-watch deve ser IGNORADO, dada a ultima run da rotina.
// - sem run anterior: nao pula.
// - ultima run NAO-terminal (ended_at null: queued/running/PAUSED): pula (nunca inicia outra em cima).
// - ultima run terminou dentro do cooldown: pula (evita loop quando a propria run escreve no path observado).
export function watchShouldSkip(last: { ended_at: string | null } | undefined, nowMs: number, cooldownMs: number): boolean {
  if (!last) return false
  if (!last.ended_at) return true
  return nowMs - Date.parse(last.ended_at) < cooldownMs
}
