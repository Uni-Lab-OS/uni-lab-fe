const { app, BrowserWindow } = require('electron')
const {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync
} = require('node:fs')
const { join } = require('node:path')
const {
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
} = require('./electron-processes.cjs')

const RESULT_PREFIX = 'UNILAB_EMBEDDED_SCHEDULER_RESULT='
let rendererProbeWindow = null

process.on('exit', killOwnedProcesses)
/** 原型关闭隐藏探针窗口后继续完成调度与重启验证。 */
app.on('window-all-closed', () => {})
app.whenReady().then(runPrototype).catch(failPrototype)

/**
 * 在真实 Electron Resources 中验证数据库、Backend HTTP 与调度器（Scheduler）整栈生命周期。
 *
 * @returns {Promise<void>} 两个世代验证、结构化输出与退出完成后返回。
 */
async function runPrototype() {
  const runtime = loadRuntime(process.resourcesPath)
  const dataRoot = process.env.UNILAB_PROTOTYPE_DATA_DIR || app.getPath('userData')
  const logsDirectory = join(dataRoot, 'logs')
  mkdirSync(logsDirectory, { recursive: true, mode: 0o700 })
  const database = prepareDatabase(dataRoot)
  const postgresEnvironment = {
    ...process.env,
    LD_LIBRARY_PATH: runtime.libraryPath
  }
  const initializedNow = await initializeCluster(
    runtime,
    database,
    postgresEnvironment
  )

  const first = await startStack({
    runtime,
    database,
    postgresEnvironment,
    logsDirectory,
    generation: 1
  })
  const rendererDirectFetch = await probeRendererDirectFetch(
    `${first.snapshot.backendBaseUrl}/api/v1/health`
  )
  const duplicateScheduler = await probeDuplicateScheduler({
    runtime,
    database,
    logsDirectory,
    dsn: first.dsn,
    port: first.duplicateSchedulerPort,
    generation: 1
  })
  await stopStack(first)
  const databaseBytesAfterFirstStop = directoryBytes(database.clusterDirectory)

  const second = await startStack({
    runtime,
    database,
    postgresEnvironment,
    logsDirectory,
    generation: 2
  })
  await stopStack(second)
  const databaseBytesAfterRestart = directoryBytes(database.clusterDirectory)
  const remainingProcesses = activeProcessCount()
  if (remainingProcesses !== 0) {
    throw new Error(`逆序停机后仍有 ${remainingProcesses} 个受监督进程`)
  }

  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
    outcome: 'PASS',
    resourcesPath: process.resourcesPath,
    manifest: {
      schemaVersion: runtime.manifest.schemaVersion,
      sourceEvidence: runtime.manifest.sourceEvidence,
      postgres: runtime.manifest.postgres.version,
      timescale: runtime.manifest.timescale,
      integrityFileCount: runtime.manifest.files.length
    },
    dataRoot,
    initializedNow,
    databaseBytesAfterFirstStop,
    databaseBytesAfterRestart,
    rendererDirectFetch,
    duplicateScheduler,
    generations: [first.snapshot, second.snapshot],
    shutdownOrder: ['scheduler', 'backend-http', 'postgresql'],
    remainingProcesses
  })}\n`)
  app.exit(0)
}

/**
 * 首次运行时初始化持久 PostgreSQL cluster，并设置随机 SCRAM 主机口令。
 *
 * @param {ReturnType<typeof loadRuntime>} runtime 已校验原生运行时。
 * @param {ReturnType<typeof prepareDatabase>} database 数据库目录与凭据。
 * @param {NodeJS.ProcessEnv} postgresEnvironment PostgreSQL 动态库环境。
 * @returns {Promise<boolean>} 本轮执行 initdb 时为 true。
 */
async function initializeCluster(runtime, database, postgresEnvironment) {
  if (existsSync(join(database.clusterDirectory, 'PG_VERSION'))) return false
  const passwordPath = join(database.databaseRoot, 'initdb-password')
  writeFileSync(passwordPath, `${database.credentials.password}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  chmodSync(passwordPath, 0o600)
  if (database.identity) {
    chownSync(passwordPath, database.identity.uid, database.identity.gid)
  }
  try {
    await runOwnedCommand({
      executable: runtime.postgres.initdb,
      arguments_: [
        '-D',
        database.clusterDirectory,
        '--auth-host=scram-sha-256',
        '--auth-local=trust',
        '--no-locale',
        '--encoding=UTF8',
        `--username=${database.credentials.user}`,
        `--pwfile=${passwordPath}`
      ],
      cwd: database.databaseRoot,
      environment: postgresEnvironment,
      identity: database.identity
    })
  } finally {
    if (existsSync(passwordPath)) unlinkSync(passwordPath)
  }
  return true
}

