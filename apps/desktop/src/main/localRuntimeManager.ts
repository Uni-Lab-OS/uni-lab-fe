import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { constants as fsConstants, createWriteStream } from 'node:fs'
import { access, mkdir, open, stat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { basename, delimiter, dirname, join, normalize, resolve } from 'node:path'

import {
  IDLE_LOCAL_RUNTIME_SNAPSHOT,
  type LocalRuntimeLaunchConfig,
  type LocalRuntimeLogEntry,
  type LocalRuntimeLogsSnapshot,
  type LocalRuntimeProcessKind,
  type LocalRuntimeSnapshot
} from '../shared/localRuntime'

export interface LocalRuntimeSpawnSpec {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

export interface LocalRuntimeLaunchPlan {
  runtimeDirectory: string
  edge: LocalRuntimeSpawnSpec
}

export interface LocalSimulatorLaunchPlan {
  simulator: LocalRuntimeSpawnSpec
}

interface ResolvedRuntimeConfig {
  platform: NodeJS.Platform
  graphPath: string
  osProjectPath: string
  szlabProjectPath: string
  environmentPath: string
  unilabExecutable: string
  localConfigPath: string
  runtimeDirectory: string
}

interface ResolvedSimulatorConfig {
  platform: NodeJS.Platform
  environmentPath: string
  pythonExecutable: string
  workingDirectory: string
}

interface PortRequirement {
  port: number
  label: string
}

type SnapshotListener = (snapshot: LocalRuntimeSnapshot) => void
type ActiveOperation = 'simulator' | 'edge' | 'all'

export const LOCAL_RUNTIME_PORTS = {
  simulator: 18_765,
  edgeHttp: 18_003
} as const

const HOST = '127.0.0.1'
const OS_HEALTH_URL =
  `http://${HOST}:${LOCAL_RUNTIME_PORTS.edgeHttp}/api/v1/health`
const WORKFLOW_TEMPLATE_CATALOG_URL =
  `http://${HOST}:${LOCAL_RUNTIME_PORTS.edgeHttp}/api/v1/workflow-node-templates`
const DEVICE_CATALOG_URL =
  `http://${HOST}:${LOCAL_RUNTIME_PORTS.edgeHttp}/api/v1/devices`
const PROCESS_READY_TIMEOUT_MS = 90_000
const LOCAL_RUNTIME_LOG_READ_LIMIT_BYTES = 128 * 1024
const LOCAL_RUNTIME_LOG_KINDS: readonly LocalRuntimeProcessKind[] = [
  'simulator',
  'edge'
]

export class LocalRuntimeManager {
  private snapshot: LocalRuntimeSnapshot = {
    ...IDLE_LOCAL_RUNTIME_SNAPSHOT
  }
  private edgeProcess: ChildProcessWithoutNullStreams | null = null
  private simulatorProcess: ChildProcessWithoutNullStreams | null = null
  private readonly expectedExits = new WeakSet<ChildProcessWithoutNullStreams>()
  private stopping = false
  private activeOperation: ActiveOperation | null = null

  constructor(
    private readonly logsDirectory: string,
    private readonly onSnapshot: SnapshotListener
  ) {}

  getSnapshot(): LocalRuntimeSnapshot {
    return { ...this.snapshot }
  }

  readLogs(): Promise<LocalRuntimeLogsSnapshot> {
    return readLocalRuntimeLogs(this.logsDirectory)
  }

  async startSimulator(
    config: LocalRuntimeLaunchConfig
  ): Promise<LocalRuntimeSnapshot> {
    this.beginOperation('simulator')
    if (this.simulatorProcess) {
      this.activeOperation = null
      throw new Error('PLC-Sim 已在运行')
    }
    if (this.edgeProcess) {
      this.activeOperation = null
      throw new Error('请先停止领域侧 Edge，再启动 PLC-Sim')
    }

    this.publishState('validating_simulator', '正在检查 PLC-Sim 与 Conda 环境…')

    try {
      const plan = await resolveLocalSimulatorLaunchPlan(config)
      await requireAvailablePorts([{
        port: LOCAL_RUNTIME_PORTS.simulator,
        label: 'OPC UA'
      }])
      await mkdir(this.logsDirectory, { recursive: true })
      this.publishState('starting_simulator', '正在启动 PLC-Sim OPC UA…')
      this.simulatorProcess = this.spawnManaged('simulator', plan.simulator)
      this.publishState('waiting_simulator', 'PLC-Sim 已启动，正在等待 18765 端口…')
      await waitForPort(
        HOST,
        LOCAL_RUNTIME_PORTS.simulator,
        [{ child: this.simulatorProcess, label: 'PLC-Sim OPC UA' }],
        PROCESS_READY_TIMEOUT_MS
      )
      this.publishState(
        'simulator_ready',
        'PLC-Sim 已就绪；请上传 PLC 变量表后再启动领域侧 Edge'
      )
      return this.getSnapshot()
    } catch (error) {
      const message = errorMessage(error)
      this.stopping = true
      await this.stopSimulatorProcess()
      this.stopping = false
      this.publishFailure('PLC-Sim 启动失败', 'simulator', message)
      throw new Error(message)
    } finally {
      this.activeOperation = null
    }
  }

  async startEdge(
    config: LocalRuntimeLaunchConfig
  ): Promise<LocalRuntimeSnapshot> {
    this.beginOperation('edge')
    if (this.edgeProcess) {
      this.activeOperation = null
      throw new Error('领域侧 Edge 已在运行')
    }

    this.publishState('validating_edge', '正在检查 Edge 项目、Conda 环境与固定端口…')

    try {
      const plan = await resolveLocalRuntimeLaunchPlan(config)
      await requireAvailablePorts([
        { port: LOCAL_RUNTIME_PORTS.edgeHttp, label: '领域侧 Edge HTTP' }
      ])
      await mkdir(this.logsDirectory, { recursive: true })
      await mkdir(plan.runtimeDirectory, { recursive: true })

      this.publishState('starting_edge', '正在通过 unilab CLI 启动 ROS Edge…')
      this.edgeProcess = this.spawnManaged('edge', plan.edge)
      this.publishState('waiting_edge', '领域侧 Edge 正在初始化 HostNode…')
      await waitForHttp(
        OS_HEALTH_URL,
        managedChildren([
          ['simulator', this.simulatorProcess],
          ['edge', this.edgeProcess]
        ]),
        PROCESS_READY_TIMEOUT_MS,
        (payload) => isRecord(payload) && payload['status'] === 'ok'
      )

      this.publishState('waiting_edge', 'HostNode 已启动，正在等待工作流模板目录…')
      await waitForHttp(
        WORKFLOW_TEMPLATE_CATALOG_URL,
        managedChildren([
          ['simulator', this.simulatorProcess],
          ['edge', this.edgeProcess]
        ]),
        PROCESS_READY_TIMEOUT_MS,
        () => true
      )

      this.publishState('waiting_edge', '工作流目录已就绪，正在等待设备运行时…')
      await waitForHttp(
        DEVICE_CATALOG_URL,
        managedChildren([
          ['simulator', this.simulatorProcess],
          ['edge', this.edgeProcess]
        ]),
        PROCESS_READY_TIMEOUT_MS,
        isDeviceCatalogReady
      )

      this.publishState(
        'ready',
        this.simulatorProcess
          ? 'PLC-Sim 与领域侧 Edge 已就绪'
          : '领域侧 Edge 已就绪'
      )
      return this.getSnapshot()
    } catch (error) {
      const message = errorMessage(error)
      this.stopping = true
      await this.stopEdgeProcesses()
      this.stopping = false
      this.publishFailure('领域侧 Edge 启动失败', 'edge', message)
      throw new Error(message)
    } finally {
      this.activeOperation = null
    }
  }

  async stopSimulator(): Promise<LocalRuntimeSnapshot> {
    this.beginOperation('simulator')
    if (this.edgeProcess) {
      this.activeOperation = null
      throw new Error('请先停止领域侧 Edge，再停止 PLC-Sim')
    }
    if (!this.simulatorProcess) {
      this.activeOperation = null
      return this.getSnapshot()
    }

    this.stopping = true
    this.publishState('stopping_simulator', '正在停止 PLC-Sim…')
    try {
      await this.stopSimulatorProcess()
      this.stopping = false
      this.publish({ ...IDLE_LOCAL_RUNTIME_SNAPSHOT })
      return this.getSnapshot()
    } finally {
      this.stopping = false
      this.activeOperation = null
    }
  }

  async stopEdge(): Promise<LocalRuntimeSnapshot> {
    this.beginOperation('edge')
    if (!this.edgeProcess) {
      this.activeOperation = null
      return this.getSnapshot()
    }

    this.stopping = true
    this.publishState('stopping_edge', '正在停止领域侧 Edge…')
    try {
      await this.stopEdgeProcesses()
      this.stopping = false
      if (this.simulatorProcess) {
        this.publishState(
          'simulator_ready',
          'PLC-Sim 仍在运行；上传变量表后可再次启动领域侧 Edge'
        )
      } else {
        this.publish({ ...IDLE_LOCAL_RUNTIME_SNAPSHOT })
      }
      return this.getSnapshot()
    } finally {
      this.stopping = false
      this.activeOperation = null
    }
  }

  async stop(): Promise<LocalRuntimeSnapshot> {
    this.activeOperation = 'all'
    this.stopping = true
    this.publishState('stopping_edge', '正在停止本地服务…')
    await this.stopProcesses()
    this.stopping = false
    this.activeOperation = null
    this.publish({ ...IDLE_LOCAL_RUNTIME_SNAPSHOT })
    return this.getSnapshot()
  }

  private beginOperation(operation: ActiveOperation): void {
    if (this.activeOperation) {
      throw new Error('本地服务正在执行其他操作，请稍后再试')
    }
    this.activeOperation = operation
    this.stopping = false
  }

  private spawnManaged(
    kind: LocalRuntimeProcessKind,
    spec: LocalRuntimeSpawnSpec
  ): ChildProcessWithoutNullStreams {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      detached: process.platform !== 'win32',
      shell: false,
      windowsHide: true
    })
    const logStream = createWriteStream(
      join(this.logsDirectory, `${kind}.log`),
      { flags: 'a' }
    )
    logStream.write(`\n[launcher] ${new Date().toISOString()} starting\n`)
    child.stdout.pipe(logStream, { end: false })
    child.stderr.pipe(logStream, { end: false })
    child.once('error', (error) => {
      logStream.write(`\n[launcher] ${error.message}\n`)
    })
    child.once('close', (code, signal) => {
      const expectedExit = this.expectedExits.delete(child)
      logStream.end(
        `\n[launcher] process exited code=${String(code)} signal=${String(signal)}\n`
      )
      this.clearProcess(kind, child)
      if (
        !expectedExit
        && !this.stopping
        && !this.activeOperation
        && this.snapshot.phase !== 'failed'
      ) {
        void this.handleUnexpectedExit(kind)
      }
    })
    return child
  }

  private clearProcess(
    kind: LocalRuntimeProcessKind,
    child: ChildProcessWithoutNullStreams
  ): void {
    if (kind === 'simulator' && this.simulatorProcess === child) {
      this.simulatorProcess = null
    }
    if (kind === 'edge' && this.edgeProcess === child) {
      this.edgeProcess = null
    }
  }

  private async handleUnexpectedExit(
    kind: LocalRuntimeProcessKind
  ): Promise<void> {
    const label = processLabel(kind)
    this.stopping = true
    if (kind === 'simulator') {
      await this.stopProcesses()
    } else {
      await this.stopEdgeProcesses()
    }
    this.stopping = false
    this.publishFailure(
      `${label} 已意外退出`,
      kind,
      '请点击右上角“查看日志”检查本地启动输出'
    )
  }

  private async stopSimulatorProcess(): Promise<void> {
    const child = this.simulatorProcess
    this.simulatorProcess = null
    if (child) {
      this.expectedExits.add(child)
      await stopProcessTree(child)
    }
  }

  private async stopEdgeProcesses(): Promise<void> {
    const processes = [this.edgeProcess]
    this.edgeProcess = null
    for (const child of processes) {
      if (child) {
        this.expectedExits.add(child)
        await stopProcessTree(child)
      }
    }
  }

  private async stopProcesses(): Promise<void> {
    await this.stopEdgeProcesses()
    await this.stopSimulatorProcess()
  }

  private publishFailure(
    message: string,
    failedProcess: LocalRuntimeProcessKind,
    error: string
  ): void {
    this.publish({
      phase: 'failed',
      message,
      simulatorRunning: Boolean(this.simulatorProcess),
      bridgeRunning: false,
      edgeRunning: Boolean(this.edgeProcess),
      failedProcess,
      error
    })
  }

  private publishState(
    phase: LocalRuntimeSnapshot['phase'],
    message: string
  ): void {
    this.publish({
      phase,
      message,
      simulatorRunning: Boolean(this.simulatorProcess),
      bridgeRunning: false,
      edgeRunning: Boolean(this.edgeProcess)
    })
  }

  private publish(snapshot: LocalRuntimeSnapshot): void {
    this.snapshot = snapshot
    this.onSnapshot(this.getSnapshot())
  }
}

