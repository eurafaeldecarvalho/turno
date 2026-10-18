// Travas nomeadas em memoria (ex.: "chrome", "gpu"). Uma rotina so roda com todas as suas travas.
const holders = new Map<string, string>() // trava -> runId
const waiters = new Set<() => void>()

export function tryAcquire(names: string[], holder: string): string | undefined {
  const busy = names.find((n) => holders.has(n) && holders.get(n) !== holder)
  if (busy) return `${busy} (com ${holders.get(busy)})`
  for (const n of names) holders.set(n, holder)
  return undefined
}

export function release(holder: string): void {
  let changed = false
  for (const [n, h] of holders) if (h === holder) (holders.delete(n), (changed = true))
  if (changed) for (const w of [...waiters]) w()
}

// Espera ate conseguir todas as travas ou estourar o prazo; devolve o motivo se nao conseguiu.
export function acquireWait(names: string[], holder: string, timeoutMs: number): Promise<string | undefined> {
  const first = tryAcquire(names, holder)
  if (!first) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    let last = first
    const tryNow = (): void => {
      const busy = tryAcquire(names, holder)
      if (busy) return void (last = busy)
      done(undefined)
    }
    const timer = setTimeout(() => done(`trava ocupada: ${last}`), timeoutMs)
    function done(reason: string | undefined): void {
      clearTimeout(timer)
      waiters.delete(tryNow)
      resolve(reason)
    }
    waiters.add(tryNow)
  })
}

export function listLocks(): Array<{ name: string; holder: string }> {
  return [...holders].map(([name, holder]) => ({ name, holder }))
}