/**
 * 启动一个 PostgreSQL + Backend HTTP + 调度器（Scheduler）世代并等待联合就绪。
 *
 * @param {{runtime: ReturnType<typeof loadRuntime>, database: ReturnType<typeof prepareDatabase>, postgresEnvironment: NodeJS.ProcessEnv, logsDirectory: string, generation: number}} options 世代启动上下文。
 * @returns {Promise<{postgres: import('node:child_process').ChildProcess, backend: import('node:child_process').ChildProcess, scheduler: import('node:child_process').ChildProcess, dsn: string, duplicateSchedulerPort: number, snapshot: Record<string, unknown>}>} 活跃进程与证据。
 */
async function startStack(options) {
  const [postgresPort, backendPort, schedulerPort, duplicateSchedulerPort] =
    await freePortBlock(4)
  const postgresLog = join(
    options.logsDirectory,
    `postgres-generation-${options.generation}.log`
  )
  const backendLog = join(
    options.logsDirectory,
    `backend-generation-${options.generation}.log`
  )
  const schedulerLog = join(
    options.logsDirectory,
    `scheduler-generation-${options.generation}.log`
  )
  const postgres = startOwnedProcess({
    name: `PostgreSQL generation ${options.generation}`,
    executable: options.runtime.postgres.postgres,
    arguments_: [
      '-D',
      options.database.clusterDirectory,
      '-h',
      '127.0.0.1',
      '-p',
      String(postgresPort),
      '-k',
      options.database.socketDirectory,
      '-c',
      'shared_preload_libraries=timescaledb',
      '-c',
      'unix_socket_permissions=0700',
      '-c',
      'max_connections=64',
      '-c',
      'jit=off'
    ],
    cwd: options.database.databaseRoot,
    environment: options.postgresEnvironment,
    logPath: postgresLog,
    identity: options.database.identity
  })
  await waitForPostgres(postgresPort, postgres)
  const dsn = databaseDsn(options.database.credentials, postgresPort)
  await ensureApplicationDatabase(
    options.runtime,
    options.database,
    options.postgresEnvironment,
    postgresPort
  )

  const serviceEnvironment = backendEnvironment(dsn)
  const backend = startOwnedProcess({
    name: `Backend HTTP generation ${options.generation}`,
    executable: options.runtime.backend,
    arguments_: ['server'],
    cwd: options.database.databaseRoot,
    environment: {
      ...serviceEnvironment,
      HTTP_ADDR: `127.0.0.1:${backendPort}`
    },
    logPath: backendLog
  })
  const backendBaseUrl = `http://127.0.0.1:${backendPort}`
  const backendHealth = await waitForHttp(
    `${backendBaseUrl}/api/v1/health`,
    backend,
    200
  )
  await waitForHttp(
    `${backendBaseUrl}/api/v1/workflows?page=1&page_size=1`,
    backend,
    200
  )

  const scheduler = startOwnedProcess({
    name: `Scheduler generation ${options.generation}`,
    executable: options.runtime.backend,
    arguments_: ['scheduler'],
    cwd: options.database.databaseRoot,
    environment: {
      ...serviceEnvironment,
      SCHEDULER_ADDR: `127.0.0.1:${schedulerPort}`,
      SCHEDULER_SCAN_INTERVAL: '100ms'
    },
    logPath: schedulerLog
  })
  const schedulerBaseUrl = `http://127.0.0.1:${schedulerPort}`
  const schedulerLive = await waitForHttp(
    `${schedulerBaseUrl}/health/live`,
    scheduler,
    200
  )
  const schedulerReady = await waitForHttp(
    `${schedulerBaseUrl}/health/ready`,
    scheduler,
    200
  )
  const databaseEvidence = await readDatabaseEvidence({
    runtime: options.runtime,
    database: options.database,
    environment: options.postgresEnvironment,
    port: postgresPort
  })
  return {
    postgres,
    backend,
    scheduler,
    dsn,
    duplicateSchedulerPort,
    snapshot: {
      generation: options.generation,
      pids: {
        postgresql: postgres.pid,
        backendHttp: backend.pid,
        scheduler: scheduler.pid
      },
      ports: { postgresql: postgresPort, backendHttp: backendPort, scheduler: schedulerPort },
      schedulerIsBackendPlusOne: schedulerPort === backendPort + 1,
      backendBaseUrl,
      schedulerBaseUrl,
      backendHealth,
      schedulerLive,
      schedulerReady,
      databaseEvidence,
      logs: { postgresql: postgresLog, backendHttp: backendLog, scheduler: schedulerLog }
    }
  }
}

