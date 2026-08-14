import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'

import {
  build as esbuild,
  type BuildFailure,
  type Loader,
  type Plugin
} from 'esbuild'
import {
  DEVICE_CARD_JOINT_PREVIEW_FEATURE,
  deviceCardAuthoringDefinitionFqid,
  deviceCardManifestCompatibilityIds,
  parseDeviceCardManifest,
  validateDeviceCardManifest,
  type DeviceCardAuthoringContext,
  type DeviceCardDiagnostic,
  type DeviceCardManifest
} from '@unilab/device-card-sdk'

import {
  elementNameFor,
  esbuildDiagnostics,
  hasErrors,
  mergeHostAuthoringContext,
  projectSourceHash,
  readProjectAuthoringContext,
  scanProjectSources
} from './buildSupport'
import type {
  DeviceCardBuildMetadata,
  DeviceCardBuildRequest,
  DeviceCardBuildResult
} from './contracts'
import {
  assertInside,
  isPathInsideRoot,
  scanSource,
  validatePermissionsAgainstContext
} from './security'
import { vueSfcPlugin } from './vuePlugin'

export const DEVICE_CARD_BUILDER_VERSION = '0.1.0'
const runtimeRequire = createRequire(
  typeof __filename === 'string' ? __filename : import.meta.url
)
const IMPORT_ALLOWLIST = new Set([
  '@unilab/device-card-sdk',
  '@unilab/device-card-sdk/react',
  '@unilab/device-card-sdk/vue',
  '@unilab/device-card-ui',
  '@unilab/device-card-ui/register',
  'react',
  'react/jsx-runtime',
  'react-dom/client',
  'vue'
])

export async function buildDeviceCard(
  request: DeviceCardBuildRequest
): Promise<DeviceCardBuildResult> {
  // macOS 上 /tmp → /private/tmp；esbuild 用真实路径做 importer，
  // 不 realpath 时 import 白名单会误判越界，vue/sdk 解析失败。
  const projectDir = await realpath(resolve(request.projectDir))
  const outDir = resolve(request.outDir)
  const diagnostics: DeviceCardDiagnostic[] = []
  let manifest: DeviceCardManifest
  try {
    const manifestText = await readFile(
      resolve(projectDir, 'card.manifest.json'),
      'utf8'
    )
    const rawManifest: unknown = JSON.parse(manifestText)
    diagnostics.push(...validateDeviceCardManifest(rawManifest))
    if (hasErrors(diagnostics)) {
      return { ok: false, diagnostics, outDir }
    }
    manifest = parseDeviceCardManifest(rawManifest)
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'manifest.read',
      message: error instanceof Error ? error.message : String(error),
      path: 'card.manifest.json'
    })
    return { ok: false, diagnostics, outDir }
  }

  const contextAuthority = request.contextAuthority ?? 'project-preview'
  const projectContext = await readProjectAuthoringContext(projectDir)
  // Only a Host-supplied Context is authoritative. Project Context remains a
  // useful offline preview snapshot, but cannot broaden a Host contract.
  const authoringContext = contextAuthority === 'host'
    ? mergeHostAuthoringContext(request.authoringContext, projectContext)
    : request.authoringContext ?? projectContext
  diagnostics.push(
    ...validatePermissionsAgainstContext(manifest, authoringContext, {
      allowLegacyPreviewState: contextAuthority === 'project-preview'
    })
  )
  const entry = assertInside(projectDir, manifest.entry)
  try {
    diagnostics.push(...await scanProjectSources(projectDir))
    await readFile(entry)
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'source.entry',
      message: error instanceof Error ? error.message : String(error),
      path: manifest.entry
    })
  }
  if (hasErrors(diagnostics)) {
    return { ok: false, diagnostics, outDir }
  }

  const sourceHash = await projectSourceHash(projectDir, manifest)
  const elementName = elementNameFor(manifest, sourceHash)
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  try {
    await esbuild({
      absWorkingDir: projectDir,
      bundle: true,
      define: {
        __UNILAB_CARD_ELEMENT__: JSON.stringify(elementName),
        // Vue 生产构建会读这些全局；不注入时 minify 产物运行期抛
        // ReferenceError: __VUE_PROD_DEVTOOLS__ is not defined，卡片空白。
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
        'process.env.NODE_ENV': JSON.stringify(
          request.development ? 'development' : 'production'
        )
      },
      format: 'esm',
      jsx: 'automatic',
      loader: {
        '.svg': 'dataurl',
        '.png': 'dataurl',
        '.webp': 'dataurl'
      },
      minify: !request.development,
      outfile: resolve(outDir, 'entry.js'),
      platform: 'browser',
      plugins: [
        importPolicyPlugin(projectDir),
        ...(manifest.authoringProfile === 'vue-web-component-v1'
          ? [vueSfcPlugin()]
          : []),
        asarModulePlugin()
      ],
      sourcemap: request.development ? 'inline' : false,
      stdin: {
        contents: wrapperSource(manifest, projectDir, entry),
        loader: 'tsx',
        resolveDir: projectDir,
        sourcefile: 'unilab-card-wrapper.tsx'
      },
      target: ['chrome120'],
      write: true
    })
  } catch (error) {
    diagnostics.push(...esbuildDiagnostics(error))
    return { ok: false, diagnostics, outDir }
  }

  const metadata: DeviceCardBuildMetadata = {
    schemaVersion: 'device-card-artifact/v1',
    builderVersion: DEVICE_CARD_BUILDER_VERSION,
    contextAuthority: contextAuthority === 'host' && request.authoringContext
      ? 'host'
      : 'project-only',
    cardId: manifest.id,
    cardVersion: manifest.version,
    elementName,
    manifest,
    sourceHash,
    builtAt: new Date().toISOString()
  }
  const hasStylesheet = existsSync(resolve(outDir, 'entry.css'))
  await Promise.all([
    writeFile(
      resolve(outDir, 'index.html'),
      hostDocument(Boolean(request.development), hasStylesheet),
      'utf8'
    ),
    writeFile(
      resolve(outDir, 'bootstrap.js'),
      bootstrapSource(elementName, Boolean(request.development)),
      'utf8'
    ),
    writeFile(
      resolve(outDir, 'mock-host.js'),
      mockHostSource(manifest, authoringContext),
      'utf8'
    ),
    writeFile(
      resolve(outDir, 'artifact.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
      'utf8'
    )
  ])
  return { ok: true, diagnostics, metadata, outDir }
}

