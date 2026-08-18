import { resolve } from 'path'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { webChunkName } from './build/webChunks'

const LOCAL_BACKEND_PROXY_PREFIX = '/__unilab_backend'
const LOCAL_BACKEND_PROXY_TARGET = process.env.UNILAB_BACKEND_PROXY_TARGET ??
  'http://127.0.0.1:8080'

/**
 * 移除浏览器同源代理前缀，把请求恢复为 Backend 的公开路径。
 *
 * @param path Vite 开发服务器收到的请求路径。
 * @returns 交给本地 Backend 的版本化 API 或健康检查路径。
 */
function rewriteLocalBackendProxyPath(path: string): string {
  const rewritten = path.slice(LOCAL_BACKEND_PROXY_PREFIX.length)
  return rewritten || '/'
}

// kernel-web 是浏览器与 Electron 共同使用的唯一 renderer。
export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss()],
  // @pascal-app/* 以 Next.js 目标的 TS 源码分发，模块顶层直接读 process.env.*
  //（NODE_ENV / NEXT_PUBLIC_* 等），假设由 Next 在构建期替换。本 renderer 是纯 Vite，
  // 浏览器/Electron 无 process 全局。明确保留资源 CDN 配置，并让其他
  // process.env.* 在构建期安全降级，避免加载 3D 编辑器时抛 ReferenceError。
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
    'process.env.NEXT_PUBLIC_ASSETS_CDN_URL': JSON.stringify(
      process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? ''
    ),
    'process.env': '{}'
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      [LOCAL_BACKEND_PROXY_PREFIX]: {
        target: LOCAL_BACKEND_PROXY_TARGET,
        changeOrigin: true,
        rewrite: rewriteLocalBackendProxyPath
      }
    },
    // The shared workspace can exhaust Linux's per-user inotify instance
    // budget before Vite starts. Polling keeps local web and Electron
    // development deterministic without requiring a host-level sysctl change.
    watch: {
      usePolling: true,
      interval: 300
    }
  },
  esbuild: {
    jsx: 'automatic'
  },
  // Pascal/Radix ship precompiled ESM that imports CommonJS entries even
  // while Vite is serving the editor's workspace source in development.
  // These imports are outside the initial dependency scan, so include them
  // explicitly instead of serving their CommonJS files raw to the browser.
  optimizeDeps: {
    include: [
      'react/jsx-runtime',
      'react-dom',
      // zustand（reactflow/2D 视图依赖）以源码 ESM 提供，其对纯 CJS 的
      // use-sync-external-store/shim/with-selector.js 做 default 导入。
      // 不预打包该子路径时会因缺少 default 导出而报错，故显式纳入。
      'use-sync-external-store/shim/with-selector',
      // Pascal imports both the WebGL and WebGPU/TSL entry points. Prebundle
      // all three together so their relative three.core import is shared.
      'three',
      'three/webgpu',
      'three/tsl',
      '@unilab/pascal-lab-plugin > @unilab/pascal-host > @pascal-app/editor > howler'
    ],
    esbuildOptions: {
      define: {
        'process.env.NEXT_PUBLIC_ASSETS_CDN_URL': JSON.stringify(
          process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? ''
        )
      }
    }
  },
  resolve: {
    // Pascal host/plugin and the renderer must share one Three.js module
    // instance; duplicate instances break identity checks and emit a runtime
    // warning even when both packages declare the same version.
    dedupe: ['three'],
    alias: {
      '@': resolve(__dirname, 'src'),
      '@renderer': resolve(__dirname, 'src'),
      'next/image': resolve(
        __dirname,
        '../../packages/pascal-host/src/shims/next-image.tsx'
      ),
      'next/link': resolve(
        __dirname,
        '../../packages/pascal-host/src/shims/next-link.tsx'
      )
    }
  },
  build: {
    rollupOptions: {
      output: {
        // Keep long-lived framework/feature payloads independently cacheable.
        // SceneWorkbench remains a dynamic entry; this additionally prevents its
        // large graphics dependencies from falling back into the application chunk.
        manualChunks: webChunkName,
        // A named chunk owns only modules matched above. Pulling each module's
        // transitive dependencies into the same chunk can move Rollup helpers
        // shared with the app entry into a lazy 3D chunk and make it eager again.
        onlyExplicitManualChunks: true
      }
    }
  }
}))
