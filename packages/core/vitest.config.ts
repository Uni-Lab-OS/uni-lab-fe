import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/api.ts',
        'src/**/port.ts',
        'src/**/model.ts',
        'src/index.ts',
        // These adapters/codecs accept several historical OS envelopes. They
        // keep dedicated contract tests, while the 95% gate targets the
        // deterministic domain and scenario surface below.
        'src/adapters/workflow-runtime-events.ts',
        'src/**/codec.ts',
        'src/domain/workflow-execution-read/client.ts',
        'src/scenarios/workflow-debugging/**',
        'src/scenarios/run-preparation/input.ts',
        'src/assembly/backend.ts',
        'src/domain/run-preparation/client.ts',
        'src/domain/workflow-definition/client.ts',
        'src/domain/reagent-inventory/client.ts',
      ],
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 80 },
    },
  },
})
