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

// PowerShell 5.1: entrada e saida em UTF-8 (senao as barras e a moldura saem embaralhadas na pagina de codigo do
// console); a resposta e lida em bytes (o .Content adivinha a codificacao); erro de rede nunca quebra o Claude.
const PS_PRELUDE = [
  '$ErrorActionPreference = "SilentlyContinue"',
  '$utf8 = New-Object System.Text.UTF8Encoding $false',
  '[Console]::InputEncoding = $utf8',
  '[Console]::OutputEncoding = $utf8',
  '$p = [Console]::In.ReadToEnd()',
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
  'if (Test-Path $s) { $last = [int64](Get-Content $s -Raw) }',
  // no maximo uma consulta ao Turno a cada 2 s; no intervalo, o ultimo rodape
  'if (($now - $last) -lt 2 -and (Test-Path ($s + ".out"))) { [Console]::Out.Write([IO.File]::ReadAllText($s + ".out", $utf8)); exit 0 }',
  'Set-Content -Path $s -Value $now -NoNewline',
  '$out = Send ("/statusline/" + $env:TURNO_AGENT_KEY + "/" + $env:TURNO_ACCOUNT_ID) 2',
  'if ($out -ne $null) { [IO.File]::WriteAllText($s + ".out", $out, $utf8) }',
  'if (Test-Path ($s + ".out")) { [Console]::Out.Write([IO.File]::ReadAllText($s + ".out", $utf8)) }',
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

// Como o settings da sessao (--settings) chama os scripts. dir com barras normais ("/"), tambem no Windows.
// Windows: hook na forma exec (powershell.exe + args, sem shell nenhum); statusline via "powershell -File", que a
// documentacao garante tanto pelo Git Bash quanto pelo PowerShell.
export function claudeSessionWiring(platform: NodeJS.Platform, dir: string) {
  const at = (name: string): string => `${dir.replace(/\\/g, '/').replace(/\/+$/, '')}/${name}`
  if (platform === 'win32') {
    return {
      statusLine: { type: 'command', command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${at('turno-statusline.ps1')}"`, padding: 0 },
      hook: (ev: string) => ({ type: 'command', command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', at('turno-hook.ps1'), ev] as string[] | undefined, timeout: 10 }),
    }
  }
  return {
    statusLine: { type: 'command', command: `sh "${at('turno-statusline.sh')}"`, padding: 0 },
    hook: (ev: string) => ({ type: 'command', command: `sh "${at('turno-hook.sh')}" ${ev}`, args: undefined as string[] | undefined, timeout: 10 }),
  }
}
