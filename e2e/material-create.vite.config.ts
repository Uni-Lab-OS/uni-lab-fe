import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(process.cwd(), 'e2e'),
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: resolve(process.cwd(), 'packages/material/node_modules/react'),
      'react-dom': resolve(
        process.cwd(),
        'packages/material/node_modules/react-dom'
      ),
      '@unilab/material': resolve(
        process.cwd(),
        'packages/material/src/index.ts'
      ),
      '@unilab/reagent': resolve(
        process.cwd(),
        'packages/reagent/src/index.ts'
      ),
      '@tanstack/react-query': resolve(
        process.cwd(),
        'packages/material/node_modules/@tanstack/react-query'
      )
    }
  },
  build: {
    outDir: resolve(process.cwd(), '../e2e-artifacts/.material-create-site'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'e2e/material-create-fixture.html')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true
  }
})
