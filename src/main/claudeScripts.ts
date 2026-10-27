// Scripts que o Claude Code roda nas abas do Turno: statusline (rodape + uso 5h/7d) e hooks (status da aba, troca de
// conta). Mandam o JSON do Claude ao servidor local do Turno (token na env). Inertes fora do Turno (sem TURNO_HOOK_PORT).
// Linux/macOS: sh + curl. Windows: PowerShell (vem em todo Windows 10/11); Git Bash e opcional no Windows, e sem ele o
// `sh` nao existe: rodape, bolinhas de status e troca de conta paravam (code.claude.com/docs/en/hooks).

const SH_GUARD = '[ -z "$TURNO_HOOK_PORT" ] && { cat >/dev/null; exit 0; }'

const HOOK_SH = ['#!/bin/sh', SH_GUARD, 'p=$(cat)', 'printf \'%s\' "$p" | curl -s -m 3 -H "x-turno-token: $TURNO_HOOK_TOKEN" --data-binary @- "http://127.0.0.1:$TURNO_HOOK_PORT/hook/$TURNO_AGENT_KEY/$TURNO_ACCOUNT_ID/$1" >/dev/null 2>&1', 'exit 0', ''].join('\n')

const STATUSLINE_SH = [
  '#!/bin/sh',
  SH_GUARD,
  'p=$(cat)',
  's="${TMPDIR:-/tmp}/turno-sl-$TURNO_AGENT_KEY"',
  'now=$(date +%s); last=$(cat "$s" 2>/dev/null || echo 0)',
  // o Claude chama varias vezes por segundo enquanto responde: no maximo uma consulta ao Turno a cada 2 s
  'if [ $((now-last)) -lt 2 ] && [ -f "$s.out" ]; then cat "$s.out"; exit 0; fi',
  'echo "$now" > "$s"',
  'printf \'%s\' "$p" | curl -s -m 2 -H "x-turno-token: $TURNO_HOOK_TOKEN" --data-binary @- "http://127.0.0.1:$TURNO_HOOK_PORT/statusline/$TURNO_AGENT_KEY/$TURNO_ACCOUNT_ID" > "$s.out" 2>/dev/null',
  'cat "$s.out" 2>/dev/null',
  'exit 0',
  '',
].join('\n')

// PowerShell 5.1: entrada e saida em BYTES UTF-8 pelos fluxos padrao (nao depende da pagina de codigo nem de haver um
// console anexado: senao as barras e a moldura saem embaralhadas); a resposta tambem e lida em bytes (o .Content adivinha
// a codificacao); erro de rede nunca quebra o Claude.
const PS_PRELUDE = [
  '$ErrorActionPreference = "SilentlyContinue"',
  '$utf8 = New-Object System.Text.UTF8Encoding $false',
  '$p = (New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)).ReadToEnd()',
  'function Out-Utf8($text) { $o = [Console]::OpenStandardOutput(); $b = $utf8.GetBytes([string]$text); $o.Write($b, 0, $b.Length); $o.Flush() }',
  'if (-not $env:TURNO_HOOK_PORT) { exit 0 }',
  'function Send($path, $timeout) {',
  '  $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri ("http://127.0.0.1:" + $env:TURNO_HOOK_PORT + $path) -Headers @{ "x-turno-token" = $env:TURNO_HOOK_TOKEN } -ContentType "application/json; charset=utf-8" -Body $utf8.GetBytes($p) -TimeoutSec $timeout',
  '  if ($r) { return $utf8.GetString($r.RawContentStream.ToArray()) }',
  '}',
]

const HOOK_PS1 = ['param([string]$ev)', ...PS_PRELUDE, 'Send ("/hook/" + $env:TURNO_AGENT_KEY + "/" + $env:TURNO_ACCOUNT_ID + "/" + $ev) 3 | Out-Null', 'exit 0', ''].join('\r\n')

