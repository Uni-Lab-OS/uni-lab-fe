import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { react: fileURLToPath(new URL('./node_modules/react', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
    css: { modules: { classNameStrategy: 'stable' } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/index.ts', 'src/styles.d.ts'],
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 88 },
    },
  },
})
