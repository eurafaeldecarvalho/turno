import { useEffect, useState } from 'react'

// Campo de lista (tools uma por linha, locks separados por virgula) que deixa digitar livremente:
// guarda o texto cru e so converte em lista por baixo. Antes o campo era refeito a cada tecla a partir
// da lista ja limpa, e espaco/virgula/Enter no fim do texto sumiam ("Bash(git log:*)" virava "Bash(gitlog:*)").
export function ListInput({ value, onChange, separator, multiline, ...rest }: {
  value: string[]
  onChange: (v: string[]) => void
  separator: '\n' | ','
  multiline?: boolean
  placeholder?: string
  rows?: number
  className?: string
}) {
  const join = (v: string[]): string => v.join(separator === ',' ? ', ' : '\n')
  const [text, setText] = useState(join(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(join(value))
  }, [value.join('\u0000'), focused])
  const parse = (t: string): string[] => t.split(separator).map((s) => s.trim()).filter(Boolean)
  const props = {
    spellCheck: false,
    ...rest,
    value: text,
    onFocus: () => setFocused(true),
    onBlur: () => (setFocused(false), setText(join(parse(text)))),
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value)
      onChange(parse(e.target.value))
    },
  }
  return multiline ? <textarea {...props} /> : <input {...props} />
}
