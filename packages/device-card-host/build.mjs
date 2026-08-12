import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const outputDirectory = join(packageDirectory, 'dist')
const runtimeRequire = createRequire(import.meta.url)
const runtimeSources = Object.freeze({
  react: commonJsRuntimeSource('react', true),
  'react-jsx-runtime': commonJsRuntimeSource('react/jsx-runtime'),
  'react-dom-client': commonJsRuntimeSource('react-dom/client'),
  vue: "export * from 'vue'",
  'unilab-device-card-sdk':
    "export * from '@unilab/device-card-sdk'",
  'unilab-device-card-sdk-react':
    "export * from '@unilab/device-card-sdk/react'",
  'unilab-device-card-sdk-vue':
    "export * from '@unilab/device-card-sdk/vue'",
  'unilab-device-card-ui':
    "export * from '@unilab/device-card-ui'",
  'unilab-device-card-ui-register':
    "export * from '@unilab/device-card-ui/register'"
})

await rm(outputDirectory, { recursive: true, force: true })
await Promise.all([
  buildHostBundle(),
  buildCardRuntime('development'),
  buildCardRuntime('production')
])

/**
 * 把 CommonJS 包的当前公开键转换为可静态分析的 ESM 命名导出。
 * @param {string} specifier 待包装的 CommonJS 模块标识。
 * @param {boolean} includeDefault 是否同时公开默认导出。
 * @returns {string} 虚拟 ESM 入口源码。
 */
function commonJsRuntimeSource(specifier, includeDefault = false) {
  const names = Object.keys(runtimeRequire(specifier))
    .filter((name) => /^[A-Za-z_$][\w$]*$/u.test(name))
    .sort()
  const defaultExport = includeDefault ? 'export default runtime\n' : ''
  return `import runtime from ${JSON.stringify(specifier)}\n${defaultExport}export const { ${names.join(', ')} } = runtime\n`
}

/**
 * 构建设备卡宿主的 Node 运行时入口，并内联只用于源码编译的 Vue 编译器。
 * @returns {Promise<import('esbuild').BuildResult>} 构建结果。
 */
function buildHostBundle() {
  return build({
    absWorkingDir: packageDirectory,
    alias: {
      '@vue/compiler-sfc':
        '@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js'
    },
    bundle: true,
    define: { 'import.meta.url': '__filename' },
    entryPoints: ['src/index.ts'],
    external: ['esbuild'],
    format: 'cjs',
    logLevel: 'info',
    outfile: join(outputDirectory, 'index.cjs'),
    platform: 'node',
    target: ['node20']
  })
}

/**
 * 将设备卡允许导入的浏览器库预编译为共享分块，避免发布完整开发包。
 * @param {'development' | 'production'} mode 运行库构建模式。
 * @returns {Promise<import('esbuild').BuildResult>} 构建结果。
 */
function buildCardRuntime(mode) {
  return build({
    absWorkingDir: packageDirectory,
    bundle: true,
    chunkNames: 'chunks/[name]-[hash]',
    entryNames: '[name]',
    entryPoints: Object.fromEntries(
      Object.keys(runtimeSources).map((name) => [
        name,
        `unilab-card-runtime:${name}`
      ])
    ),
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode)
    },
    format: 'esm',
    logLevel: 'info',
    minify: mode === 'production',
    outdir: join(outputDirectory, 'card-runtime', mode),
    platform: 'browser',
    plugins: [cardRuntimeEntryPlugin()],
    splitting: true,
    target: ['chrome120']
  })
}

/**
 * 为多入口构建提供只存在于构建期的设备卡运行库入口。
 * @returns {import('esbuild').Plugin} esbuild 虚拟入口插件。
 */
function cardRuntimeEntryPlugin() {
  const prefix = 'unilab-card-runtime:'
  return {
    name: 'unilab-card-runtime-entry',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^unilab-card-runtime:/u }, (args) => ({
        namespace: 'unilab-card-runtime-entry',
        path: args.path.slice(prefix.length)
      }))
      buildApi.onLoad(
        { filter: /.*/u, namespace: 'unilab-card-runtime-entry' },
        (args) => ({
          contents: runtimeSources[args.path],
          loader: 'js',
          resolveDir: packageDirectory
        })
      )
    }
  }
}