export async function readLocalRuntimeLogs(
  logsDirectory: string,
  maxBytes = LOCAL_RUNTIME_LOG_READ_LIMIT_BYTES
): Promise<LocalRuntimeLogsSnapshot> {
  await mkdir(logsDirectory, { recursive: true })
  const entries = await Promise.all(
    LOCAL_RUNTIME_LOG_KINDS.map((kind) => readLocalRuntimeLogEntry(
      logsDirectory,
      kind,
      Math.max(1, maxBytes)
    ))
  )
  return { readAt: Date.now(), entries }
}

async function readLocalRuntimeLogEntry(
  logsDirectory: string,
  kind: LocalRuntimeProcessKind,
  maxBytes: number
): Promise<LocalRuntimeLogEntry> {
  const logPath = join(logsDirectory, `${kind}.log`)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(logPath, 'r')
    const file = await handle.stat()
    const byteLength = Math.min(file.size, maxBytes)
    const start = Math.max(0, file.size - byteLength)
    const buffer = Buffer.alloc(byteLength)
    const { bytesRead } = byteLength > 0
      ? await handle.read(buffer, 0, byteLength, start)
      : { bytesRead: 0 }
    let contentStart = 0
    if (start > 0) {
      while (
        contentStart < bytesRead
        && (buffer[contentStart] & 0xc0) === 0x80
      ) {
        contentStart += 1
      }
    }
    return {
      kind,
      content: buffer.subarray(contentStart, bytesRead).toString('utf8'),
      available: true,
      truncated: file.size > byteLength
    }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { kind, content: '', available: false, truncated: false }
    }
    throw error
  } finally {
    await handle?.close()
  }
}

