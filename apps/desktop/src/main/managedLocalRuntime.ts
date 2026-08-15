import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import { basename, join, normalize, resolve } from 'node:path'

import type {
  LocalRuntimeLaunchConfig,
  LocalRuntimeModeInfo
} from '../shared/localRuntime'
import type { ManagedRuntimePaths } from './managedRuntimeInstallation'
import type {
  ManagedRuntimeSupervisorSnapshot,
  ManagedSimulatorLaunch,
  ManagedWorkerLaunch
} from './managedRuntimeSupervisor'
import type { LocalRuntimePorts } from './localRuntimeLaunchPlan'
import {
  isDeviceCatalogReady,
  isLocalRuntimeHealthReady,
  localRuntimeEdgeHttpUrl,
  requireAvailablePorts,
  waitForLocalRuntimeHttp,
  waitForLocalRuntimePort
} from './localRuntimeReadiness'

const PROCESS_READY_TIMEOUT_MS = 90_000

export interface ManagedRuntimePort {
  getModeInfo: () => Promise<LocalRuntimeModeInfo>
  getRuntimePaths: () => Promise<ManagedRuntimePaths>
  startWorker: (
    launch: ManagedWorkerLaunch
  ) => Promise<ManagedRuntimeSupervisorSnapshot>
  stopWorker: () => Promise<ManagedRuntimeSupervisorSnapshot>
  startSimulator: (
    launch: ManagedSimulatorLaunch
  ) => Promise<ManagedRuntimeSupervisorSnapshot>
  stopSimulator: () => Promise<ManagedRuntimeSupervisorSnapshot>
}

export interface ManagedLocalRuntimeOptions {
  managedRuntime: ManagedRuntimePort
  managedWorkingRoot?: string
  waitForEdgeReadiness?: () => Promise<void>
  waitForSimulatorReadiness?: () => Promise<void>
}

type StatePublisher = (
  phase: 'starting_edge' | 'waiting_edge' | 'starting_simulator' | 'waiting_simulator',
  message: string
) => void

/**
 * 把持久 Supervisor 的启动协议收敛为本地运行管理器可调用的窄适配器。
 *
 * @safety 适配器只接受已校验的设备包目录，并让 Supervisor 独占进程身份。
 */
export class ManagedLocalRuntimeController {
  private edgeRunning = false
  private simulatorRunning = false

  constructor(private readonly options: ManagedLocalRuntimeOptions) {}

  /** 返回安装包内托管运行时的版本与默认设备包配置。 */
  getModeInfo(): Promise<LocalRuntimeModeInfo> {
    return this.options.managedRuntime.getModeInfo()
  }

  /** 返回 Supervisor 当前是否拥有 Edge Worker。 */
  isEdgeRunning(): boolean {
    return this.edgeRunning
  }

  /** 返回 Supervisor 当前是否拥有 PLC-Sim。 */
  isSimulatorRunning(): boolean {
    return this.simulatorRunning
  }

  /**
   * 安装并启动托管 Edge Worker，再等待真实 HTTP 与设备目录就绪。
   *
   * @param config 用户确认后的领域设备包与设备图配置。
   * @param ports 本次桌面会话冻结的 Edge 与 HostLink 端口。
   * @param publish 向渲染器投影启动阶段的受控回调。
   */
  async startEdge(
    config: LocalRuntimeLaunchConfig,
    ports: LocalRuntimePorts,
    publish: StatePublisher
  ): Promise<void> {
    const workingRoot = this.options.managedWorkingRoot
      ?? join(process.cwd(), 'managed-runtime', 'workspaces')
    const launch = await resolveManagedWorkerLaunch(config, workingRoot)
    await requireAvailablePorts([
      { port: ports.edgeHttp, label: '领域侧 Edge HTTP' },
      { port: ports.hostLink, label: 'Edge HostLink' }
    ])
    await mkdir(launch.workingDirectory, { recursive: true })
    publish('starting_edge', '正在启动内置 Runtime Supervisor…')
    const supervisor = await this.options.managedRuntime.startWorker(launch)
    if (supervisor.status !== 'running') {
      throw new Error(
        supervisor.status === 'interrupted'
          ? '上次 Runtime 未正常结束，请先确认设备状态'
          : supervisor.error ?? '内置 Runtime 未进入运行状态'
      )
    }
    this.edgeRunning = true
    publish('waiting_edge', '内置 Runtime 正在初始化领域设备…')
    await this.waitUntilEdgeReady(ports, publish)
  }

