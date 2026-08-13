import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

import { resolveLocalRuntimeLogPath } from './diagnosticLogSession'
import {
  IDLE_LOCAL_RUNTIME_SNAPSHOT,
  type LocalRuntimeAcceptanceResult,
  type LocalRuntimeLaunchConfig,
  type LocalRuntimeLogBatch,
  type LocalRuntimeLogQuery,
  type LocalRuntimeLogsSnapshot,
  type LocalRuntimeProcessKind,
  type LocalRuntimeModeInfo,
  type LocalRuntimeSnapshot
} from '../shared/localRuntime'
import { runDevicePackageAcceptance } from './devicePackageAcceptance'
import { readLocalRuntimeLog, readLocalRuntimeLogs } from './localRuntimeDiagnostics'
import { LocalDeviceProvisioningRuntimeSession } from './localDeviceProvisioningRuntimeSession'
import {
  LOCAL_RUNTIME_PORTS,
  normalizeLocalRuntimePorts,
  resolveLocalRuntimeLaunchPlan,
  resolveLocalSimulatorLaunchPlan,
  type ActiveLocalDeviceProvisioningRuntime,
  type LocalRuntimePorts,
  type LocalRuntimeSpawnSpec
} from './localRuntimeLaunchPlan'
import { releaseListeningPorts } from './localRuntimePorts'
import {
  localRuntimeErrorMessage,
  localRuntimeProcessLabel,
  spawnManagedLocalRuntimeProcess,
  stopLocalRuntimeProcessTree
} from './localRuntimeProcess'
import {
  isDeviceCatalogReady,
  isLocalRuntimeHealthReady,
  localRuntimeEdgeHttpUrl,
  managedLocalRuntimeChildren,
  requireAvailablePorts,
  waitForLocalRuntimeHttp,
  waitForLocalRuntimePort
} from './localRuntimeReadiness'
import {
  ManagedLocalRuntimeController,
  type ManagedRuntimePort
} from './managedLocalRuntime'

export type { ManagedRuntimePort } from './managedLocalRuntime'

export {
  readLocalRuntimeLog,
  readLocalRuntimeLogs,
  RotatingLogWriter
} from './localRuntimeDiagnostics'
export {
  LOCAL_RUNTIME_PORTS,
  resolveLocalRuntimeLaunchPlan,
  resolveLocalSimulatorLaunchPlan
} from './localRuntimeLaunchPlan'
export type {
  LocalRuntimeLaunchPlan,
  LocalRuntimePorts,
  LocalRuntimeSpawnSpec,
  LocalSimulatorLaunchPlan
} from './localRuntimeLaunchPlan'

type SnapshotListener = (snapshot: LocalRuntimeSnapshot) => void
type ActiveOperation = 'simulator' | 'edge' | 'all'

export interface LocalRuntimeManagerOptions {
  managedRuntime?: ManagedRuntimePort
  useManagedRuntime?: () => boolean
  managedWorkingRoot?: string
  waitForEdgeReadiness?: () => Promise<void>
  waitForSimulatorReadiness?: () => Promise<void>
  runAcceptance?: (
    workspacePath: string
  ) => Promise<LocalRuntimeAcceptanceResult>
}

const PROCESS_READY_TIMEOUT_MS = 90_000

export class LocalRuntimeManager {
  private snapshot: LocalRuntimeSnapshot = { ...IDLE_LOCAL_RUNTIME_SNAPSHOT }
  private edgeProcess: ChildProcessWithoutNullStreams | null = null
  private simulatorProcess: ChildProcessWithoutNullStreams | null = null
  private readonly expectedExits = new WeakSet<ChildProcessWithoutNullStreams>()
  private stopping = false
  private activeOperation: ActiveOperation | null = null
  private readonly ports: LocalRuntimePorts
  private readonly deviceProvisioningRuntime = new LocalDeviceProvisioningRuntimeSession()
  private readonly options: LocalRuntimeManagerOptions
  private readonly managedRuntime: ManagedLocalRuntimeController | null
  private acceptance: LocalRuntimeAcceptanceResult = {
    ...IDLE_LOCAL_RUNTIME_SNAPSHOT.acceptance!
  }

