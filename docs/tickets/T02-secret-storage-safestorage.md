# T02 — Secret storage (safeStorage)

**Frente:** Parte 0 · **Esforço:** S · **Depende de:** T00 (consumido por T01/T03)

## Objetivo
Guardar token de provider cifrado via **Electron `safeStorage`** (keychain do SO). Hoje o `settings.json` é texto puro (`settings.ts`) — token de API **não pode** ir pra lá. A Connection guarda só `tokenRef`; o valor vive no cofre.

## Escopo
- **Dentro:** módulo `secrets` (`set/get/delete/has`), encode base64 do buffer cifrado em arquivo próprio (`userData/secrets.json`), fallback claro quando `safeStorage.isEncryptionAvailable()` for falso.
- **Fora:** UI (T03). Rotação de credencial (regra do dono: não nag).

## Arquivos
- `src/main/secrets.ts` (novo)
- `src/main/settings.ts` (garantir que token nunca entra no settings)
- `src/main/runner.ts:251` (injeta token no env só na hora do spawn)

## TDD (RED → GREEN)
Mockar `electron.safeStorage` (encrypt/decrypt identidade no teste).
1. **RED:** `get('x')` sem nada → `null`.
2. **RED:** `set('x', 'segredo')` → `get('x') === 'segredo'` (roundtrip).
3. **RED:** após `set`, o conteúdo serializado **não contém** a string em claro (prova de cifragem).
4. **RED:** `isEncryptionAvailable()===false` → `set` lança/retorna erro explícito (não grava plano).
5. **GREEN:** implementar.

## Segurança
- **Nunca** logar/retornar o valor em erro, evento ou run. Só `tokenRef`/nome.

## Done
- Roundtrip + prova de não-plaintext verdes. Token some do `settings.json`.
