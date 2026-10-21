import { useEffect, useState, type InputHTMLAttributes } from 'react'

// Campo numerico que deixa apagar e redigitar: guarda o texto enquanto digita, so salva numeros validos
// e, ao sair do campo, aplica min/max (ou volta ao valor salvo se ficou vazio/invalido).
// Antes, `Number(v) || 1` trocava o campo vazio por 1 no meio da digitacao ("45" virava "145").
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: number | undefined // undefined = campo vazio (ex. limite desligado)
  onChange: (v: number) => void
  min?: number
  max?: number
  integer?: boolean // so inteiros: decimal fica marcado como invalido e e arredondado ao sair
}

export function NumInput({ value, onChange, min, max, integer, onBlur, onFocus, ...rest }: Props) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(value === undefined ? '' : String(value))
  }, [value, focused])
  const clamp = (n: number): number => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, integer ? Math.round(n) : n))
  return (
    <input
      {...rest}
      type="number"
      step={integer ? 1 : rest.step}
      min={min}
      max={max}
      value={text}
      aria-invalid={(text.trim() !== '' && Number.isFinite(Number(text)) && Number(text) !== clamp(Number(text))) || rest['aria-invalid'] ? true : undefined}
      title={min !== undefined || max !== undefined ? `${min ?? '…'} – ${max ?? '…'}` : undefined}
      onFocus={(e) => (setFocused(true), onFocus?.(e))}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n === clamp(n)) onChange(n)
      }}
      onBlur={(e) => {
        setFocused(false)
        const n = Number(text)
        const ok = text.trim() !== '' && Number.isFinite(n)
        const v = ok ? clamp(n) : value
        if (v !== undefined && v !== value) onChange(v)
        setText(v === undefined ? '' : String(v))
        onBlur?.(e)
      }}
    />
  )
}