/**
 * 创建首次使用的应用数据库；后续世代复用同一持久数据库。
 *
 * @param {ReturnType<typeof loadRuntime>} runtime 已校验运行时。
 * @param {ReturnType<typeof prepareDatabase>} database 数据库上下文。
 * @param {NodeJS.ProcessEnv} environment PostgreSQL 环境。
 * @param {number} port PostgreSQL 回环端口。
 * @returns {Promise<void>} 数据库存在时返回。
 */
async function ensureApplicationDatabase(runtime, database, environment, port) {
  const connection = postgresConnectionArguments(database.credentials, port, 'postgres')
  const query = await runOwnedCommand({
    executable: runtime.postgres.psql,
    arguments_: [
      '-X',
      ...connection,
      '-At',
      '-c',
      `SELECT 1 FROM pg_database WHERE datname='${database.credentials.database}'`
    ],
    cwd: database.databaseRoot,
    environment: { ...environment, PGPASSWORD: database.credentials.password },
    identity: database.identity
  })
  if (query.stdout.trim() === '1') return
  await runOwnedCommand({
    executable: runtime.postgres.createdb,
    arguments_: [
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      database.credentials.user,
      database.credentials.database
    ],
    cwd: database.databaseRoot,
    environment: { ...environment, PGPASSWORD: database.credentials.password },
    identity: database.identity
  })
}

/**
 * 读取迁移版本、TimescaleDB 版本与 hypertable 事实作为联合就绪证据。
 *
 * @param {{runtime: ReturnType<typeof loadRuntime>, database: ReturnType<typeof prepareDatabase>, environment: NodeJS.ProcessEnv, port: number}} options 查询上下文。
 * @returns {Promise<Record<string, unknown>>} PostgreSQL JSON 证据。
 */
async function readDatabaseEvidence(options) {
  const sql = `SELECT json_build_object(
    'server_version', current_setting('server_version'),
    'timescale_version', (SELECT extversion FROM pg_extension WHERE extname='timescaledb'),
    'material_history_hypertable', EXISTS (
      SELECT 1 FROM timescaledb_information.hypertables
      WHERE hypertable_schema='public' AND hypertable_name='material_state_history'
    ),
    'migration_version', (SELECT version FROM schema_migrations)
  )::text`
  const result = await runOwnedCommand({
    executable: options.runtime.postgres.psql,
    arguments_: [
      '-X',
      ...postgresConnectionArguments(
        options.database.credentials,
        options.port,
        options.database.credentials.database
      ),
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql
    ],
    cwd: options.database.databaseRoot,
    environment: {
      ...options.environment,
      PGPASSWORD: options.database.credentials.password
    },
    identity: options.database.identity
  })
  return JSON.parse(result.stdout.trim())
}

/**
 * 启动第二个调度器（Scheduler）并验证 advisory lock 使其 live 但不 ready。
 *
 * @param {{runtime: ReturnType<typeof loadRuntime>, database: ReturnType<typeof prepareDatabase>, logsDirectory: string, dsn: string, port: number, generation: number}} options 重复实例上下文。
 * @returns {Promise<Record<string, unknown>>} 单实例门禁证据。
 */