export async function resolveLocalRuntimeLaunchPlan(
  config: LocalRuntimeLaunchConfig,
  platform: NodeJS.Platform = process.platform
): Promise<LocalRuntimeLaunchPlan> {
  const resolvedConfig = await resolveRuntimeConfig(config, platform)
  return {
    runtimeDirectory: resolvedConfig.runtimeDirectory,
    edge: edgeSpec(resolvedConfig)
  }
}

export async function resolveLocalSimulatorLaunchPlan(
  config: LocalRuntimeLaunchConfig,
  platform: NodeJS.Platform = process.platform
): Promise<LocalSimulatorLaunchPlan> {
  const resolvedConfig = await resolveSimulatorConfig(config, platform)
  return { simulator: simulatorSpec(resolvedConfig) }
}

async function resolveRuntimeConfig(
  config: LocalRuntimeLaunchConfig,
  platform: NodeJS.Platform
): Promise<ResolvedRuntimeConfig> {
  const graphPath = normalizeRequiredPath(config.graphPath, '请选择设备图 JSON')
  const osProjectPath = normalizeRequiredPath(
    config.osProjectPath,
    '请选择 Uni-Lab-OS 项目根目录'
  )
  const szlabProjectPath = normalizeRequiredPath(
    config.szlabProjectPath,
    '请选择领域项目根目录（以 Uni-Lab-SZLab 为例）'
  )
  const environmentPath = normalizeRequiredPath(
    config.environmentPath,
    '请选择 unilab Conda 环境目录'
  )

  if (!graphPath.toLowerCase().endsWith('.json')) {
    throw new Error('设备图必须是 JSON 文件')
  }
  await requireFile(graphPath, '设备图 JSON 不存在')
  await requireDirectory(osProjectPath, 'Uni-Lab-OS 项目根目录不存在')
  await requireDirectory(szlabProjectPath, '领域项目根目录不存在')
  await requireDirectory(environmentPath, 'unilab Conda 环境目录不存在')

  const { unilabExecutable } = runtimeExecutablePaths(
    environmentPath,
    platform
  )
  await requireExecutable(
    unilabExecutable,
    platform === 'win32'
      ? '所选 Conda 环境缺少 Scripts/unilab.exe'
      : '所选 Conda 环境缺少 bin/unilab'
  )

  const localConfigPath = join(
    szlabProjectPath,
    'deployment',
    'local_config.py'
  )
  await requireFile(localConfigPath, '领域项目缺少 deployment/local_config.py')

  return {
    platform,
    graphPath,
    osProjectPath,
    szlabProjectPath,
    environmentPath,
    unilabExecutable,
    localConfigPath,
    runtimeDirectory: join(szlabProjectPath, 'runtime', 'ideawit-e2e'),
  }
}