  /**
   * 通过同一 Supervisor 独立启动源码或可执行文件形式的 PLC-Sim。
   *
   * @param config 用户选择的 PLC-Sim 路径。
   * @param ports 本次桌面会话冻结的模拟器端口。
   * @param publish 向渲染器投影启动阶段的受控回调。
   */
  async startSimulator(
    config: LocalRuntimeLaunchConfig,
    ports: LocalRuntimePorts,
    publish: StatePublisher
  ): Promise<void> {
    const launch = await resolveManagedSimulatorLaunch(config)
    await requireAvailablePorts([
      { port: ports.simulatorGui, label: 'PLC-Sim Web GUI' },
      { port: ports.simulatorOpcUa, label: 'PLC-Sim OPC UA' }
    ])
    publish('starting_simulator', '正在通过 Runtime Supervisor 启动 PLC-Sim…')
    const supervisor = await this.options.managedRuntime.startSimulator(launch)
    if (supervisor.simulator.status !== 'running') {
      throw new Error(
        supervisor.simulator.status === 'interrupted'
          ? '上次 PLC-Sim 未正常结束，请先确认端口和设备状态'
          : supervisor.simulator.error ?? 'PLC-Sim 未进入运行状态'
      )
    }
    this.simulatorRunning = true
    publish(
      'waiting_simulator',
      `PLC-Sim 已启动，正在等待 ${ports.simulatorGui} 端口…`
    )
    if (this.options.waitForSimulatorReadiness) {
      await this.options.waitForSimulatorReadiness()
      return
    }
    await waitForLocalRuntimePort(
      ports.simulatorGui,
      [],
      PROCESS_READY_TIMEOUT_MS
    )
  }

  /** 停止 Supervisor 当前拥有的 Edge Worker，并清除本地运行标记。 */
  async stopEdge(): Promise<void> {
    if (!this.edgeRunning) return
    await this.options.managedRuntime.stopWorker()
    this.edgeRunning = false
  }

  /** 停止 Supervisor 当前拥有的 PLC-Sim，并清除本地运行标记。 */
  async stopSimulator(): Promise<void> {
    if (!this.simulatorRunning) return
    await this.options.managedRuntime.stopSimulator()
    this.simulatorRunning = false
  }

  /**
   * 等待托管 Edge 健康、工作流模板目录与领域设备动作依次就绪。
   *
   * @param ports 当前 Edge HTTP 端口事实。
   * @param publish 向渲染器发布更细启动阶段的回调。
   */
  private async waitUntilEdgeReady(
    ports: LocalRuntimePorts,
    publish: StatePublisher
  ): Promise<void> {
    if (this.options.waitForEdgeReadiness) {
      await this.options.waitForEdgeReadiness()
      return
    }
    await waitForLocalRuntimeHttp(
      localRuntimeEdgeHttpUrl(ports.edgeHttp, '/api/v1/health'),
      [],
      PROCESS_READY_TIMEOUT_MS,
      isLocalRuntimeHealthReady
    )
    publish('waiting_edge', 'HostNode 已启动，正在等待工作流模板目录…')
    await waitForLocalRuntimeHttp(
      localRuntimeEdgeHttpUrl(
        ports.edgeHttp,
        '/api/v1/workflow-node-templates'
      ),
      [],
      PROCESS_READY_TIMEOUT_MS,
      () => true
    )
    publish('waiting_edge', '工作流目录已就绪，正在等待领域设备动作上报…')
    await waitForLocalRuntimeHttp(
      localRuntimeEdgeHttpUrl(
        ports.edgeHttp,
        '/api/v1/authoring/device-catalog'
      ),
      [],
      PROCESS_READY_TIMEOUT_MS,
      (payload) => isDeviceCatalogReady(payload, 'domain_actions')
    )
  }
}

