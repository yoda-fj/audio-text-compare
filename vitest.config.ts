import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * Config isolada para Vitest — evita carregar os plugins do Electron
 * (vite-plugin-electron/simple + renderer) e o PostCSS do Tailwind, que
 * não fazem sentido no contexto de testes unitários.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