async function probeDuplicateScheduler(options) {
  const logPath = join(options.logsDirectory, 'scheduler-duplicate.log')
  const child = startOwnedProcess({
    name: 'duplicate Scheduler',
    executable: options.runtime.backend,
    arguments_: ['scheduler'],
    cwd: options.database.databaseRoot,
    environment: {
      ...backendEnvironment(options.dsn),
      SCHEDULER_ADDR: `127.0.0.1:${options.port}`,
      SCHEDULER_SCAN_INTERVAL: '100ms'
    },
    logPath
  })
  const baseUrl = `http://127.0.0.1:${options.port}`
  const live = await waitForHttp(`${baseUrl}/health/live`, child, 200)
  const ready = await waitForHttp(`${baseUrl}/health/ready`, child, 503)
  await stopOwnedProcess(child)
  return { pid: child.pid, baseUrl, live, ready, logPath }
}

/**
 * 按调度器（Scheduler）→ Backend HTTP → PostgreSQL 顺序停止完整世代。
 *
 * @param {{scheduler: import('node:child_process').ChildProcess, backend: import('node:child_process').ChildProcess, postgres: import('node:child_process').ChildProcess}} stack 活跃世代。
 * @returns {Promise<void>} 三个进程退出后返回。
 */
async function stopStack(stack) {
  await stopOwnedProcess(stack.scheduler)
  await stopOwnedProcess(stack.backend)
  await stopOwnedProcess(stack.postgres, 'SIGINT')
}

/**
 * 使用默认 Web 安全策略验证 file renderer 可读取 Backend HTTP 健康路由。
 *
 * @param {string} healthUrl Backend 健康检查 URL。
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>} renderer 探针结果。
 */
async function probeRendererDirectFetch(healthUrl) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  rendererProbeWindow = window
  await window.loadFile(join(__dirname, 'renderer-probe.html'))
  const result = await window.webContents.executeJavaScript(`
    fetch(${JSON.stringify(healthUrl)})
      .then((response) => ({ ok: response.ok, status: response.status }))
      .catch((error) => ({ ok: false, error: String(error) }))
  `)
  window.destroy()
  rendererProbeWindow = null
  return result
}

/**
 * 生成两个服务进程共用且不暴露给输出的 PostgreSQL DSN。
 *
 * @param {{user: string, database: string, password: string}} credentials 数据库身份。
 * @param {number} port PostgreSQL 回环端口。
 * @returns {string} 带 URL 编码口令的 DSN。
 */
function databaseDsn(credentials, port) {
  return `postgres://${encodeURIComponent(credentials.user)}:${encodeURIComponent(credentials.password)}@127.0.0.1:${port}/${encodeURIComponent(credentials.database)}?sslmode=disable`
}

/**
 * 生成 Backend HTTP 与调度器（Scheduler）共享的数据库和可观测性环境。
 *
 * @param {string} dsn PostgreSQL 连接串。
 * @returns {NodeJS.ProcessEnv} 服务环境变量。
 */
function backendEnvironment(dsn) {
  return {
    ...process.env,
    ENV_FILE: '',
    DB_DRIVER: 'postgres',
    DATABASE_DSN: dsn,
    OBSERVABILITY_ENABLED: 'false',
    GIN_MODE: 'release'
  }
}

/**
 * 生成 psql 的公共回环连接参数。
 *
 * @param {{user: string}} credentials 数据库用户身份。
 * @param {number} port PostgreSQL 回环端口。
 * @param {string} database 数据库名。
 * @returns {string[]} psql 参数。
 */
function postgresConnectionArguments(credentials, port, database) {
  return [
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    credentials.user,
    '-d',
    database
  ]
}

/**
 * 主流程失败时输出诊断、终止子进程并让 Electron 返回非零状态。
 *
 * @param {unknown} error 未处理错误。
 * @returns {void} 不返回业务结果。
 */
function failPrototype(error) {
  const message = error instanceof Error ? error.stack : String(error)
  process.stderr.write(`UNILAB_EMBEDDED_SCHEDULER_ERROR=${message}\n`)
  killOwnedProcesses()
  rendererProbeWindow?.destroy()
  app.exit(1)
}