/**
 * 把领域设备包路径解析为 Supervisor Worker 的稳定启动事实。
 *
 * @param config 用户选择的设备图和领域设备包目录。
 * @param managedWorkingRoot 桌面端拥有的隔离运行数据根目录。
 */
export async function resolveManagedWorkerLaunch(
  config: LocalRuntimeLaunchConfig,
  managedWorkingRoot: string
): Promise<ManagedWorkerLaunch> {
  const graphPath = normalizeRequiredPath(config.graphPath, '请选择设备图 JSON')
  const workspacePath = normalizeRequiredPath(
    config.szlabProjectPath,
    '请选择领域项目根目录'
  )
  if (!graphPath.toLowerCase().endsWith('.json')) {
    throw new Error('设备图必须是 JSON 文件')
  }
  await requireFile(graphPath, '设备图 JSON 不存在')
  await requireDirectory(workspacePath, '领域项目根目录不存在')
  const configPath = join(workspacePath, 'deployment', 'local_config.py')
  await requireFile(configPath, '领域项目缺少 deployment/local_config.py')
  const workspaceKey = createHash('sha256')
    .update(workspacePath)
    .digest('hex')
    .slice(0, 12)
  const workspaceName = basename(workspacePath)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 48) || 'workspace'
  return {
    workspacePath,
    graphPath,
    configPath,
    workingDirectory: join(
      resolve(managedWorkingRoot),
      `${workspaceName}-${workspaceKey}`
    ),
    backend: 'ros'
  }
}

/**
 * 把 PLC-Sim 源码目录或可执行文件收窄为 Supervisor 启动联合类型。
 *
 * @param config 用户选择的 PLC-Sim 路径配置。
 */
export async function resolveManagedSimulatorLaunch(
  config: LocalRuntimeLaunchConfig
): Promise<ManagedSimulatorLaunch> {
  const selectedPath = normalizeRequiredPath(
    config.simulatorProjectPath,
    '请选择 PLC-Sim 源码目录或已安装可执行文件'
  )
  let selectedStat: Awaited<ReturnType<typeof stat>>
  try {
    selectedStat = await stat(selectedPath)
  } catch {
    throw new Error(`PLC-Sim 路径不存在：${selectedPath}`)
  }
  if (selectedStat.isFile()) {
    await requireExecutable(selectedPath, '所选 PLC-Sim 文件不可执行')
    return { kind: 'executable', path: selectedPath }
  }
  if (!selectedStat.isDirectory()) {
    throw new Error('PLC-Sim 路径必须是源码目录或可执行文件')
  }
  await requireSimulatorSource(selectedPath)
  return { kind: 'source', path: selectedPath }
}

/** 校验用户选择的是仓库根目录或直接包含 gui/backend.py 的源码目录。 */
async function requireSimulatorSource(selectedPath: string): Promise<void> {
  for (const candidate of [join(selectedPath, 'OpcUaSim'), selectedPath]) {
    try {
      await access(join(candidate, 'gui', 'backend.py'), fsConstants.R_OK)
      return
    } catch {
      // 继续兼容另一种已公开的 PLC-Sim 源码目录布局。
    }
  }
  throw new Error(`PLC-Sim 缺少 OpcUaSim/gui/backend.py：${selectedPath}`)
}

/** 规范化必填路径，空值直接返回可行动的中文错误。 */
function normalizeRequiredPath(value: string, message: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(message)
  return normalize(resolve(trimmed))
}

/** 校验路径是可读目录。 */
async function requireDirectory(path: string, message: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error(message)
  } catch {
    throw new Error(`${message}：${path}`)
  }
}

/** 校验路径是可读文件。 */
async function requireFile(path: string, message: string): Promise<void> {
  try {
    await access(path, fsConstants.R_OK)
  } catch {
    throw new Error(`${message}：${path}`)
  }
}

/** 校验路径是当前平台可执行文件。 */
async function requireExecutable(path: string, message: string): Promise<void> {
  try {
    await access(
      path,
      process.platform === 'win32'
        ? fsConstants.R_OK
        : fsConstants.R_OK | fsConstants.X_OK
    )
  } catch {
    throw new Error(`${message}：${path}`)
  }
}
