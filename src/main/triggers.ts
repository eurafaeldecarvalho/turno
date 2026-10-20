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