async function resolveSimulatorConfig(
  config: LocalRuntimeLaunchConfig,
  platform: NodeJS.Platform
): Promise<ResolvedSimulatorConfig> {
  const environmentPath = normalizeRequiredPath(
    config.environmentPath,
    '请选择 unilab Conda 环境目录'
  )
  const simulatorProjectPath = normalizeRequiredPath(
    config.simulatorProjectPath,
    '请选择 PLC-Sim 项目根目录'
  )
  await requireDirectory(environmentPath, 'unilab Conda 环境目录不存在')
  await requireDirectory(simulatorProjectPath, 'PLC-Sim 项目根目录不存在')
  const { pythonExecutable } = runtimeExecutablePaths(
    environmentPath,
    platform
  )
  await requireExecutable(
    pythonExecutable,
    platform === 'win32'
      ? '所选 Conda 环境缺少 python.exe'
      : '所选 Conda 环境缺少 bin/python'
  )
  return {
    platform,
    environmentPath,
    pythonExecutable,
    workingDirectory: await resolveSimulatorWorkingDirectory(
      simulatorProjectPath
    )
  }
}

function simulatorSpec(config: ResolvedSimulatorConfig): LocalRuntimeSpawnSpec {
  return {
    command: config.pythonExecutable,
    args: ['-m', 'gui.backend', '--host', HOST, '--port', String(LOCAL_RUNTIME_PORTS.simulator)],
    cwd: config.workingDirectory,
    env: {
      ...activatedCondaEnvironment(config.environmentPath, config.platform),
      PYTHONUNBUFFERED: '1'
    }
  }
}