  /**
   * 创建一个应用生命周期内唯一的本地运行管理器，并冻结启动端口事实。
   *
   * @param logsDirectory Electron 管理的本地运行日志目录。
   * @param onSnapshot 运行状态变化时通知渲染器的回调。
   * @param logSessionId 应用启动时冻结、供全部本地子进程共享的日志会话标识。
   * @param portsOrOptions 当前启动环境的端口事实，或托管运行时选项。
   * @param options 同时传入端口时使用的托管运行时选项。
   * @returns 新的本地运行管理器实例。
   * @throws 日志会话标识会在首次解析路径时执行严格校验。
   * @safety 日志路径由主进程目录、会话标识和固定进程枚举共同解析。
   */
  constructor(
    private readonly logsDirectory: string,
    private readonly onSnapshot: SnapshotListener,
    private readonly logSessionId: string,
    portsOrOptions: LocalRuntimePorts | LocalRuntimeManagerOptions =
      LOCAL_RUNTIME_PORTS,
    options: LocalRuntimeManagerOptions = {}
  ) {
    const receivedPorts = 'edgeHttp' in portsOrOptions
    this.ports = normalizeLocalRuntimePorts(
      receivedPorts ? portsOrOptions : LOCAL_RUNTIME_PORTS
    )
    this.options = receivedPorts ? options : portsOrOptions
    this.managedRuntime = this.options.managedRuntime
      ? new ManagedLocalRuntimeController({
          managedRuntime: this.options.managedRuntime,
          managedWorkingRoot: this.options.managedWorkingRoot,
          waitForEdgeReadiness: this.options.waitForEdgeReadiness,
          waitForSimulatorReadiness: this.options.waitForSimulatorReadiness
        })
      : null
  }

  /** 返回托管安装包或源码开发环境的当前运行模式。 */
  getModeInfo(): Promise<LocalRuntimeModeInfo> {
    return this.activeManagedRuntime()?.getModeInfo() ?? Promise.resolve({
      mode: 'development',
      label: '开发环境 Runtime',
      runtimeVersion: null
    })
  }

  /** 返回应用退出时是否应保留由持久 Supervisor 拥有的实验进程。 */
  persistsAfterAppQuit(): boolean {
    return this.activeManagedRuntime() !== null
  }

  getSnapshot(): LocalRuntimeSnapshot {
    return { ...this.snapshot }
  }

  getDeviceProvisioningRuntime(): ActiveLocalDeviceProvisioningRuntime {
    return this.deviceProvisioningRuntime.require()
  }

  /**
   * 读取本次应用会话中各本地进程日志的有界尾部快照。
   *
   * @returns PLC-Sim 与 Edge 当前会话日志快照。
   * @throws 文件系统读取失败时透传错误，文件尚未产生则返回不可用条目。
   * @safety 只读取管理器冻结的日志目录和会话标识。
   */
  readLogs(): Promise<LocalRuntimeLogsSnapshot> {
    return readLocalRuntimeLogs(this.logsDirectory, this.logSessionId)
  }

  /**
   * 按游标读取本次应用会话内一个日志来源新增的有界内容。
   *
   * @param query 固定来源与上次读取游标，不包含任意文件路径。
   * @returns 当前会话对应来源的增量日志批次。
   * @throws 文件系统读取失败或来源非法时透传错误。
   * @safety 会话和来源均由主进程约束，渲染器无法跨会话读取任意文件。
   */
  readLog(query: LocalRuntimeLogQuery): Promise<LocalRuntimeLogBatch> {
    return readLocalRuntimeLog(this.logsDirectory, this.logSessionId, query)
  }

  /**
   * 返回本次会话固定日志来源的主进程解析路径。
   *
   * @param kind 受支持的 PLC-Sim 或 Edge 来源。
   * @returns 当前应用会话对应的日志文件路径。
   * @throws 来源或会话标识非法时抛出错误。
   * @safety 不接受渲染器传入任意路径。
   */
  getLogPath(kind: LocalRuntimeProcessKind): string {
    return resolveLocalRuntimeLogPath(
      this.logsDirectory,
      this.logSessionId,
      kind
    )
  }