const STATUSLINE_PS1 = [
  ...PS_PRELUDE,
  '$s = Join-Path $env:TEMP ("turno-sl-" + $env:TURNO_AGENT_KEY)',
  '$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()',
  '$last = 0',
  'if (Test-Path -LiteralPath $s) { $last = [int64](Get-Content -LiteralPath $s -Raw) }',
  // no maximo uma consulta ao Turno a cada 2 s; no intervalo, o ultimo rodape
  'if (($now - $last) -lt 2 -and (Test-Path -LiteralPath ($s + ".out"))) { Out-Utf8 ([IO.File]::ReadAllText($s + ".out", $utf8)); exit 0 }',
  'Set-Content -LiteralPath $s -Value $now -NoNewline',
  // Turno sem responder: rodape vazio (como o sh), nunca o ultimo desenho para sempre
  '$out = Send ("/statusline/" + $env:TURNO_AGENT_KEY + "/" + $env:TURNO_ACCOUNT_ID) 2',
  'if ($out -eq $null) { $out = "" }',
  '[IO.File]::WriteAllText($s + ".out", $out, $utf8)',
  'Out-Utf8 $out',
  'exit 0',
  '',
].join('\r\n')

// Arquivos gravados na pasta de dados do Turno (todos, em qualquer sistema: o settings da sessao escolhe qual usar)
export const scriptFiles = (): Record<string, string> => ({
  'turno-hook.sh': HOOK_SH,
  'turno-statusline.sh': STATUSLINE_SH,
  'turno-hook.ps1': HOOK_PS1,
  'turno-statusline.ps1': STATUSLINE_PS1,
})

// Aspas simples do sh: nada dentro e interpretado ($, `, espaco); o apostrofo vira '\''
const shQuote = (v: string): string => `'${v.replace(/'/g, "'\\''")}'`
// Aspas simples do PowerShell: o apostrofo vira ''
const psQuote = (v: string): string => `'${v.replace(/'/g, "''")}'`
// -EncodedCommand: o comando vai em base64 (UTF-16LE), que so tem letras, numeros e +/=, entao nem o Git Bash nem o
// PowerShell (o Claude usa um ou outro) mexem no caminho, por mais estranho que seja o nome do usuario ($, ', [ ]).
const psEncoded = (cmd: string): string => `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(cmd, 'utf16le').toString('base64')}`

// Como o settings da sessao (--settings) chama os scripts. No Windows o caminho vai com barras normais ("/").
// Windows: PowerShell com o comando codificado (funciona pelo Git Bash e pelo PowerShell). Nao usa a forma exec (args):
// um Claude antigo que ignore "args" rodaria powershell.exe puro lendo o JSON do hook como comando.
export function claudeSessionWiring(platform: NodeJS.Platform, dir: string) {
  // so no Windows "\\" e separador (vira "/"); no Linux/macOS e um caractere valido do nome da pasta
  const base = platform === 'win32' ? dir.replace(/\\/g, '/') : dir
  const at = (name: string): string => `${base.replace(/\/+$/, '')}/${name}`
  if (platform === 'win32') {
    return {
      statusLine: { type: 'command', command: psEncoded(`& ${psQuote(at('turno-statusline.ps1'))}`), padding: 0 },
      hook: (ev: string) => ({ type: 'command', command: psEncoded(`& ${psQuote(at('turno-hook.ps1'))} ${psQuote(ev)}`), timeout: 10 }),
    }
  }
  return {
    statusLine: { type: 'command', command: `sh ${shQuote(at('turno-statusline.sh'))}`, padding: 0 },
    hook: (ev: string) => ({ type: 'command', command: `sh ${shQuote(at('turno-hook.sh'))} ${shQuote(ev)}`, timeout: 10 }),
  }
}

// Pedido ao servidor local: /statusline/<key>/<conta> ou /hook/<key>/<conta>/<evento>. URL malformada = null (antes o
// decodeURIComponent lancava fora do try e o pedido ficava pendurado).
export function parseHookUrl(url: string): { kind: string; key: string; accountId: string; event?: string } | null {
  try {
    const [, kind, key, accountId, event] = url.split('/').map(decodeURIComponent)
    return { kind, key, accountId, event }
  } catch {
    return null
  }
}

// Corpo do pedido: junta os pedacos ANTES de decodificar (um acento partido entre dois pedacos virava lixo)
export const decodeBody = (chunks: Buffer[]): string => Buffer.concat(chunks).toString('utf8')

