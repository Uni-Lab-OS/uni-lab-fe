import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { react: fileURLToPath(new URL('./node_modules/react', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', '*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    css: { modules: { classNameStrategy: 'stable' } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      all: true,
      include: [
        'src/app/BackendProvider.tsx',
        'src/app/navigation.ts',
        'src/components/**/*.tsx',
        'src/hooks/**/*.ts',
        'src/features/**/materialFlowModel.ts',
        'src/features/**/materialSiteActions.ts',
        'src/features/**/taskDetailModel.ts',
        'src/features/**/taskDomain.ts',
        'src/features/**/taskPresentation.ts',
        'src/features/**/workflowCatalogModel.ts',
        'src/features/**/workflowFlowProjection.ts',
        'src/features/**/workflowPresentation.ts',
        'src/features/**/WorkflowInputFields.tsx',
        'src/features/**/DeviceActionInputFields.tsx',
      ],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/vite-env.d.ts'],
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 85 },
    },
  },
})
