import { defineConfig } from 'vitest/config'

// Testes de lógica pura do main/shared rodam em Node, fora do Electron.
// UI (React) e integração Electron ficam no `smoke`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