function edgeSpec(config: ResolvedRuntimeConfig): LocalRuntimeSpawnSpec {
  return {
    command: config.unilabExecutable,
    args: [
      '--workspace',
      config.szlabProjectPath,
      '--graph',
      config.graphPath,
      '--config',
      config.localConfigPath,
      '--working_dir',
      config.runtimeDirectory,
      '--backend',
      'ros',
      '--app_bridges',
      'fastapi',
      '--edge_scheduler',
      '--port',
      String(LOCAL_RUNTIME_PORTS.edgeHttp),
      '--disable_browser',
      '--skip_env_check',
      '--test_mode'
    ],
    cwd: config.szlabProjectPath,
    env: {
      ...runtimeEnvironment(config),
      UNILABOS_RUNTIME_DB: edgeRuntimeDatabasePath(config.runtimeDirectory),
      UNILABOS_OBSERVABILITYCONFIG_ENABLED: 'true',
      UNILABOS_OBSERVABILITYCONFIG_PROJECT_NAME: 'uni-lab-electron',
      ROS_DOMAIN_ID: '42'
    }
  }
}

function edgeRuntimeDatabasePath(
  runtimeDirectory: string,
  now = new Date()
): string {
  const timestamp = [
    now.getFullYear(),
    twoDigits(now.getMonth() + 1),
    twoDigits(now.getDate()),
    '-',
    twoDigits(now.getHours()),
    twoDigits(now.getMinutes()),
    twoDigits(now.getSeconds())
  ].join('')
  return join(runtimeDirectory, `edge-runtime-${timestamp}.sqlite3`)
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

function runtimeEnvironment(
  config: ResolvedRuntimeConfig
): NodeJS.ProcessEnv {
  const environment = activatedCondaEnvironment(
    config.environmentPath,
    config.platform
  )
  return {
    ...environment,
    PYTHONPATH: mergePathList([
      config.osProjectPath,
      config.szlabProjectPath,
      environmentValue(environment, 'PYTHONPATH')
    ], config.platform === 'win32' ? ';' : ':'),
    PYTHONUNBUFFERED: '1'
  }
}

function activatedCondaEnvironment(
  environmentPath: string,
  platform: NodeJS.Platform,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  if (platform !== 'win32') {
    return {
      ...inheritedEnvironment,
      PATH: mergePathList([
        join(environmentPath, 'bin'),
        environmentValue(inheritedEnvironment, 'PATH')
      ])
    }
  }

  const inheritedPath = environmentValue(inheritedEnvironment, 'PATH')
  const environment = Object.fromEntries(
    Object.entries(inheritedEnvironment).filter(([key]) => {
      const normalizedKey = key.toUpperCase()
      return normalizedKey !== 'PATH'
        && normalizedKey !== 'CONDA_PREFIX'
        && normalizedKey !== 'CONDA_DEFAULT_ENV'
        && normalizedKey !== 'CONDA_SHLVL'
        && normalizedKey !== 'CONDA_PROMPT_MODIFIER'
        && !/^CONDA_PREFIX_\d+$/.test(normalizedKey)
    })
  )
  const environmentName = basename(environmentPath)

  return {
    ...environment,
    CONDA_PREFIX: environmentPath,
    CONDA_DEFAULT_ENV: environmentName,
    CONDA_SHLVL: '1',
    CONDA_PROMPT_MODIFIER: `(${environmentName}) `,
    PATH: mergePathList([
      environmentPath,
      join(environmentPath, 'Library', 'mingw-w64', 'bin'),
      join(environmentPath, 'Library', 'usr', 'bin'),
      join(environmentPath, 'Library', 'bin'),
      join(environmentPath, 'Scripts'),
      join(environmentPath, 'bin'),
      inheritedPath
    ], ';')
  }
}

function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string
): string | undefined {
  const normalizedName = name.toUpperCase()
  return Object.entries(environment).find(
    ([key, value]) => key.toUpperCase() === normalizedName && Boolean(value)
  )?.[1]
}

