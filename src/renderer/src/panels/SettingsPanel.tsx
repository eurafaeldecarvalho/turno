import { useEffect, useState } from 'react'
import type { CursorStyle, Settings, ShellInfo, TerminalSettings } from '../../../shared/types'
import { THEMES, type Theme } from '../../../shared/themes'
import { updateSettings, useSettings } from '../appearance'
import { Switch } from './RoutineEditor'

const UI_FONTS = [
  { v: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif', l: 'Segoe UI (Windows)' },
  { v: 'Inter, "Segoe UI", system-ui, sans-serif', l: 'Inter' },
  { v: '"Geist", "Segoe UI", system-ui, sans-serif', l: 'Geist' },
  { v: 'system-ui, sans-serif', l: 'Fonte do sistema' },
]
const MONO_FONTS = [
  { v: '"Cascadia Mono", "Cascadia Code", Consolas, monospace', l: 'Cascadia Mono' },
  { v: '"Cascadia Code", Consolas, monospace', l: 'Cascadia Code (ligaduras)' },
  { v: '"JetBrains Mono", Consolas, monospace', l: 'JetBrains Mono' },
  { v: '"Fira Code", Consolas, monospace', l: 'Fira Code' },
  { v: '"Geist Mono", Consolas, monospace', l: 'Geist Mono' },
  { v: 'Consolas, monospace', l: 'Consolas' },
]
const CURSORS: Array<{ v: CursorStyle; l: string }> = [
  { v: 'block', l: 'bloco' },
  { v: 'bar', l: 'barra' },
  { v: 'underline', l: 'sublinhado' },
]

function ThemeCard({ t, active, onPick }: { t: Theme; active: boolean; onPick: () => void }) {
  const p = t.term
  return (
    <button className={`theme-card ${active ? 'on' : ''}`} onClick={onPick} aria-pressed={active}>
      <div className="theme-preview" style={{ background: t.ui.bg, borderColor: t.ui.border }}>
        <div className="tp-side" style={{ background: t.ui.surface, borderColor: t.ui.border }}>
          <span style={{ background: t.ui.accent }} />
          <span style={{ background: t.ui.faint }} />
          <span style={{ background: t.ui.faint }} />
        </div>
        <div className="tp-main" style={{ fontFamily: 'Consolas, monospace' }}>
          <div className="tp-line">
            <span style={{ color: p.green }}>❯</span> <span style={{ color: p.foreground }}>claude</span> <span style={{ color: p.blue }}>-p</span>
          </div>
          <div className="tp-swatches">
            {[p.red, p.green, p.yellow, p.blue, p.magenta, p.cyan].map((c, i) => (
              <i key={i} style={{ background: c }} />
            ))}
          </div>
        </div>
      </div>
      <span className="theme-name">{t.name}</span>
    </button>
  )
}

const MONO_HINT = /mono|code|consol|courier|cascadia|menlo|hack|iosevka|fira|jetbrains|nerd|terminal|fixed/i

function FontSelect({ value, options, onChange, system = [], fallback }: {
  value: string
  options: Array<{ v: string; l: string }>
  onChange: (v: string) => void
  system?: string[]
  fallback: string
}) {
  const sysOpts = system.map((f) => ({ v: `"${f}", ${fallback}`, l: f }))
  const known = options.some((o) => o.v === value) || sysOpts.some((o) => o.v === value)
  const [custom, setCustom] = useState(!known)
  return (
    <div className="row">
      <select
        value={custom ? '__custom' : value}
        onChange={(e) => {
          if (e.target.value === '__custom') return setCustom(true)
          setCustom(false)
          onChange(e.target.value)
        }}
      >
        <optgroup label="Sugeridas">
          {options.map((o) => (
            <option key={o.v} value={o.v}>{o.l}</option>
          ))}
        </optgroup>
        {sysOpts.length > 0 && (
          <optgroup label="Instaladas no Windows">
            {sysOpts.map((o) => (
              <option key={o.v} value={o.v}>{o.l}</option>
            ))}
          </optgroup>
        )}
        <option value="__custom">Outra…</option>
      </select>
      {custom && <input className="mono" defaultValue={value} placeholder='"Minha Fonte", monospace' onBlur={(e) => e.target.value && onChange(e.target.value)} />}
    </div>
  )
}

export function SettingsPanel() {
  const s = useSettings()
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [fonts, setFonts] = useState<string[]>([])
  useEffect(() => void window.turno.settings.fonts().then(setFonts), [])
  const [saved, setSaved] = useState(false)
  useEffect(() => void window.turno.settings.shells().then(setShells), [])
  if (!s) return <div className="panel-empty">Carregando…</div>

  const patch = async (p: Partial<Settings>): Promise<void> => {
    await updateSettings(p)
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }
  const term = (p: Partial<TerminalSettings>): Promise<void> => patch({ terminal: { ...s.terminal, ...p } })
  const t = s.terminal

  return (
    <div className="editor">
      <header className="editor-head">
        <div className="editor-title">
          <h2>Configurações</h2>
          <div className="editor-sub muted">{saved ? 'Salvo.' : 'As mudanças valem na hora.'}</div>
        </div>
      </header>
      <div className="editor-body">
        <section className="card grow">
          <h3>Tema</h3>
          <div className="theme-grid">
            {THEMES.map((th) => (
              <ThemeCard key={th.id} t={th} active={s.theme === th.id} onPick={() => void patch({ theme: th.id })} />
            ))}
          </div>
        </section>

        <section className="card">
          <h3>Interface</h3>
          <label className="field">
            <span>Fonte</span>
            <FontSelect value={s.uiFontFamily} options={UI_FONTS} system={fonts} fallback="system-ui, sans-serif" onChange={(v) => void patch({ uiFontFamily: v })} />
          </label>
          <label className="field">
            <span>Tamanho: {s.uiFontSize}px</span>
            <input type="range" min={11} max={16} step={0.5} value={s.uiFontSize} onChange={(e) => void patch({ uiFontSize: Number(e.target.value) })} />
          </label>
        </section>

        <section className="card">
          <h3>Terminal: fonte e cursor</h3>
          <label className="field">
            <span>Fonte</span>
            <FontSelect value={t.fontFamily} options={MONO_FONTS} system={fonts.filter((f) => MONO_HINT.test(f))} fallback="Consolas, monospace" onChange={(v) => void term({ fontFamily: v })} />
          </label>
          <div className="grid3">
            <label className="field">
              <span>Tamanho</span>
              <input type="number" min={8} max={28} value={t.fontSize} onChange={(e) => void term({ fontSize: Number(e.target.value) || 13 })} />
            </label>
            <label className="field">
              <span>Altura da linha</span>
              <input type="number" min={1} max={2} step={0.05} value={t.lineHeight} onChange={(e) => void term({ lineHeight: Number(e.target.value) || 1.2 })} />
            </label>
            <label className="field">
              <span>Espaçamento</span>
              <input type="number" min={-2} max={4} step={0.5} value={t.letterSpacing} onChange={(e) => void term({ letterSpacing: Number(e.target.value) })} />
            </label>
          </div>
          <div className="field">
            <span>Peso</span>
            <div className="seg small">
              {(['normal', '500', '600'] as const).map((w) => (
                <button key={w} className={t.fontWeight === w ? 'on' : ''} onClick={() => void term({ fontWeight: w })}>
                  {w === 'normal' ? 'normal' : w}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Cursor</span>
            <div className="row">
              <div className="seg small">
                {CURSORS.map((c) => (
                  <button key={c.v} className={t.cursorStyle === c.v ? 'on' : ''} onClick={() => void term({ cursorStyle: c.v })}>
                    {c.l}
                  </button>
                ))}
              </div>
              <label className="row small muted">
                <Switch checked={t.cursorBlink} onChange={(v) => void term({ cursorBlink: v })} /> piscar
              </label>
            </div>
          </div>
          <div className="term-sample" style={{ fontFamily: t.fontFamily, fontSize: t.fontSize, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing, fontWeight: t.fontWeight as never }}>
            PS C:\rotinas&gt; claude -p "resuma o dia" <span className="cursor-demo" data-style={t.cursorStyle} />
          </div>
        </section>

        <section className="card">
          <h3>Terminal: comportamento</h3>
          <label className="field">
            <span>Shell padrão</span>
            <select value={t.defaultShell} onChange={(e) => void term({ defaultShell: e.target.value })}>
              {!shells.some((x) => x.path === t.defaultShell) && <option value={t.defaultShell}>{t.defaultShell}</option>}
              {shells.map((sh) => (
                <option key={sh.id} value={sh.path}>{sh.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Histórico (linhas de scrollback)</span>
            <input type="number" min={1000} max={100000} step={1000} value={t.scrollback} onChange={(e) => void term({ scrollback: Number(e.target.value) || 10000 })} />
          </label>
          <label className="field toggle-field">
            <span>Copiar ao selecionar</span>
            <Switch checked={t.copyOnSelect} onChange={(v) => void term({ copyOnSelect: v })} />
          </label>
          <label className="field toggle-field">
            <span>Botão direito copia/cola</span>
            <Switch checked={t.rightClickPaste} onChange={(v) => void term({ rightClickPaste: v })} />
          </label>
          <small className="muted">Ctrl+Shift+C / Ctrl+Shift+V sempre copiam e colam.</small>
        </section>

        <section className="card">
          <h3>Geral</h3>
          <label className="field toggle-field">
            <span>Iniciar com o Windows (fica na bandeja, sem abrir janela)</span>
            <Switch checked={s.openAtLogin} onChange={(v) => void patch({ openAtLogin: v })} />
          </label>
          <label className="field">
            <span>Pasta das rotinas (uma subpasta com ROUTINE.md por rotina)</span>
            <div className="row">
              <input className="mono grow" defaultValue={s.routinesDir} onBlur={(e) => e.target.value !== s.routinesDir && void patch({ routinesDir: e.target.value })} />
              <button className="btn" onClick={() => void window.turno.routines.openFolder()}>Abrir</button>
            </div>
          </label>
        </section>

        <section className="card">
          <h3>Notificações no celular (ntfy)</h3>
          <p className="muted small">
            Instale o app ntfy no celular e assine um tópico com nome longo e difícil de adivinhar. Sem tópico, só aparecem os avisos do Windows.
          </p>
          <div className="grid2">
            <label className="field">
              <span>Servidor</span>
              <input defaultValue={s.ntfyServer} onBlur={(e) => void patch({ ntfyServer: e.target.value })} />
            </label>
            <label className="field">
              <span>Tópico</span>
              <input className="mono" defaultValue={s.ntfyTopic} placeholder="turno-8f3k2x9q…" onBlur={(e) => void patch({ ntfyTopic: e.target.value.trim() })} />
            </label>
          </div>
          <div>
            <button className="btn" onClick={() => void window.turno.settings.testNotify()}>Enviar notificação de teste</button>
          </div>
        </section>
      </div>
    </div>
  )
}