  /**
   * 清理当前计划端口并启动可选 PLC-Sim。
   *
   * @param config 已由渲染器提交的本地项目与 Conda 路径。
   * @returns PLC-Sim 就绪后的最新本地运行快照。
   * @throws 配置、端口清理、进程启动或就绪等待失败时抛出中文诊断。
   */
  async startSimulator(
    config: LocalRuntimeLaunchConfig
  ): Promise<LocalRuntimeSnapshot> {
    const managedRuntime = this.activeManagedRuntime()
    this.beginOperation('simulator')
    if (this.simulatorIsRunning()) {
      this.activeOperation = null
      throw new Error('PLC-Sim 已在运行')
    }

    this.resetAcceptance()

    this.publishState(
      'validating_simulator',
      managedRuntime
        ? '正在检查 PLC-Sim 与内置 Runtime…'
        : '正在检查 PLC-Sim、Conda 环境并清理所需端口…'
    )

    try {
      if (managedRuntime) {
        await managedRuntime.startSimulator(
          config,
          this.ports,
          (phase, message) => this.publishState(phase, message)
        )
        this.publishState(
          this.edgeIsRunning() ? 'ready' : 'simulator_ready',
          this.edgeIsRunning()
            ? 'PLC-Sim 与内置 Runtime 已就绪'
            : 'PLC-Sim 已就绪；请上传 PLC 变量表后再启动领域侧 Edge'
        )
        return this.getSnapshot()
      }
      const plan = await resolveLocalSimulatorLaunchPlan(
        config,
        process.platform,
        this.ports
      )
      await releaseListeningPorts(plan.requiredPorts)
      await requireAvailablePorts(plan.requiredPorts)
      await mkdir(this.logsDirectory, { recursive: true })
      this.publishState('starting_simulator', '正在启动 PLC-Sim OPC UA…')
      this.simulatorProcess = this.spawnManaged('simulator', plan.simulator)
      this.publishState(
        'waiting_simulator',
        `PLC-Sim 已启动，正在等待 ${plan.ports.simulatorGui} 端口…`
      )
      await waitForLocalRuntimePort(
        plan.ports.simulatorGui,
        [{ child: this.simulatorProcess, label: 'PLC-Sim OPC UA' }],
        PROCESS_READY_TIMEOUT_MS
      )
      this.publishState(
        this.edgeIsRunning() ? 'ready' : 'simulator_ready',
        this.edgeIsRunning()
          ? 'PLC-Sim 与领域侧 Edge 已就绪'
          : 'PLC-Sim 已就绪；请上传 PLC 变量表后再启动领域侧 Edge'
      )
      return this.getSnapshot()
    } catch (error) {
      const message = localRuntimeErrorMessage(error)
      this.stopping = true
      await this.stopSimulatorProcess()
      this.stopping = false
      this.publishFailure('PLC-Sim 启动失败', 'simulator', message)
      throw new Error(message)
    } finally {
      this.activeOperation = null
    }
  }

