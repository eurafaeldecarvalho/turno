// Novidades por versao (mais nova primeiro). A tela "What's new" mostra as versoes que o usuario ainda nao viu.
// Ao lancar uma versao, adicione uma entrada aqui com o que muda para quem USA o app (nao detalhes internos).
export interface ReleaseNotes {
  version: string
  items: Array<{ title: string; text: string }>
}

export const WHATS_NEW: ReleaseNotes[] = [
  {
    version: '0.7.3',
    items: [
      { title: 'A quick tour', text: 'New installs get a short setup: agents, look and terminal, routines, running in the background and notifications. Reopen it any time from Settings.' },
      { title: "What's new", text: 'After each update, this screen lists what changed.' },
    ],
  },
  {
    version: '0.7.2',
    items: [
      { title: 'Local model follows your settings', text: 'Qwen terminals and items use the model set in Settings › Connections instead of a fixed one.' },
      { title: 'Finer window opacity', text: 'Adjust it in 0.1% steps or type the exact percentage.' },
    ],
  },
  {
    version: '0.7.1',
    items: [
      { title: 'Draggable dialogs', text: 'Move any dialog by its top edge. Dialogs open below the title bar, and window opacity only applies to the main screen.' },
      { title: 'Cleaner sidebar', text: 'Routines show only their schedule; open tabs and folder items show agent · model · effort.' },
    ],
  },
]

const parts = (v: string): number[] => v.split('.').map((n) => Number(n) || 0)
export const newerThan = (a: string, b: string): boolean => {
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

// Notas que o usuario ainda nao viu (ate a versao instalada). seen vazio = so a versao atual.
export function unseenNotes(seen: string, current: string): ReleaseNotes[] {
  return WHATS_NEW.filter((r) => !newerThan(r.version, current) && (seen ? newerThan(r.version, seen) : r.version === current)).slice(0, 3)
}
