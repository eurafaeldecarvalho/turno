# T13 — Sandbox opcional (default OFF)

**Frente:** Orquestração · **Esforço:** L · **Depende de:** T00 (melhor com T07)

## Objetivo
Permitir rodar uma run **dentro de sandbox**, **opt-in por rotina** e com **default DESLIGADO** (sem sandbox) — requisito explícito do dono. Habilita rodar agente sem supervisão com menos risco (e é o que torna `--allow-dangerously-skip-permissions` aceitável).

## Escopo
- **Dentro:** campo `sandbox: 'none' | 'wsl' | 'docker'` (**default `'none'`**); runner pluggable que envolve o comando no wrapper do modo escolhido; quando `none`, comando roda exatamente como hoje.
- **Fora (sub-tarefa de design):** backend concreto de sandbox. O `turno` é **Windows-first** → sandbox real = **WSL2** ou **Docker Desktop**; definir imagem/montagem/rede depois. Este ticket entrega o **ponto de extensão** e o default seguro, não a imagem.

## Arquivos
- `src/main/sandbox.ts` (novo): `wrapForSandbox(cmd, args, mode)`
- `src/main/runner.ts:251` (spawn passa pelo wrapper)
- `src/main/routines.ts:28` (campo `sandbox`, default `none`)
- renderer: toggle no `RoutineEditor.tsx` (desligado por padrão)

## TDD (RED → GREEN)
Seam pura = `wrapForSandbox(cmd, args, mode)`.
1. **RED:** `mode='none'` → retorna `{cmd, args}` **intactos** (prova do default OFF — nada muda vs. hoje).
2. **RED:** `mode='docker'` → envolve em `docker run ...` com o cmd original dentro.
3. **RED:** `mode='wsl'` → envolve em `wsl ...`.
4. **RED:** schema default do campo `sandbox` é `'none'`.
5. **GREEN:** implementar o wrapper; backend real (imagem/montagem) em PR seguinte.

## Segurança
- Documentar: YOLO/`--allow-dangerously-skip-permissions` **só** com sandbox ligado e sem internet. Com `none`, manter os cartões/inbox de aprovação (T09).

## Done
- `wrapForSandbox` verde (com ênfase no caso `none` = no-op); toggle na UI default desligado.