function mergePathList(
  values: Array<string | undefined>,
  separator = delimiter
): string {
  return values
    .filter((value): value is string => Boolean(value))
    .join(separator)
}

function runtimeExecutablePaths(
  environmentPath: string,
  platform: NodeJS.Platform
): {
  pythonExecutable: string
  unilabExecutable: string
} {
  if (platform === 'win32') {
    return {
      pythonExecutable: join(environmentPath, 'python.exe'),
      unilabExecutable: join(environmentPath, 'Scripts', 'unilab.exe')
    }
  }
  return {
    pythonExecutable: join(environmentPath, 'bin', 'python'),
    unilabExecutable: join(environmentPath, 'bin', 'unilab')
  }
}

async function resolveSimulatorWorkingDirectory(
  simulatorProjectPath: string
): Promise<string> {
  const candidates = [
    join(simulatorProjectPath, 'OpcUaSim'),
    simulatorProjectPath
  ]
  for (const candidate of candidates) {
    try {
      await requireFile(
        join(candidate, 'gui', 'backend.py'),
        'PLC-Sim 缺少 OpcUaSim/gui/backend.py'
      )
      return candidate
    } catch {
      // 继续兼容用户直接选择 OpcUaSim 目录的情况。
    }
  }
  throw new Error(
    `所选目录不是有效的 PLC-Sim 项目：${simulatorProjectPath}`
  )
}

