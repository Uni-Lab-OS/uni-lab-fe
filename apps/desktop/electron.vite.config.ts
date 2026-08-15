import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 根据桌面运行模式生成 Electron 主进程、预加载脚本与可选渲染器配置。
 * @param mode electron-vite 传入的构建模式。
 * @returns 可供 electron-vite 使用的桌面构建配置。
 */
export default defineConfig(({ mode }) => ({
  main: {
    // 工作区源码必须编入 Main，Phoenix 也一并编入产物，避免为一个
    // 可观测性入口部署整棵 OpenTelemetry 依赖树。
    plugins: [externalizeDepsPlugin({
      exclude: [
        '@arizeai/phoenix-otel',
        '@unilab/services',
        '@unilab/local-environment'
      ]
    })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          deviceCard: resolve(__dirname, 'src/preload/deviceCard.ts')
        }
      }
    }
  },
  renderer: mode === 'workbench-shell' ? undefined : {
    root: resolve(__dirname, '../kernel-web'),
    // @pascal-app/* 以 Next.js 目标的 TS 源码分发，模块顶层直接读 process.env.*
    //（NODE_ENV / NEXT_PUBLIC_* 等），假设由 Next 在构建期替换。Electron renderer
    // 无 process 全局。明确保留资源 CDN 配置，并让其他 process.env.* 在构建期
    // 安全降级，避免加载 3D 编辑器时抛 ReferenceError。
    server: {
      watch: {
        usePolling: true,
        interval: 300
      }
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.NEXT_PUBLIC_ASSETS_CDN_URL': JSON.stringify(
        process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? ''
      ),
      'process.env': '{}'
    },
    // Keep Electron development aligned with kernel-web's Vite server.
    // Pascal's workspace source imports these CommonJS entries directly.
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
        '@': resolve(__dirname, '../kernel-web/src'),
        '@renderer': resolve(__dirname, '../kernel-web/src'),
        'next/image': resolve(__dirname, '../../packages/pascal-host/src/shims/next-image.tsx'),
        'next/link': resolve(__dirname, '../../packages/pascal-host/src/shims/next-link.tsx')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, '../kernel-web/index.html')
        }
      }
    },
    plugins: [tailwindcss(), react()]
  }
}))