function wrapperSource(
  manifest: DeviceCardManifest,
  projectDir: string,
  entry: string
): string {
  const entrySpecifier = JSON.stringify(toRelativeImportSpecifier(projectDir, entry))
  if (manifest.authoringProfile === 'vue-web-component-v1') {
    return `
      import { defineCustomElement } from 'vue'
      import Card from ${entrySpecifier}
      import '@unilab/device-card-ui/register'
      customElements.define(
        __UNILAB_CARD_ELEMENT__,
        defineCustomElement(Card, { shadowRoot: false })
      )
    `
  }
  if (manifest.authoringProfile === 'react-web-component-v1') {
    return `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import Card from ${entrySpecifier}
      import '@unilab/device-card-ui/register'
      class UniLabReactCardElement extends HTMLElement {
        connectedCallback() {
          if (this.__root) return
          this.__root = createRoot(this)
          this.__root.render(React.createElement(Card))
        }
        disconnectedCallback() {
          this.__root?.unmount()
          this.__root = undefined
        }
      }
      customElements.define(__UNILAB_CARD_ELEMENT__, UniLabReactCardElement)
    `
  }
  return `
    import CardElement from ${entrySpecifier}
    import '@unilab/device-card-ui/register'
    customElements.define(__UNILAB_CARD_ELEMENT__, CardElement)
  `
}

