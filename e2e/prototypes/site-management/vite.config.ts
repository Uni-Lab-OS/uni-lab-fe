import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  // 原型位于工作区包之外，显式复用 kernel-web 已安装的 React，避免增加依赖。
  resolve: {
    alias: {
      react: fileURLToPath(new URL('../../../apps/kernel-web/node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(
        new URL('../../../apps/kernel-web/node_modules/react-dom', import.meta.url)
      )
    }
  },
  server: {
    host: '127.0.0.1',
    port: 4187,
    strictPort: true
  },
  build: {
    outDir: fileURLToPath(
      new URL('../../../e2e-artifacts/site-management-prototype', import.meta.url)
    ),
    emptyOutDir: true
  }
})