async function requireAvailablePorts(
  requirements: PortRequirement[]
): Promise<void> {
  for (const requirement of requirements) {
    if (await canConnect(HOST, requirement.port)) {
      throw new Error(
        `${requirement.label} 端口 ${requirement.port} 已被占用，请先停止已有进程`
      )
    }
  }
}

async function waitForHttp(
  url: string,
  children: ManagedChild[],
  timeoutMs: number,
  accepts: (payload: unknown) => boolean
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    requireLivingProcesses(children)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok && accepts(await response.json())) return
    } catch {
      // 服务启动期间连接失败属于预期状态。
    }
    await delay(250)
  }
  throw new Error(`等待服务就绪超时：${url}`)
}

interface ManagedChild {
  kind: LocalRuntimeProcessKind
  child: ChildProcessWithoutNullStreams
  label: string
}

function managedChildren(
  children: Array<[
    LocalRuntimeProcessKind,
    ChildProcessWithoutNullStreams | null
  ]>
): ManagedChild[] {
  return children.flatMap(([kind, child]) => child
    ? [{ kind, child, label: processLabel(kind) }]
    : [])
}

async function waitForPort(
  host: string,
  port: number,
  children: Array<{ child: ChildProcessWithoutNullStreams; label: string }>,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const { child, label } of children) requireLivingProcess(child, label)
    if (await canConnect(host, port)) return
    await delay(250)
  }
  throw new Error(`等待 OPC UA 端口就绪超时：${host}:${port}`)
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolveResult) => {
    const socket = createConnection({ host, port })
    let settled = false
    const finish = (connected: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolveResult(connected)
    }
    socket.setTimeout(750)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function requireLivingProcesses(children: ManagedChild[]): void {
  for (const { child, label } of children) requireLivingProcess(child, label)
}

function requireLivingProcess(
  child: ChildProcessWithoutNullStreams,
  label: string
): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`${label} 在服务就绪前退出，请点击右上角“查看日志”`)
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

async function stopProcessTree(
  child: ChildProcessWithoutNullStreams
): Promise<void> {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolveResult) => {
      const killer = spawn(
        'taskkill.exe',
        ['/pid', String(child.pid), '/t', '/f'],
        { windowsHide: true }
      )
      killer.once('close', () => resolveResult())
      killer.once('error', () => resolveResult())
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  await Promise.race([
    new Promise<void>((resolveResult) => child.once('close', () => resolveResult())),
    delay(5_000)
  ])
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

async function requireFirstFile(
  candidates: string[],
  message: string
): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.R_OK)
      return candidate
    } catch {
      // 继续尝试兼容的仓库布局。
    }
  }
  throw new Error(`${message}：${candidates.join(' 或 ')}`)
}

async function requireFirstDirectory(
  candidates: string[],
  message: string
): Promise<string> {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate
    } catch {
      // 继续尝试兼容的仓库布局。
    }
  }
  throw new Error(`${message}：${candidates.join(' 或 ')}`)
}

async function requireExecutable(path: string, message: string): Promise<void> {
  try {
    await access(path, fsConstants.X_OK)
  } catch {
    throw new Error(`${message}：${path}`)
  }
}

async function requireFile(path: string, message: string): Promise<void> {
  try {
    await access(path, fsConstants.R_OK)
  } catch {
    throw new Error(`${message}：${path}`)
  }
}

async function requireDirectory(path: string, message: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error(message)
  } catch {
    throw new Error(`${message}：${path}`)
  }
}

function normalizeRequiredPath(value: string, message: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(message)
  return normalize(resolve(trimmed))
}

function processLabel(kind: LocalRuntimeProcessKind): string {
  if (kind === 'simulator') return 'OPC UA'
  return '领域侧 Edge'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isDeviceCatalogReady(payload: unknown): boolean {
  if (!isRecord(payload) || payload['code'] !== 0) return false
  const data = payload['data']
  return isRecord(data)
    && data['schemaVersion'] === 'device-catalog/v1'
    && Array.isArray(data['items'])
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveResult) => setTimeout(resolveResult, milliseconds))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