function importPolicyPlugin(projectDir: string): Plugin {
  return {
    name: 'unilab-import-policy',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (
          args.importer &&
          args.importer !== 'unilab-card-wrapper.tsx' &&
          !isPathInsideRoot(projectDir, args.importer)
        ) {
          return undefined
        }
        if (args.path.startsWith('.') || args.path.startsWith('/')) {
          const resolved = resolve(args.resolveDir || projectDir, args.path)
          assertInside(projectDir, relative(projectDir, resolved))
          return undefined
        }
        if (IMPORT_ALLOWLIST.has(args.path)) {
          return { path: unpackedAsarPath(runtimeRequire.resolve(args.path)) }
        }
        return {
          errors: [{
            text: `不允许导入 ${args.path}；只能使用相对模块、SDK、UI Kit 与固定框架依赖。`
          }]
        }
      })
    }
  }
}

function toRelativeImportSpecifier(projectDir: string, entry: string): string {
  const relativeEntry = relative(projectDir, entry).split('\\').join('/')
  return relativeEntry.startsWith('.') ? relativeEntry : `./${relativeEntry}`
}

function asarModulePlugin(): Plugin {
  return {
    name: 'unilab-asar-modules',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!args.importer.includes('.asar/')) return undefined
        try {
          return {
            path: resolveAsarImport(args.importer, args.path)
          }
        } catch (error) {
          return {
            errors: [{
              text: error instanceof Error ? error.message : String(error)
            }]
          }
        }
      })
      build.onLoad({ filter: /.*/ }, async (args) => {
        if (!args.path.includes('.asar/')) return undefined
        return {
          contents: await readFile(args.path),
          loader: loaderFor(args.path),
          resolveDir: dirname(args.path)
        }
      })
    }
  }
}

function resolveAsarImport(importer: string, specifier: string): string {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return createRequire(importer).resolve(specifier)
  }
  const base = resolve(dirname(importer), specifier)
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.vue']
      .map((extension) => `${base}${extension}`),
    ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']
      .map((extension) => resolve(base, `index${extension}`))
  ]
  const match = candidates.find((candidate) => existsSync(candidate))
  if (!match) throw new Error(`无法解析 asar 模块：${specifier}`)
  return match
}

function loaderFor(path: string): Loader {
  const extension = extname(path).toLowerCase()
  if (extension === '.ts') return 'ts'
  if (extension === '.tsx') return 'tsx'
  if (extension === '.jsx') return 'jsx'
  if (extension === '.json') return 'json'
  if (extension === '.css') return 'css'
  return 'js'
}

function unpackedAsarPath(path: string): string {
  const marker = '.asar/'
  if (!path.includes(marker)) return path
  const unpacked = path.replace(marker, '.asar.unpacked/')
  return existsSync(unpacked) ? unpacked : path
}

