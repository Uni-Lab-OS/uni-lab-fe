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
  parseDeviceCardManifest,
  validateDeviceCardManifest,
  type DeviceCardAuthoringContext,
  type DeviceCardDiagnostic,
  type DeviceCardManifest
} from '@unilab/device-card-sdk'

import type {
  DeviceCardBuildMetadata,
  DeviceCardBuildRequest,
  DeviceCardBuildResult
} from './contracts'
import {
  assertInside,
  scanSource,
  validatePermissionsAgainstContext
} from './security'
import { vueSfcPlugin } from './vuePlugin'

export const DEVICE_CARD_BUILDER_VERSION = '0.1.0'
const runtimeRequire = createRequire(
  typeof __filename === 'string' ? __filename : import.meta.url
)
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue'])
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
        contents: wrapperSource(manifest, entry),
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

function wrapperSource(manifest: DeviceCardManifest, entry: string): string {
  const entrySpecifier = JSON.stringify(entry)
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
          !isInside(projectDir, args.importer)
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

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return pathFromRoot === '' ||
    (!pathFromRoot.startsWith('..') && !pathFromRoot.startsWith('/'))
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

function mockHostSource(
  manifest: DeviceCardManifest,
  context?: DeviceCardBuildRequest['authoringContext']
): string {
  const state = context?.sampleState ?? {}
  const deviceTypeId = context?.deviceTypeId ?? manifest.deviceTypes[0] ?? ''
  return `
if (!window.unilabCard) {
  let state = ${JSON.stringify(state)}
  let config = ${JSON.stringify(manifest.config?.defaults ?? {})}
  const listeners = new Set()
  window.unilabCard = {
    async getContext() {
      return {
        mode: 'mock',
        device: {
          deviceId: ${JSON.stringify(context?.deviceId ?? null)},
          deviceTypeId: ${JSON.stringify(deviceTypeId)},
          title: ${JSON.stringify(context?.title ?? manifest.title)}
        },
        state: { ...state },
        config: { ...config },
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
    log(level, message) {
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info']('[device-card]', message)
    }
  }
}
`
}

async function projectSourceHash(
  projectDir: string,
  _manifest: DeviceCardManifest
): Promise<string> {
  const hash = createHash('sha256')
  for (const path of await projectFiles(projectDir)) {
    const relativePath = relative(projectDir, path).replaceAll('\\', '/')
    hash.update(relativePath)
    hash.update('\u0000')
    hash.update(await readFile(path))
    hash.update('\u0000')
  }
  return hash.digest('hex')
}

async function projectFiles(
  root: string,
  directory = root
): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === '.unilab-card'
    ) {
      continue
    }
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...await projectFiles(root, absolute))
    } else if (entry.isFile()) {
      result.push(absolute)
    }
  }
  return result.sort()
}

async function scanProjectSources(
  root: string,
  directory = root
): Promise<DeviceCardDiagnostic[]> {
  const diagnostics: DeviceCardDiagnostic[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === '.unilab-card'
    ) {
      continue
    }
    const absolute = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) {
      diagnostics.push({
        severity: 'error',
        code: 'source.symlink',
        message: '卡片源码不能包含符号链接。',
        path: relative(root, absolute)
      })
    } else if (entry.isDirectory()) {
      diagnostics.push(...await scanProjectSources(root, absolute))
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      diagnostics.push(
        ...scanSource(await readFile(absolute, 'utf8'), relative(root, absolute))
      )
    }
  }
  return diagnostics
}

function elementNameFor(
  manifest: DeviceCardManifest,
  sourceHash: string
): string {
  const safeId = manifest.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `ulcard-${safeId}-${sourceHash.slice(0, 8)}`
}

function isAuthoringContext(value: unknown): value is DeviceCardAuthoringContext {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === 'device-card-authoring-context/v1' &&
    typeof record.deviceTypeId === 'string' &&
    typeof record.title === 'string' &&
    Array.isArray(record.actions) &&
    !!record.stateSchema &&
    typeof record.stateSchema === 'object' &&
    !!record.sampleState &&
    typeof record.sampleState === 'object' &&
    Array.isArray(record.media)
  )
}

async function readProjectAuthoringContext(
  projectDir: string
): Promise<DeviceCardAuthoringContext | undefined> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(resolve(projectDir, 'authoring-context.json'), 'utf8')
    )
    return isAuthoringContext(raw) ? raw : undefined
  } catch {
    return undefined
  }
}

function mergeHostAuthoringContext(
  runtime: DeviceCardAuthoringContext | undefined,
  project: DeviceCardAuthoringContext | undefined
): DeviceCardAuthoringContext | undefined {
  if (!runtime) return undefined
  if (!project) return runtime
  return {
    ...runtime,
    stateSchema: { ...runtime.stateSchema },
    sampleState: { ...project.sampleState, ...runtime.sampleState }
  }
}

function esbuildDiagnostics(error: unknown): DeviceCardDiagnostic[] {
  const failure = error as Partial<BuildFailure>
  if (Array.isArray(failure.errors)) {
    return failure.errors.map((item) => ({
      severity: 'error',
      code: 'build.esbuild',
      message: item.text,
      path: item.location?.file
    }))
  }
  return [{
    severity: 'error',
    code: 'build.failed',
    message: error instanceof Error ? error.message : String(error)
  }]
}

function hasErrors(diagnostics: DeviceCardDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error')
}
