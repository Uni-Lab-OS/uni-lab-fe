import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Vite 配置不会自动把 .env.local 注入 process.env；显式加载后，
  // 浏览器端和开发代理才能使用同一个 workspace backend 地址。
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget =
    env.VITE_UNILAB_PROXY_TARGET || env.VITE_EDGE_API_URL || 'http://127.0.0.1:59394'

  return {
    plugins: [react()],
    preview: { port: 4176, strictPort: true },
    server: {
      port: 4176,
      strictPort: true,
      proxy: {
        '/__unilab_backend': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/__unilab_backend/, ''),
        },
      },
    },
  }
})
