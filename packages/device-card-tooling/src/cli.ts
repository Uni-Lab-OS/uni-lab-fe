import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from 'node:fs/promises'
import { extname, resolve } from 'node:path'

import {
  buildDeviceCard,
  inspectDeviceCardArchive,
  packDeviceCard
} from '@unilab/device-card-builder'
import type { DeviceCardAuthoringContext } from '@unilab/device-card-sdk'

import { starterFiles, type StarterProfile } from './templates'

const [command = 'help', ...args] = process.argv.slice(2)

void run(command, args).catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

async function run(name: string, commandArgs: string[]): Promise<void> {
  if (name === 'init') return initProject(commandArgs)
  if (name === 'check') return checkProject(commandArgs)
  if (name === 'build') return buildProject(commandArgs)
  if (name === 'test') return testProject(commandArgs)
  if (name === 'pack') return packProject(commandArgs)
  if (name === 'inspect') return inspectArchive(commandArgs)
  if (name === 'dev' || name === 'preview') return devProject(commandArgs)
  printHelp()
}

async function initProject(args: string[]): Promise<void> {
  const directory = resolve(positional(args, 0) ?? 'unilab-device-card')
  const profile = option(args, '--profile') ?? 'vue'
  if (!isProfile(profile)) {
    throw new Error('--profile 必须是 vue、react 或 lite。')
  }
  await mkdir(directory, { recursive: true })
  for (const [name, content] of Object.entries(starterFiles(profile))) {
    const path = resolve(directory, name)
    await assertMissing(path)
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, content, 'utf8')
  }
  console.log(`✓ 已创建 ${profile} 卡片：${directory}`)
  console.log(`  下一步：unilab-card dev ${directory}`)
}

async function checkProject(args: string[]): Promise<void> {
  const projectDir = resolve(positional(args, 0) ?? '.')
  const context = await readContext(projectDir, option(args, '--context'))
  const result = await buildDeviceCard({
    projectDir,
    outDir: resolve(projectDir, '.unilab-card/check'),
    authoringContext: context,
    development: true
  })
  printDiagnostics(result.diagnostics)
  if (!result.ok) throw new Error('卡片检查失败。')
  console.log(`✓ manifest、权限、源码策略和编译检查通过`)
}

async function buildProject(args: string[]): Promise<void> {
  const projectDir = resolve(positional(args, 0) ?? '.')
  const context = await readContext(projectDir, option(args, '--context'))
  const outDir = resolve(
    option(args, '--out-dir') ?? resolve(projectDir, '.unilab-card/dist')
  )
  const result = await buildDeviceCard({
    projectDir,
    outDir,
    authoringContext: context
  })
  printDiagnostics(result.diagnostics)
  if (!result.ok) throw new Error('卡片构建失败。')
  console.log(`✓ 已构建 ${result.metadata?.cardId}@${result.metadata?.cardVersion}`)
  console.log(`  ${outDir}`)
}

async function testProject(args: string[]): Promise<void> {
  const projectDir = resolve(positional(args, 0) ?? '.')
  const context = await readContext(projectDir, option(args, '--context'))
  if (!context) {
    throw new Error('测试需要 authoring-context.json 或 --context。')
  }
  const outDir = resolve(projectDir, '.unilab-card/test')
  const result = await buildDeviceCard({
    projectDir,
    outDir,
    authoringContext: context,
    development: true
  })
  printDiagnostics(result.diagnostics)
  if (!result.ok) throw new Error('卡片测试构建失败。')
  await Promise.all([
    access(resolve(outDir, 'index.html')),
    access(resolve(outDir, 'entry.js')),
    access(resolve(outDir, 'artifact.json'))
  ])
  console.log('✓ Mock Context、权限契约与浏览器产物测试通过')
}

async function packProject(args: string[]): Promise<void> {
  const projectDir = resolve(positional(args, 0) ?? '.')
  const context = await readContext(projectDir, option(args, '--context'))
  const result = await buildDeviceCard({
    projectDir,
    outDir: resolve(projectDir, '.unilab-card/pack-check'),
    authoringContext: context
  })
  printDiagnostics(result.diagnostics)
  if (!result.ok || !result.metadata) throw new Error('打包前检查失败。')
  const output = resolve(
    option(args, '--out') ??
      resolve(
        projectDir,
        `${result.metadata.cardId}-${result.metadata.cardVersion}.ulcard`
      )
  )
  const inspection = await packDeviceCard(projectDir, output)
  console.log(`✓ 已生成 ${output}`)
  console.log(
    `  ${inspection.files.length} files, ${inspection.compressedBytes} bytes`
  )
}

async function inspectArchive(args: string[]): Promise<void> {
  const archive = positional(args, 0)
  if (!archive) throw new Error('inspect 需要 .ulcard 路径。')
  console.log(JSON.stringify(
    await inspectDeviceCardArchive(resolve(archive)),
    null,
    2
  ))
}

