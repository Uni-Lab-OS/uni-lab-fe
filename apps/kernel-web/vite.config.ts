import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// kernel-web 是浏览器与 Electron 共同使用的唯一 renderer。
export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), react()],
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
    alias: {
      '@': resolve(__dirname, 'src'),
      '@renderer': resolve(__dirname, 'src'),
      'next/image': resolve(__dirname, 'src/shims/next-image.tsx'),
      'next/link': resolve(__dirname, 'src/shims/next-link.tsx')
    }
  }
}))
