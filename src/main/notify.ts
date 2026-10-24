import { Notification, BrowserWindow } from 'electron'
import { getSettings } from './settings'

const recent = new Map<string, number>()
const COOLDOWN_MS = 5000

// Nao avisa se voce ja esta olhando para o app, e nao repete o mesmo aviso em 5 s.
export async function notify(title: string, body: string, onClick?: () => void, opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force) {
    if (BrowserWindow.getFocusedWindow()) return
    const now = Date.now()
    if (now - (recent.get(title) ?? 0) < COOLDOWN_MS) return
    recent.set(title, now)
    if (recent.size > 50) recent.delete(recent.keys().next().value!)
  }
  if (Notification.isSupported()) {
    const n = new Notification({ title, body: body.slice(0, 250) })
    if (onClick) n.on('click', onClick)
    n.show()
  }
  const { ntfyTopic, ntfyServer } = getSettings()
  if (!ntfyTopic) return
  try {
    const res = await fetch(`${ntfyServer.replace(/\/$/, '')}/${encodeURIComponent(ntfyTopic)}`, {
      method: 'POST',
      // Cabecalhos HTTP so aceitam latin1: o titulo vai sem acentos problematicos.
      headers: { Title: title.normalize('NFD').replace(/[^\x20-\x7e]/g, ''), Tags: 'robot' },
      body: body.slice(0, 2000),
    })
    if (!res.ok) console.warn(`[ntfy] ${res.status} ${res.statusText} from ${ntfyServer}`)
  } catch (e) {
    console.warn('[ntfy] send failed:', (e as Error).message) // sem internet ou servidor invalido; o toast local ja foi mostrado
  }
}
