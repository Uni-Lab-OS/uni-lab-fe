const { app, BrowserWindow } = require('electron')
const { createHash } = require('node:crypto')
const { once } = require('node:events')
const {
  createWriteStream,
  mkdirSync,
  readFileSync,
  statSync
} = require('node:fs')
const { createServer } = require('node:net')
const { join, resolve, sep } = require('node:path')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')

const RESULT_PREFIX = 'UNILAB_EMBEDDED_BACKEND_RESULT='
const READY_TIMEOUT_MS = 30_000
let activeBackend = null
let rendererProbeWindow = null

process.on('exit', stopBackendOnProcessExit)
app.whenReady().then(runPrototype, failPrototype)

/**
 * 在真实 Electron resourcesPath 中启动、停止并重启被打包的 Backend。
 *
 * @returns {Promise<void>} 结构化结果写入 stdout 并退出应用后完成。
 * @throws 资源校验、迁移、健康检查或重启失败时抛出错误。
 */
async function runPrototype() {
  const manifestPath = join(process.resourcesPath, 'backend', 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const executablePath = resolveBackendExecutable(manifest)
  const dataRoot = process.env.UNILAB_PROTOTYPE_DATA_DIR || app.getPath('userData')
  const backendDataDirectory = join(dataRoot, 'backend')
  const logsDirectory = join(dataRoot, 'logs')
  // databasePath 是候选本地桌面后端（DesktopEmbeddedBackend）的持久事实路径。
  const databasePath = join(backendDataDirectory, 'unilab.db')
  mkdirSync(backendDataDirectory, { recursive: true, mode: 0o700 })
  mkdirSync(logsDirectory, { recursive: true, mode: 0o700 })

  const firstPort = await freeLoopbackPort()
  const first = await startBackend({
    executablePath,
    databasePath,
    logsDirectory,
    port: firstPort,
    generation: 1
  })
  const rendererDirectFetch = await probeRendererDirectFetch(
    `${first.snapshot.baseUrl}/api/v1/health`
  )
  await stopBackend(first.child)
  const databaseBytesAfterFirstStart = statSync(databasePath).size

  const secondPort = await freeLoopbackPort()
  const second = await startBackend({
    executablePath,
    databasePath,
    logsDirectory,
    port: secondPort,
    generation: 2
  })
  await stopBackend(second.child)
  const databaseBytesAfterRestart = statSync(databasePath).size

  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
    outcome: 'PASS',
    resourcesPath: process.resourcesPath,
    manifest,
    executablePath,
    databasePath,
    databaseBytesAfterFirstStart,
    databaseBytesAfterRestart,
    rendererDirectFetch,
    generations: [first.snapshot, second.snapshot]
  })}\n`)
  app.exit(0)
}

/**
 * 校验资源清单的平台、路径边界和摘要后解析 Backend 可执行文件。
 *
 * @param {{platform?: unknown, arch?: unknown, executable?: unknown, sha256?: unknown}} manifest 安装包内不可信资源清单。
 * @returns {string} 已限制在 resources/backend 下且摘要匹配的绝对路径。
 * @throws 平台不匹配、路径越界、文件缺失或 SHA-256 不匹配时抛出错误。
 */
function resolveBackendExecutable(manifest) {
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(
      `Backend payload 平台不匹配：${String(manifest.platform)}/${String(manifest.arch)}`
    )
  }
  if (typeof manifest.executable !== 'string' || typeof manifest.sha256 !== 'string') {
    throw new Error('Backend payload manifest 缺少 executable 或 sha256')
  }
  const resourceRoot = resolve(process.resourcesPath, 'backend')
  const executablePath = resolve(resourceRoot, manifest.executable)
  if (!executablePath.startsWith(`${resourceRoot}${sep}`)) {
    throw new Error('Backend payload executable 越出资源目录')
  }
  const actualSha256 = createHash('sha256')
    .update(readFileSync(executablePath))
    .digest('hex')
  if (actualSha256 !== manifest.sha256) {
    throw new Error('Backend payload SHA-256 校验失败')
  }
  return executablePath
}

/**
 * 启动一个 Backend 世代并等待健康与工作流目录均可读取。
 *
 * @param {{executablePath: string, databasePath: string, logsDirectory: string, port: number, generation: number}} options 启动所需的不可变路径、端口和世代。
 * @returns {Promise<{child: import('node:child_process').ChildProcess, snapshot: Record<string, unknown>}>} 活跃子进程及权威读模型探针结果。
 * @throws 子进程提前退出或就绪超时时抛出错误。
 */
async function startBackend(options) {
  const logPath = join(
    options.logsDirectory,
    `backend-generation-${options.generation}.log`
  )
  const logStream = createWriteStream(logPath, { flags: 'a', mode: 0o600 })
  const child = spawn(options.executablePath, ['server'], {
    cwd: join(options.databasePath, '..'),
    env: {
      ...process.env,
      HTTP_ADDR: `127.0.0.1:${options.port}`,
      DB_DRIVER: 'sqlite',
      DATABASE_DSN: options.databasePath,
      OBSERVABILITY_ENABLED: 'false',
      GIN_MODE: 'release',
      ENV_FILE: ''
    },
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  activeBackend = child
  child.stdout.pipe(logStream, { end: false })
  child.stderr.pipe(logStream, { end: false })

  const baseUrl = `http://127.0.0.1:${options.port}`
  const health = await waitForJSON(
    `${baseUrl}/api/v1/health`,
    child,
    READY_TIMEOUT_MS
  )
  const workflows = await waitForJSON(
    `${baseUrl}/api/v1/workflows?page=1&page_size=1`,
    child,
    READY_TIMEOUT_MS
  )
  return {
    child,
    snapshot: {
      generation: options.generation,
      pid: child.pid,
      baseUrl,
      health,
      workflowListReadable: workflows !== null,
      logPath
    }
  }
}

