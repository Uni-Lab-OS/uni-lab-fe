import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(process.cwd(), 'e2e'),
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: resolve(
        process.cwd(),
        'packages/robot-workstation/node_modules/react'
      ),
      'react-dom': resolve(
        process.cwd(),
        'packages/robot-workstation/node_modules/react-dom'
      )
    }
  },
  build: {
    outDir: resolve(process.cwd(), '../e2e-artifacts/.new-unresolved-site'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'e2e/new-unresolved-page-fixture.html')
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4176,
    strictPort: true
  }
})
