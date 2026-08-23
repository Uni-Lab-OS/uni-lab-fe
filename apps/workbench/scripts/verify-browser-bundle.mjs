import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const MAX_ENTRY_BYTES = 6 * 1024 * 1024
const MAX_JAVASCRIPT_ASSET_BYTES = 12 * 1024 * 1024

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return javascriptFiles(entryPath)
    return entry.name.endsWith('.js') ? [entryPath] : []
  }))
  return nested.flat()
}

export async function verifyBrowserBundle(frontendDirectory) {
  const bundlePath = path.join(frontendDirectory, 'bundle.js')
  const indexPath = path.join(frontendDirectory, 'index.html')
  const chunkDirectory = path.join(frontendDirectory, 'chunks')
  const [bundle, index, chunkEntries, files] = await Promise.all([
    readFile(bundlePath),
    readFile(indexPath, 'utf8'),
    readdir(chunkDirectory, { withFileTypes: true }),
    javascriptFiles(frontendDirectory),
  ])

  if (!bundle.includes('containerModule.default?.registry ? containerModule.default : containerModule.default?.default')) {
    throw new Error('Workbench bundle.js is missing Theia ContainerModule CommonJS/ESM normalization')
  }

  if (!index.includes('<script type="module" src="./bundle.js" charset="utf-8"></script>')) {
    throw new Error('Workbench index.html 未使用模块化 bundle.js 入口')
  }
  const chunks = chunkEntries.filter(entry => entry.isFile() && entry.name.endsWith('.js'))
  if (chunks.length === 0) {
    throw new Error('Workbench 浏览器构建没有生成 JavaScript 分块')
  }
  if (bundle.length > MAX_ENTRY_BYTES) {
    throw new Error(`Workbench bundle.js 超过 ${MAX_ENTRY_BYTES} bytes: ${bundle.length}`)
  }

  const rows = await Promise.all(files.map(async file => {
    const size = (await stat(file)).size
    return {
      file: path.relative(frontendDirectory, file),
      bytes: size,
      gzipBytes: gzipSync(await readFile(file), { level: 9 }).length,
    }
  }))
  const oversized = rows.filter(row => row.bytes > MAX_JAVASCRIPT_ASSET_BYTES)
  if (oversized.length > 0) {
    throw new Error(`Workbench JavaScript 单文件超限: ${JSON.stringify(oversized)}`)
  }

  for (const workerName of ['editor.worker.js', 'plugin-worker.js']) {
    const worker = await readFile(path.join(frontendDirectory, workerName), 'utf8')
    if (/^\s*import\s/mu.test(worker)) {
      throw new Error(`${workerName} 意外依赖 ESM 分块`)
    }
  }

  rows.sort((left, right) => right.bytes - left.bytes)
  return {
    javascriptFileCount: rows.length,
    chunkCount: chunks.length,
    entryBytes: bundle.length,
    entryGzipBytes: gzipSync(bundle, { level: 9 }).length,
    largestAsset: rows[0],
    totalBytes: rows.reduce((total, row) => total + row.bytes, 0),
    totalGzipBytes: rows.reduce((total, row) => total + row.gzipBytes, 0),
  }
}

const isDirectRun = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isDirectRun) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  const frontendDirectory = path.resolve(scriptDirectory, '..', 'lib', 'frontend')
  console.log(JSON.stringify(await verifyBrowserBundle(frontendDirectory), null, 2))
}