/**
 * 轮询一个 JSON 路由，同时把子进程提前退出视为明确失败。
 *
 * @param {string} url 只包含回环地址的健康或只读路由。
 * @param {import('node:child_process').ChildProcess} child 被监控的 Backend 子进程。
 * @param {number} timeoutMs 最大等待毫秒数。
 * @returns {Promise<unknown>} 成功 HTTP 响应解析出的 JSON。
 * @throws HTTP 长期未就绪、响应非 JSON 或进程提前退出时抛出错误。
 */
async function waitForJSON(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Backend 在就绪前退出：code=${String(child.exitCode)}`)
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return await response.json()
      lastError = new Error(`${url} HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`Backend 就绪超时：${url}：${String(lastError)}`)
}

/**
 * 优雅终止当前 Backend 世代，超时后强制回收。
 *
 * @param {import('node:child_process').ChildProcess} child 待停止的 Backend 子进程。
 * @returns {Promise<void>} 进程退出后完成。
 */
async function stopBackend(child) {
  if (child.exitCode === null) {
    child.kill()
    await Promise.race([once(child, 'exit'), delay(5_000)])
  }
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
  if (activeBackend === child) activeBackend = null
}

/**
 * 使用与正式 Kernel Web 相同的默认 Web 安全策略探测 file renderer 直连 Backend。
 *
 * @param {string} healthUrl 本轮动态 Backend 的 v1 健康地址。
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>} 浏览器可见的 CORS 结果。
 */
async function probeRendererDirectFetch(healthUrl) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  rendererProbeWindow = window
  await window.loadFile(join(__dirname, 'renderer-probe.html'))
  const result = await window.webContents.executeJavaScript(`
    fetch(${JSON.stringify(healthUrl)})
      .then((response) => ({ ok: response.ok, status: response.status }))
      .catch((error) => ({ ok: false, error: String(error) }))
  `)
  return result
}

/**
 * 向操作系统申请一个临时回环端口并立即释放给待启动服务。
 *
 * @returns {Promise<number>} 当前可用的 TCP 端口。
 * @throws 监听或关闭临时套接字失败时抛出错误。
 */
async function freeLoopbackPort() {
  const server = createServer()
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('无法解析临时回环端口')
  }
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise())
  })
  return address.port
}

/**
 * Electron 主流程失败时回收 Backend，并以非零状态结束原型。
 *
 * @param {unknown} error 未处理的启动或验收错误。
 * @returns {void} 不返回业务结果。
 */
function failPrototype(error) {
  const message = error instanceof Error ? error.stack : String(error)
  process.stderr.write(`UNILAB_EMBEDDED_BACKEND_ERROR=${message}\n`)
  if (activeBackend?.exitCode === null) activeBackend.kill()
  rendererProbeWindow?.destroy()
  app.exit(1)
}

/**
 * Node 退出钩子尽力终止仍由本原型拥有的 Backend 子进程。
 *
 * @returns {void} 退出钩子不能异步等待。
 */
function stopBackendOnProcessExit() {
  if (activeBackend?.exitCode === null) activeBackend.kill()
}
