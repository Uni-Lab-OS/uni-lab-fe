const { createHash, randomBytes, randomInt } = require('node:crypto')
const {
  chmodSync,
  chownSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} = require('node:fs')
const { createServer } = require('node:net')
const { join, resolve, sep } = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')

const activeProcesses = new Set()
const exitPromises = new WeakMap()

/**
 * 校验完整 Electron 原生载荷并解析 Backend 与 PostgreSQL 路径。
 *
 * @param {string} resourcesPath Electron 的真实 Resources 根目录。
 * @returns {{manifest: Record<string, any>, backend: string, postgresRoot: string, postgres: Record<string, string>, libraryPath: string}} 已校验运行时。
 */
function loadRuntime(resourcesPath) {
  const runtimeRoot = resolve(resourcesPath, 'runtime')
  const manifest = JSON.parse(readFileSync(join(runtimeRoot, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 2 || manifest.prototype !== true) {
    throw new Error('原生运行时 manifest schema 不匹配')
  }
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(
      `运行时平台不匹配：${String(manifest.platform)}/${String(manifest.arch)}`
    )
  }
  for (const entry of manifest.files) {
    const path = confinedPath(runtimeRoot, entry.path)
    const stats = statSync(path)
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (stats.size !== entry.bytes || digest !== entry.sha256) {
      throw new Error(`原生运行时完整性校验失败：${entry.path}`)
    }
    if ((entry.mode & 0o111) !== 0) chmodSync(path, entry.mode)
  }
  const postgresRoot = confinedPath(runtimeRoot, manifest.postgres.root)
  const postgres = Object.fromEntries(Object.entries(manifest.postgres.binaries).map(
    ([name, path]) => [name, confinedPath(postgresRoot, path)]
  ))
  const bundledLibraries = join(postgresRoot, 'runtime-lib')
  const postgresLibraries = join(
    postgresRoot,
    'usr',
    'lib',
    'postgresql',
    manifest.postgres.major,
    'lib'
  )
  return {
    manifest,
    backend: confinedPath(runtimeRoot, manifest.backend.executable),
    postgresRoot,
    postgres,
    libraryPath: [
      bundledLibraries,
      postgresLibraries,
      process.env.LD_LIBRARY_PATH || ''
    ].filter(Boolean).join(':')
  }
}

/**
 * 创建持久数据库目录与随机凭据，并为 root 测试环境切换到 postgres 系统用户。
 *
 * @param {string} dataRoot 原型隔离用户数据根目录。
 * @returns {{databaseRoot: string, clusterDirectory: string, socketDirectory: string, credentials: {user: string, database: string, password: string}, identity: {uid: number, gid: number}|null}} 数据库启动上下文。
 */
function prepareDatabase(dataRoot) {
  const databaseRoot = join(dataRoot, 'postgres')
  const clusterDirectory = join(databaseRoot, 'data')
  const socketDirectory = join(databaseRoot, 'socket')
  const credentialsPath = join(databaseRoot, 'credentials.json')
  mkdirSync(databaseRoot, { recursive: true, mode: 0o700 })
  mkdirSync(clusterDirectory, { recursive: true, mode: 0o700 })
  mkdirSync(socketDirectory, { recursive: true, mode: 0o700 })
  let credentials
  if (existsSync(credentialsPath)) {
    credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'))
  } else {
    credentials = {
      user: 'unilab',
      database: 'unilab',
      password: randomBytes(32).toString('base64url')
    }
    writeFileSync(
      credentialsPath,
      `${JSON.stringify(credentials, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    )
  }
  const identity = databaseIdentity()
  if (identity) {
    for (const path of [dataRoot, databaseRoot, clusterDirectory, socketDirectory]) {
      chownSync(path, identity.uid, identity.gid)
      chmodSync(path, 0o700)
    }
  }
  return {
    databaseRoot,
    clusterDirectory,
    socketDirectory,
    credentials,
    identity
  }
}

/**
 * 启动一个由原型监督的长驻进程并把输出写入独立日志。
 *
 * @param {{name: string, executable: string, arguments_: string[], cwd: string, environment: NodeJS.ProcessEnv, logPath: string, identity?: {uid: number, gid: number}|null}} options 进程启动参数。
 * @returns {import('node:child_process').ChildProcess} 活跃子进程。
 */
function startOwnedProcess(options) {
  const command = ownedCommand(options.executable, options.arguments_, options.identity)
  const logStream = createWriteStream(options.logPath, { flags: 'a', mode: 0o600 })
  const child = spawn(command.executable, command.arguments_, {
    cwd: options.cwd,
    env: options.environment,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.unilabName = options.name
  activeProcesses.add(child)
  child.stdout.pipe(logStream, { end: false })
  child.stderr.pipe(logStream, { end: false })
  const exitPromise = new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => resolvePromise({ code, signal }))
  }).finally(() => {
    activeProcesses.delete(child)
    logStream.end()
  })
  exitPromises.set(child, exitPromise)
  return child
}

/**
 * 执行一个短命令并完整收集输出，可用 stdin 传递一次性密码。
 *
 * @param {{executable: string, arguments_: string[], cwd: string, environment: NodeJS.ProcessEnv, identity?: {uid: number, gid: number}|null, input?: string}} options 命令参数。
 * @returns {Promise<{stdout: string, stderr: string}>} 成功命令输出。
 */
async function runOwnedCommand(options) {
  const command = ownedCommand(options.executable, options.arguments_, options.identity)
  const child = spawn(command.executable, command.arguments_, {
    cwd: options.cwd,
    env: options.environment,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.stdin.on('error', () => {})
  const exitPromise = new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => resolvePromise({ code, signal }))
  })
  child.stdin.end(options.input || '')
  const { code, signal } = await exitPromise
  if (code !== 0) {
    throw new Error(
      `${options.executable} 失败 code=${String(code)} signal=${String(signal)}\n${stdout}\n${stderr}`
    )
  }
  return { stdout, stderr }
}

/**
 * 等待 HTTP 路由达到指定状态，并把被监督进程提前退出视为失败。
 *
 * @param {string} url 回环健康检查 URL。
 * @param {import('node:child_process').ChildProcess} child 对应服务进程。
 * @param {number} expectedStatus 期望 HTTP 状态码。
 * @param {number} timeoutMs 最大等待时间。
 * @returns {Promise<{status: number, body: unknown}>} 最后一次成功响应。
 */
async function waitForHttp(url, child, expectedStatus, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    assertRunning(child)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      const text = await response.text()
      if (response.status === expectedStatus) {
        let body = text
        try { body = JSON.parse(text) } catch {}
        return { status: response.status, body }
      }
      lastError = new Error(`${url} HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`${url} 就绪超时：${String(lastError)}`)
}

/**
 * 等待 PostgreSQL TCP 监听建立。
 *
 * @param {number} port PostgreSQL 回环端口。
 * @param {import('node:child_process').ChildProcess} child PostgreSQL 进程。
 * @returns {Promise<void>} TCP 可连接时返回。
 */
async function waitForPostgres(port, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    assertRunning(child)
    const server = await probeTcp(port)
    if (server) return
    await delay(100)
  }
  throw new Error(`PostgreSQL 就绪超时：127.0.0.1:${port}`)
}

/**
 * 优雅停止一个受监督进程，超时后强制回收。
 *
 * @param {import('node:child_process').ChildProcess} child 待停止进程。
 * @param {NodeJS.Signals} [signal] 初始信号。
 * @returns {Promise<void>} 进程退出后返回。
 */
async function stopOwnedProcess(child, signal = 'SIGTERM') {
  if (!isRunning(child)) return
  child.kill(signal)
  await Promise.race([exitPromises.get(child), delay(5_000)])
  if (isRunning(child)) {
    child.kill('SIGKILL')
    await exitPromises.get(child)
  }
}

/**
 * 申请一段相邻回环端口；关闭预约 socket 后立即交给目标服务使用。
 *
 * @param {number} count 所需连续端口数量。
 * @returns {Promise<number[]>} 从低到高排列的端口。
 */
async function freePortBlock(count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const base = randomInt(20_000, 55_000 - count)
    const servers = []
    try {
      for (let offset = 0; offset < count; offset += 1) {
        const server = createServer()
        servers.push(server)
        await new Promise((resolvePromise, rejectPromise) => {
          server.once('error', rejectPromise)
          server.listen(base + offset, '127.0.0.1', resolvePromise)
        })
      }
      await Promise.all(servers.map(closeServer))
      return Array.from({ length: count }, (_, index) => base + index)
    } catch {
      await Promise.all(servers.map((server) => server.listening
        ? closeServer(server)
        : Promise.resolve()))
    }
  }
  throw new Error(`无法预约 ${count} 个连续回环端口`)
}