function hostDocument(
  development: boolean,
  hasStylesheet: boolean
): string {
  const connectSource = development
    ? "connect-src 'self';"
    : "connect-src 'none';"
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; ${connectSource} object-src 'none'; base-uri 'none'; form-action 'none'">
    <title>Uni-Lab Device Card</title>
    ${hasStylesheet ? '<link rel="stylesheet" href="./entry.css">' : ''}
    <style>
      :root { color-scheme: light dark; --u-color-surface: #fff; --u-color-text: #172033; --u-color-border: #dce5f0; }
      * { box-sizing: border-box; }
      html, body, #card-root { width: 100%; height: 100%; margin: 0; }
      body { overflow: auto; background: var(--u-color-surface); color: var(--u-color-text); font-family: Inter, system-ui, sans-serif; }
      #card-root > * { display: block; min-height: 100%; }
    </style>
  </head>
  <body>
    <main id="card-root"></main>
    <script type="module" src="./bootstrap.js"></script>
  </body>
</html>
`
}
function bootstrapSource(elementName: string, development: boolean): string {
  const reload = development
    ? `
let version = ''
setInterval(async () => {
  try {
    const response = await fetch('/.unilab-card-version', { cache: 'no-store' })
    const next = await response.text()
    if (version && next !== version) location.reload()
    version = next
  } catch {}
}, 700)
`
    : ''
  return `import './mock-host.js'
import './entry.js'
document.querySelector('#card-root')
  .append(document.createElement(${JSON.stringify(elementName)}))
${reload}
`
}

/**
 * 生成只暴露受控 Bridge 的卡片 Mock Host 脚本。
 *
 * @param manifest 已通过校验的设备卡 Manifest。
 * @param context 可选的 Host 或项目开发上下文。
 * @returns 内嵌规范 definition 身份和样例状态的浏览器脚本。
 */
function mockHostSource(
  manifest: DeviceCardManifest,
  context?: DeviceCardBuildRequest['authoringContext']
): string {
  const state = context?.sampleState ?? {}
  const materialId = context?.deviceId ?? 'mock-device'
  const definitionFqid = context
    ? deviceCardAuthoringDefinitionFqid(context)
    : deviceCardManifestCompatibilityIds(manifest)[0] ?? ''
  const definition = context?.schemaVersion === 'device-card-authoring-context/v2'
    ? context.definition
    : undefined
  return `
if (!window.unilabCard) {
  let state = ${JSON.stringify(state)}
  let config = ${JSON.stringify(manifest.config?.defaults ?? {})}
  let jointPreview
  const listeners = new Set()
  window.unilabCard = {
    async getContext() {
      return {
        mode: 'mock',
        device: {
          deviceId: ${JSON.stringify(context?.deviceId ?? null)},
          materialId: ${JSON.stringify(materialId)},
          definitionFqid: ${JSON.stringify(definitionFqid)},
          definition: ${JSON.stringify(definition)},
          deviceTypeId: ${JSON.stringify(definitionFqid)},
          title: ${JSON.stringify(context?.title ?? manifest.title)}
        },
        state: { ...state },
        config: { ...config },
        jointPreview,
        theme: 'light',
        locale: 'zh-CN'
      }
    },
    subscribeState(keys, listener) {
      const subscription = { keys: new Set(keys), listener }
      listeners.add(subscription)
      listener(Object.fromEntries(Object.entries(state).filter(([key]) => subscription.keys.has(key))))
      return () => listeners.delete(subscription)
    },
    async callAction(action, params = {}) {
      if (!${JSON.stringify(manifest.permissions.actions)}.includes(action)) {
        return { requestId: crypto.randomUUID(), action, status: 'REJECTED', error: 'Action 未授权' }
      }
      const requestId = crypto.randomUUID()
      state = { ...state, lastAction: action, lastParams: params }
      for (const subscription of listeners) {
        subscription.listener(Object.fromEntries(Object.entries(state).filter(([key]) => subscription.keys.has(key))))
      }
      return { requestId, action, status: 'DONE', result: { mock: true } }
    },
    async saveConfig(patch) {
      config = { ...config, ...patch }
      return { ...config }
    },
    async setJointPreview(jointStates) {
      if (!${JSON.stringify(manifest.uiFeatures)}.includes(${JSON.stringify(DEVICE_CARD_JOINT_PREVIEW_FEATURE)})) {
        throw new Error('Manifest 未声明 joint-preview 能力。')
      }
      if (!jointStates || typeof jointStates !== 'object' || Array.isArray(jointStates)) {
        throw new Error('关节预览必须是对象。')
      }
      const jointEntries = Object.entries(jointStates)
      if (jointEntries.length === 0 || jointEntries.length > 128) {
        throw new Error('关节预览必须包含 1 到 128 个关节。')
      }
      for (const [rawName, rawValue] of jointEntries) {
        const name = rawName.trim()
        if (!name || name.length > 200) throw new Error('关节名无效。')
        if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || Math.abs(rawValue) > 1_000_000) {
          throw new Error('关节 ' + name + ' 的数值无效。')
        }
      }
      jointPreview = {
        materialId: ${JSON.stringify(materialId)},
        jointStates: Object.fromEntries(jointEntries),
        updatedAt: Date.now()
      }
      return jointPreview
    },
    robotCommissioning: {
      async open() { throw new Error('独立 Mock Host 不提供真实机械臂调试会话。') },
      async snapshot() { throw new Error('独立 Mock Host 不提供真实机械臂调试快照。') },
      async execute() { throw new Error('独立 Mock Host 不允许执行真实机械臂命令。') },
      async revise() { throw new Error('独立 Mock Host 不允许写回 PointSet。') },
      async close() {}
    },
    log(level, message) {
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info']('[device-card]', message)
    }
  }
}
`
}
