import { chmodSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 发布产物自带启动能力：把 scripts/ 下的启动脚本和文档一并写进 dist，
 * 使用者拿到 dist 后不需要 node/pnpm，照 README.md 就能起前端调试界面。
 */
const BOOTSTRAP_DIR = fileURLToPath(new URL('./scripts', import.meta.url))

function shipFrontendBootstrap(): Plugin {
  let outDir = ''
  return {
    name: 'unilab:ship-frontend-bootstrap',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    generateBundle() {
      for (const file of ['README.md', 'serve-dist.py', 'start-frontend.sh']) {
        this.emitFile({
          type: 'asset',
          fileName: file,
          source: readFileSync(join(BOOTSTRAP_DIR, file), 'utf8'),
        })
      }
    },
    closeBundle() {
      // Vite 写出的 asset 固定是 644，发布包里要能直接 ./start-frontend.sh 执行。
      try {
        chmodSync(join(outDir, 'start-frontend.sh'), 0o755)
      } catch (error) {
        this.warn(`无法给 start-frontend.sh 加执行位：${String(error)}`)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  // Vite 配置不会自动把 .env.local 注入 process.env；显式加载后，
  // 浏览器端和开发代理才能使用同一个 workspace backend 地址。
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget =
    env.VITE_UNILAB_PROXY_TARGET || env.VITE_EDGE_API_URL || 'http://127.0.0.1:59394'

  return {
    plugins: [react(), shipFrontendBootstrap()],
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