/**
 * 递归计算持久数据库目录字节数。
 *
 * @param {string} root 数据目录。
 * @returns {number} 全部文件字节数。
 */
function directoryBytes(root) {
  let bytes = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    bytes += entry.isDirectory() ? directoryBytes(path) : statSync(path).size
  }
  return bytes
}

/**
 * 返回当前仍活跃的受监督进程数量。
 *
 * @returns {number} 活跃进程数。
 */
function activeProcessCount() {
  return [...activeProcesses].filter(isRunning).length
}

/**
 * 退出钩子尽力终止全部受监督进程，不执行异步等待。
 *
 * @returns {void} 信号发出后返回。
 */
function killOwnedProcesses() {
  for (const child of activeProcesses) {
    if (isRunning(child)) child.kill('SIGKILL')
  }
}

/**
 * 将不可信 manifest 相对路径限制在指定资源根目录内。
 *
 * @param {string} root 可信根目录。
 * @param {string} relativePath manifest 相对路径。
 * @returns {string} 已限制的绝对路径。
 */
function confinedPath(root, relativePath) {
  if (typeof relativePath !== 'string') throw new Error('manifest 路径不是字符串')
  const path = resolve(root, relativePath)
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`manifest 路径越界：${relativePath}`)
  }
  return path
}