async function devProject(args: string[]): Promise<void> {
  const projectDir = resolve(positional(args, 0) ?? '.')
  const outDir = resolve(projectDir, '.unilab-card/dev')
  const contextPath = option(args, '--context')
  let buildVersion = '0'
  let lastFingerprint = ''
  let building = false

  const rebuild = async (): Promise<void> => {
    if (building) return
    building = true
    try {
      const context = await readContext(projectDir, contextPath)
      const result = await buildDeviceCard({
        projectDir,
        outDir,
        authoringContext: context,
        development: true
      })
      printDiagnostics(result.diagnostics)
      if (result.ok) {
        buildVersion = String(Date.now())
        console.log(`✓ ${new Date().toLocaleTimeString()} 预览已更新`)
      }
    } finally {
      building = false
    }
  }
  await rebuild()

  const port = Number(option(args, '--port') ?? 4178)
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/.unilab-card-version') {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end(buildVersion)
        return
      }
      const requestPath = request.url === '/' ? 'index.html' : request.url ?? ''
      const cleanPath = requestPath.split('?')[0].replace(/^\/+/, '')
      if (cleanPath.includes('..')) {
        response.writeHead(400).end()
        return
      }
      const path = resolve(outDir, cleanPath)
      const bytes = await readFile(path)
      response.setHeader('Content-Type', contentType(path))
      response.setHeader('Cache-Control', 'no-store')
      response.end(bytes)
    } catch {
      response.writeHead(404).end('Not found')
    }
  })
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolveReady())
  })
  console.log(`\n预览：http://127.0.0.1:${port}`)
  console.log('正在监视源码，按 Ctrl+C 结束。')

  const timer = setInterval(() => {
    void fingerprint(projectDir).then((next) => {
      if (lastFingerprint && next !== lastFingerprint) void rebuild()
      lastFingerprint = next
    })
  }, 600)
  process.once('SIGINT', () => {
    clearInterval(timer)
    server.close()
  })
}

async function readContext(
  projectDir: string,
  explicitPath?: string
): Promise<DeviceCardAuthoringContext | undefined> {
  const path = resolve(explicitPath ?? resolve(projectDir, 'authoring-context.json'))
  try {
    return JSON.parse(await readFile(path, 'utf8')) as DeviceCardAuthoringContext
  } catch (error) {
    if (explicitPath) throw error
    return undefined
  }
}

async function fingerprint(root: string): Promise<string> {
  const hash = createHash('sha256')
  for (const path of (await sourceFiles(root)).sort()) {
    const info = await stat(path)
    hash.update(path).update(String(info.mtimeMs)).update(String(info.size))
  }
  return hash.digest('hex')
}

async function sourceFiles(root: string, directory = root): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', '.unilab-card', 'node_modules'].includes(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await sourceFiles(root, path))
    else if (entry.isFile()) result.push(path)
  }
  return result
}

function positional(args: string[], index: number): string | undefined {
  return args.filter((value, itemIndex) =>
    !value.startsWith('--') &&
    (itemIndex === 0 || !args[itemIndex - 1].startsWith('--'))
  )[index]
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function isProfile(value: string): value is StarterProfile {
  return value === 'vue' || value === 'react' || value === 'lite'
}

async function assertMissing(path: string): Promise<void> {
  try {
    await access(path)
    throw new Error(`文件已存在，拒绝覆盖：${path}`)
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return
    }
    throw error
  }
}

function printDiagnostics(
  diagnostics: Array<{ severity: string; code: string; message: string; path?: string }>
): void {
  for (const diagnostic of diagnostics) {
    console.log(
      `${diagnostic.severity === 'error' ? '✗' : '!'} ${diagnostic.code}` +
      `${diagnostic.path ? ` (${diagnostic.path})` : ''}: ${diagnostic.message}`
    )
  }
}

function contentType(path: string): string {
  if (extname(path) === '.html') return 'text/html; charset=utf-8'
  if (extname(path) === '.js') return 'text/javascript; charset=utf-8'
  if (extname(path) === '.json') return 'application/json; charset=utf-8'
  if (extname(path) === '.svg') return 'image/svg+xml'
  if (extname(path) === '.png') return 'image/png'
  if (extname(path) === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

function printHelp(): void {
  console.log(`Uni-Lab Device Card Tooling

Usage:
  unilab-card init <dir> [--profile vue|react|lite]
  unilab-card check [dir] [--context file]
  unilab-card dev [dir] [--context file] [--port 4178]
  unilab-card test [dir] [--context file]
  unilab-card build [dir] [--out-dir dir]
  unilab-card pack [dir] [--out file.ulcard]
  unilab-card inspect <file.ulcard>
`)
}
