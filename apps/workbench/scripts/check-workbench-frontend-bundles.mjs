import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MEBIBYTE = 1024 * 1024
const STATIC_IMPORT = /\bimport(?:\s*["'](\.[^"']+\.js)["']|[^;"']*?\bfrom\s*["'](\.[^"']+\.js)["'])/g

export const DEFAULT_WORKBENCH_BUNDLE_LIMITS = Object.freeze({
  maximumEntryBytes: 1 * MEBIBYTE,
  maximumChunkBytes: 4 * MEBIBYTE,
  // Theia eagerly initializes its frontend container. Splitting improves file
  // size, caching and transfer concurrency, but does not make those modules
  // lazy. Keep the initial graph below the former 23.2 MiB production bundle.
  maximumInitialBytes: 22 * MEBIBYTE
})

async function javascriptFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await javascriptFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path)
  }
  return files
}

async function initialModuleGraph(entryPath, root) {
  const files = new Set()
  async function visit(path) {
    if (files.has(path)) return
    if (!path.startsWith(`${root}/`) && path !== root) {
      throw new Error(`Workbench 分包引用越出 frontend 目录: ${path}`)
    }
    files.add(path)
    const source = await readFile(path, 'utf8')
    for (const match of source.matchAll(STATIC_IMPORT)) {
      await visit(resolve(dirname(path), match[1] ?? match[2]))
    }
  }
  await visit(entryPath)
  return files
}

export async function validateWorkbenchFrontendBundles(
  frontendDirectory,
  limits = DEFAULT_WORKBENCH_BUNDLE_LIMITS
) {
  const root = resolve(frontendDirectory)
  const index = await readFile(join(root, 'index.html'), 'utf8')
  if (!index.includes('<script type="module" src="./bundle.js"')) {
    throw new Error('Workbench 主入口不是 ESM module script')
  }

  const entryPath = join(root, 'bundle.js')
  const entryBytes = (await stat(entryPath)).size
  if (entryBytes > limits.maximumEntryBytes) {
    throw new Error(`Workbench bundle.js 仍有 ${(entryBytes / MEBIBYTE).toFixed(1)} MiB，分包未生效`)
  }

  for (const name of ['editor.worker.js', 'plugin-worker.js']) {
    const worker = await readFile(join(root, name), 'utf8')
    if (/^\s*(?:import|export)\b/m.test(worker)) {
      throw new Error(`${name} 含 ESM import/export，但 Theia 以经典 Worker 加载它`)
    }
  }

  const files = await javascriptFiles(root)
  const fileSizes = await Promise.all(files.map(async path => ({
    path,
    bytes: (await stat(path)).size
  })))
  const oversized = fileSizes.filter(file => file.bytes > limits.maximumChunkBytes)
  if (oversized.length > 0) {
    throw new Error(oversized.map(file => (
      `${file.path} 超过 ${(limits.maximumChunkBytes / MEBIBYTE).toFixed(1)} MiB: ` +
      `${(file.bytes / MEBIBYTE).toFixed(1)} MiB`
    )).join('\n'))
  }

  const initialFiles = await initialModuleGraph(entryPath, root)
  let initialBytes = 0
  for (const path of initialFiles) initialBytes += (await stat(path)).size
  if (initialBytes > limits.maximumInitialBytes) {
    throw new Error(
      `Workbench 首次模块图 ${(initialBytes / MEBIBYTE).toFixed(1)} MiB，` +
      `超过 ${(limits.maximumInitialBytes / MEBIBYTE).toFixed(1)} MiB`
    )
  }

  const largest = fileSizes.sort((left, right) => right.bytes - left.bytes)[0]
  return {
    entryBytes,
    initialBytes,
    initialFiles: initialFiles.size,
    javascriptFiles: files.length,
    largestBytes: largest.bytes,
    largestPath: largest.path
  }
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const frontendDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../lib/frontend'
  )
  const result = await validateWorkbenchFrontendBundles(frontendDirectory)
  console.log(
    `Workbench frontend 分包通过：入口 ${(result.entryBytes / MEBIBYTE).toFixed(2)} MiB，` +
    `首次加载 ${result.initialFiles} 个文件 / ${(result.initialBytes / MEBIBYTE).toFixed(1)} MiB，` +
    `最大文件 ${(result.largestBytes / MEBIBYTE).toFixed(1)} MiB，` +
    `共 ${result.javascriptFiles} 个 JS`
  )
}