  /**
   * 清理当前计划端口并启动领域侧 Edge。
   *
   * @param config 已由渲染器提交的 OS、设备图、领域项目与 Conda 路径。
   * @returns Edge HTTP、目录与设备投影就绪后的最新本地运行快照。
   * @throws 配置、端口清理、进程启动或就绪等待失败时抛出中文诊断。
   */
  async startEdge(
    config: LocalRuntimeLaunchConfig
  ): Promise<LocalRuntimeSnapshot> {
    const managedRuntime = this.activeManagedRuntime()
    this.beginOperation('edge')
    if (this.edgeIsRunning()) {
      this.activeOperation = null
      throw new Error('领域侧 Edge 已在运行')
    }

    this.resetAcceptance()

    this.publishState(
      'validating_edge',
      managedRuntime
        ? '正在检查领域设备包与内置 Runtime…'
        : '正在检查 Edge 项目、Conda 环境并清理所需端口…'
    )

    try {
      if (managedRuntime) {
        await managedRuntime.startEdge(
          config,
          this.ports,
          (phase, message) => this.publishState(phase, message)
        )
        this.publishState(
          'ready',
          this.simulatorIsRunning()
            ? 'PLC-Sim 与内置 Runtime 已就绪'
            : '内置 Runtime 已就绪'
        )
        return this.getSnapshot()
      }
      const plan = await resolveLocalRuntimeLaunchPlan(
        config,
        process.platform,
        this.ports
      )
      await releaseListeningPorts(plan.requiredPorts)
      await requireAvailablePorts(plan.requiredPorts)
      await mkdir(this.logsDirectory, { recursive: true })
      await mkdir(plan.runtimeDirectory, { recursive: true })

      this.publishState('starting_edge', '正在通过 unilab CLI 启动 ROS Edge…')
      this.edgeProcess = this.spawnManaged('edge', plan.edge)
      this.publishState('waiting_edge', '领域侧 Edge 正在初始化 HostNode…')
      await waitForLocalRuntimeHttp(
        localRuntimeEdgeHttpUrl(plan.ports.edgeHttp, '/api/v1/health'),
        managedLocalRuntimeChildren([
          ['simulator', this.simulatorProcess],
          ['edge', this.edgeProcess]
        ]),
        PROCESS_READY_TIMEOUT_MS,
        isLocalRuntimeHealthReady
      )

      if (plan.deviceCatalogRequirement === 'domain_actions') {
        this.publishState('waiting_edge', 'HostNode 已启动，正在等待工作流模板目录…')
        await waitForLocalRuntimeHttp(
          localRuntimeEdgeHttpUrl(
            plan.ports.edgeHttp,
            '/api/v1/workflow-node-templates'
          ),
          managedLocalRuntimeChildren([
            ['simulator', this.simulatorProcess],
            ['edge', this.edgeProcess]
          ]),
          PROCESS_READY_TIMEOUT_MS,
          () => true
        )
      }

      this.publishState(
        'waiting_edge',
        plan.deviceCatalogRequirement === 'domain_actions'
          ? '工作流目录已就绪，正在等待领域设备动作上报…'
          : '工作流目录已就绪，正在等待设备运行时…'
      )
      await waitForLocalRuntimeHttp(
        localRuntimeEdgeHttpUrl(plan.ports.edgeHttp, '/api/v1/devices'),
        managedLocalRuntimeChildren([
          ['simulator', this.simulatorProcess],
          ['edge', this.edgeProcess]
        ]),
        PROCESS_READY_TIMEOUT_MS,
        (payload) => isDeviceCatalogReady(
          payload,
          plan.deviceCatalogRequirement
        )
      )
      this.deviceProvisioningRuntime.capture(config, plan.deviceProvisioning)

      this.publishState(
        'ready',
        this.simulatorIsRunning()
          ? 'PLC-Sim 与领域侧 Edge 已就绪'
          : '领域侧 Edge 已就绪'
      )
      return this.getSnapshot()
    } catch (error) {
      const message = localRuntimeErrorMessage(error)
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
    if (!this.simulatorIsRunning()) {
      this.activeOperation = null
      return this.getSnapshot()
    }

    this.stopping = true
    this.publishState('stopping_simulator', '正在停止 PLC-Sim…')
    try {
      await this.stopSimulatorProcess()
      this.stopping = false
      if (this.edgeIsRunning()) {
        this.publishState(
          'ready',
          this.activeManagedRuntime()
            ? '内置 Runtime 仍在运行'
            : '领域侧 Edge 仍在运行'
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

  async stopEdge(): Promise<LocalRuntimeSnapshot> {
    this.beginOperation('edge')
    if (!this.edgeIsRunning()) {
      this.activeOperation = null
      return this.getSnapshot()
    }

    this.stopping = true
    this.publishState('stopping_edge', '正在停止领域侧 Edge…')
    try {
      await this.stopEdgeProcesses()
      this.stopping = false
      if (this.simulatorIsRunning()) {
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

  /**
   * 执行用户明确触发的领域设备包验收，并按既定策略清理本次进程。
   *
   * @param config 包含待验收领域设备包目录的启动配置。
   * @returns 验收结论与清理后进程状态组成的最新快照。
   * @throws Edge 尚未运行时拒绝；验收脚本错误会转换成失败结论。
   * @safety 不创建或运行工作流任务；验收实现只检查设备包启动合同。
   */
  async runAcceptance(
    config: LocalRuntimeLaunchConfig
  ): Promise<LocalRuntimeSnapshot> {
    this.beginOperation('all')
    if (!this.edgeIsRunning()) {
      this.activeOperation = null
      throw new Error('请先启动领域侧 Edge，再运行设备包验收')
    }
    this.publishState('validating_acceptance', '正在验收 PLC-Sim 与设备包启动状态…')
    let acceptance: LocalRuntimeAcceptanceResult
    try {
      const workspacePath = config.szlabProjectPath.trim()
      if (!workspacePath) throw new Error('请选择领域项目根目录')
      acceptance = await (
        this.options.runAcceptance ?? runDevicePackageAcceptance
      )(workspacePath)
    } catch (error) {
      acceptance = {
        status: 'failed',
        message: `验收执行失败：${localRuntimeErrorMessage(error)}`,
        checkedAt: Date.now(),
        descriptorPath: null,
        packageName: null,
        packageVersion: null
      }
    }

    this.stopping = true
    this.publishState('cleaning_acceptance', '验收完成，正在按默认策略清理本地进程…')
    try {
      await this.stopProcesses()
    } finally {
      this.stopping = false
      this.activeOperation = null
    }
    this.acceptance = acceptance
    this.publish({
      ...IDLE_LOCAL_RUNTIME_SNAPSHOT,
      message: `${acceptance.message} 本次验收进程已清理。`,
      acceptance
    })
    return this.getSnapshot()
  }

  private beginOperation(operation: ActiveOperation): void {
    if (this.activeOperation) {
      throw new Error('本地服务正在执行其他操作，请稍后再试')
    }
    this.activeOperation = operation
    this.stopping = false
  }

  /**
   * 启动一个受管理的本地子进程，并把标准输出与错误写入当前应用会话。
   *
   * @param kind 固定的 PLC-Sim 或 Edge 进程来源。
   * @param spec 已通过主进程校验的启动命令、目录与环境。
   * @returns 已接入停止、异常退出和诊断日志处理的子进程。
   * @throws spawn 同步拒绝启动时透传错误；异步错误写入对应会话日志。
   * @safety 不使用 shell，日志路径只由主进程固定值解析。
   */
  private spawnManaged(
    kind: LocalRuntimeProcessKind,
    spec: LocalRuntimeSpawnSpec
  ): ChildProcessWithoutNullStreams {
    return spawnManagedLocalRuntimeProcess({
      kind,
      spec,
      logsDirectory: this.logsDirectory,
      logSessionId: this.logSessionId,
      /**
       * 结算退出进程引用，并仅为非预期退出发布失败状态。
       *
       * @param child 已退出的受管理子进程。
       * @returns 不返回值；必要时异步启动剩余进程清理。
       */
      onClose: (child) => {
        const expectedExit = this.expectedExits.delete(child)
        this.clearProcess(kind, child)
        if (
          !expectedExit
          && !this.stopping
          && !this.activeOperation
          && this.snapshot.phase !== 'failed'
        ) {
          void this.handleUnexpectedExit(kind)
        }
      }
    })
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
    const label = localRuntimeProcessLabel(kind)
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
      await stopLocalRuntimeProcessTree(child)
    }
    await this.managedRuntime?.stopSimulator()
  }

  private async stopEdgeProcesses(): Promise<void> {
    const processes = [this.edgeProcess]
    this.edgeProcess = null
    for (const child of processes) {
      if (child) {
        this.expectedExits.add(child)
        await stopLocalRuntimeProcessTree(child)
      }
    }
    await this.managedRuntime?.stopEdge()
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
      simulatorRunning: this.simulatorIsRunning(),
      bridgeRunning: false,
      edgeRunning: this.edgeIsRunning(),
      failedProcess,
      error,
      acceptance: this.acceptance
    })
  }

  private publishState(
    phase: LocalRuntimeSnapshot['phase'],
    message: string
  ): void {
    this.publish({
      phase,
      message,
      simulatorRunning: this.simulatorIsRunning(),
      bridgeRunning: false,
      edgeRunning: this.edgeIsRunning(),
      acceptance: this.acceptance
    })
  }

  private publish(snapshot: LocalRuntimeSnapshot): void {
    this.snapshot = snapshot
    this.onSnapshot(this.getSnapshot())
  }

  /** 把新一次启停尝试的设备包验收投影恢复为未验证。 */
  private resetAcceptance(): void {
    this.acceptance = {
      ...IDLE_LOCAL_RUNTIME_SNAPSHOT.acceptance!
    }
  }

  /** 返回本地子进程或持久 Supervisor 是否拥有 Edge。 */
  private edgeIsRunning(): boolean {
    return Boolean(this.edgeProcess) || Boolean(
      this.managedRuntime?.isEdgeRunning()
    )
  }

  /** 返回本地子进程或持久 Supervisor 是否拥有 PLC-Sim。 */
  private simulatorIsRunning(): boolean {
    return Boolean(this.simulatorProcess) || Boolean(
      this.managedRuntime?.isSimulatorRunning()
    )
  }

  private activeManagedRuntime(): ManagedLocalRuntimeController | null {
    if (!this.managedRuntime) return null
    return this.options.useManagedRuntime?.() === false
      ? null
      : this.managedRuntime
  }
}