/**
 * 在 root 测试环境中解析 postgres 系统账户，普通桌面用户无需切换身份。
 *
 * @returns {{uid: number, gid: number}|null} root 下的数据库进程身份。
 */
function databaseIdentity() {
  if (process.getuid?.() !== 0) return null
  const uid = Number(commandOutput('id', ['-u', 'postgres']))
  const gid = Number(commandOutput('id', ['-g', 'postgres']))
  if (!Number.isInteger(uid) || !Number.isInteger(gid)) {
    throw new Error('无法解析 postgres 测试账户')
  }
  return { uid, gid }
}

/**
 * 将命令转换为可选 setpriv 身份切换形式，确保 PostgreSQL 不以 root 运行。
 *
 * @param {string} executable 原始可执行文件。
 * @param {string[]} arguments_ 原始参数。
 * @param {{uid: number, gid: number}|null|undefined} identity 可选系统身份。
 * @returns {{executable: string, arguments_: string[]}} 最终命令。
 */
function ownedCommand(executable, arguments_, identity) {
  if (!identity) return { executable, arguments_ }
  return {
    executable: '/usr/bin/setpriv',
    arguments_: [
      `--reuid=${identity.uid}`,
      `--regid=${identity.gid}`,
      '--init-groups',
      '--',
      executable,
      ...arguments_
    ]
  }
}

/**
 * 确认服务进程尚未提前退出。
 *
 * @param {import('node:child_process').ChildProcess} child 服务进程。
 * @returns {void} 进程活跃时返回。
 */
function assertRunning(child) {
  if (!isRunning(child)) {
    throw new Error(`${child.unilabName || '子进程'} 提前退出`)
  }
}

/**
 * 判断子进程是否仍未收到退出状态。
 *
 * @param {import('node:child_process').ChildProcess} child 子进程。
 * @returns {boolean} 仍运行时为 true。
 */
function isRunning(child) {
  return child.exitCode === null && child.signalCode === null
}

/**
 * 探测一次回环 TCP 端口。
 *
 * @param {number} port 目标端口。
 * @returns {Promise<boolean>} 连接成功时为 true。
 */
async function probeTcp(port) {
  const socket = require('node:net').createConnection({ host: '127.0.0.1', port })
  return await new Promise((resolvePromise) => {
    socket.once('connect', () => { socket.destroy(); resolvePromise(true) })
    socket.once('error', () => { socket.destroy(); resolvePromise(false) })
    socket.setTimeout(500, () => { socket.destroy(); resolvePromise(false) })
  })
}

/**
 * 关闭一个临时端口预约 server。
 *
 * @param {import('node:net').Server} server 监听中的 server。
 * @returns {Promise<void>} 关闭完成时返回。
 */
function closeServer(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise())
  })
}

/**
 * 执行只读系统命令并返回标准输出。
 *
 * @param {string} command 命令名。
 * @param {string[]} arguments_ 独立参数列表。
 * @returns {string} 去除尾部空白的输出。
 */
function commandOutput(command, arguments_) {
  const result = spawnSync(command, arguments_, { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(`${command} 执行失败`)
  return result.stdout.trim()
}

module.exports = {
  activeProcessCount,
  directoryBytes,
  freePortBlock,
  killOwnedProcesses,
  loadRuntime,
  prepareDatabase,
  runOwnedCommand,
  startOwnedProcess,
  stopOwnedProcess,
  waitForHttp,
  waitForPostgres
}
