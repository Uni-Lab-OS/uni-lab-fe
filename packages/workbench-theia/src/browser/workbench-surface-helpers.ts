import {
  DiagnosticSeverity
} from '@theia/core/shared/vscode-languageserver-protocol'
import type { WorkstationModule } from '@unilab/robot-workstation'
import type {
  WorkflowIdeBridge,
  WorkflowIdeDiagnosticSeverity
} from '@unilab/workflow-ide-bridge'
import type {
  WorkbenchEnvironmentLogKind,
  WorkbenchPlcSimulatorConfiguration,
  WorkbenchReleaseReceipt,
  WorkbenchReleaseTargetInspection,
  WorkbenchRuntimeMode,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import type { ReactNode } from 'react'

import type {
  WorkbenchConnectionMode,
  WorkbenchConnectionTargets
} from './workbench-connection-profile'
import {
  sessionConnectionState
} from './workbench-connection-runtime'
import type { WorkbenchConnectionState } from './workbench-connection-selector'
import type { WorkbenchSessionClientImpl } from './workbench-session-client'
import {
  isRobotWorkbenchViewMode,
  type WorkbenchViewMode
} from './workbench-view-state'

export type WorkbenchMountedDomain =
  | 'workflow'
  | 'workflow-tasks'
  | 'material'
  | 'device'
  | 'robot-workstation'

/** Workbench 主区组合根接收的会话事实、导航版本和运行控制端口。 */
export interface WorkbenchSurfaceProps {
  connectionMode: WorkbenchConnectionMode
  connectionSwitchingTo: WorkbenchConnectionMode | null
  connectionTargets: WorkbenchConnectionTargets
  ideBridge: WorkflowIdeBridge
  session: WorkbenchSessionSnapshot
  sessionClient: WorkbenchSessionClientImpl
  recoveryRevision: number
  viewMode: WorkbenchViewMode
  switchBlockedReason: string | null
  onConnectionModeChange: (mode: WorkbenchConnectionMode) => void
  onSourceSaveHandlerChange: (
    handler: ((pythonSource: string) => Promise<void>) | null
  ) => void
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void
  onRestartSession: () => Promise<void>
  onRebuildLocalData: () => Promise<void>
  onInspectReleaseTarget: (
    backendUrl: string
  ) => Promise<WorkbenchReleaseTargetInspection>
  onPublishRelease: (
    backendUrl: string,
    resetTarget?: boolean
  ) => Promise<WorkbenchReleaseReceipt>
  onResetWorkflowEnvironment: (backendUrl: string) => Promise<void>
  onReadEnvironmentLog: (kind: WorkbenchEnvironmentLogKind) => Promise<string>
  onOpenLog: (path: string) => Promise<void>
  onConfigureGraph: (graphPath: string) => Promise<void>
  onSetExternalDevicesOnly: (enabled: boolean) => Promise<void>
  onConfigurePlcSimulator: (
    configuration: WorkbenchPlcSimulatorConfiguration
  ) => Promise<void>
  onRefreshPlcVariableTables: () => Promise<void>
  onStartPlcSimulator: () => Promise<void>
  onStopPlcSimulator: () => Promise<void>
  onReleaseEnvironmentPorts: (target: 'os' | 'plc-sim') => Promise<void>
  onStartAgent: () => Promise<void>
  onStopAgent: () => Promise<void>
  onRestartAgent: () => Promise<void>
  onSetRuntimeMode: (mode: WorkbenchRuntimeMode) => Promise<void>
  onSetSchedulerUrl: (url: string | null) => Promise<void>
  onStopSession: () => Promise<void>
}

/**
 * 记录已经访问过的领域表面，使活动栏切换不会销毁面板本地状态。
 *
 * @param mountedDomains 当前会话已挂载的领域集合。
 * @param mode 当前 Workbench 主区模式。
 * @returns 无返回值；集合会原位补充当前模式需要的领域。
 */
export function recordMountedWorkbenchDomains(
  mountedDomains: Set<WorkbenchMountedDomain>,
  mode: WorkbenchViewMode
): void {
  if (isWorkflowWorkbenchView(mode)) mountedDomains.add('workflow')
  if (mode === 'workflow-tasks') mountedDomains.add('workflow-tasks')
  if (
    mode === 'material' || mode === 'split' || mode === 'device-material'
  ) mountedDomains.add('material')
  if (mode === 'device' || mode === 'device-material') {
    mountedDomains.add('device')
  }
  if (isRobotWorkbenchViewMode(mode)) mountedDomains.add('robot-workstation')
}

/**
 * 判断工作流（Workflow）表面在当前领域模式下是否可见。
 *
 * @param mode 当前 Workbench 主区模式。
 * @returns 单工作流或工作流与物料分栏时返回 true。
 */
export function isWorkflowWorkbenchView(mode: WorkbenchViewMode): boolean {
  return mode === 'workflow' || mode === 'split'
}

/**
 * 选择当前调度权威对应的连接事实来源。
 *
 * @param mode 当前连接权威模式。
 * @param sessionPhase Workspace Backend 会话阶段。
 * @param backendConnection 正式 Backend 探测结果。
 * @returns 当前主区应展示的连接状态。
 */
export function workbenchConnectionState(
  mode: WorkbenchConnectionMode,
  sessionPhase: WorkbenchSessionSnapshot['phase'],
  backendConnection: WorkbenchConnectionState
): WorkbenchConnectionState {
  return mode === 'local'
    ? sessionConnectionState(sessionPhase)
    : backendConnection
}

/**
 * 只为已经访问过的领域返回表面，避免无关模块提前抢占运行状态。
 *
 * @param mountedDomains 当前会话已挂载的领域集合。
 * @param domain 待投影的领域身份。
 * @param surface 领域 React 内容。
 * @returns 已挂载时返回内容，否则返回 null。
 */
export function mountedSurface(
  mountedDomains: Set<WorkbenchMountedDomain>,
  domain: WorkbenchMountedDomain,
  surface: ReactNode
): ReactNode {
  return mountedDomains.has(domain) ? surface : null
}

/**
 * 返回 Workbench 标题栏使用的当前领域短名称。
 *
 * @param mode 当前 Workbench 主区模式。
 * @returns 用户可见的中文领域名称。
 */
export function workbenchViewLabel(mode: WorkbenchViewMode): string {
  if (mode === 'split') return '工作流 + 物料'
  if (mode === 'device-material') return '仪器设备 + 物料'
  if (mode === 'workflow') return '工作流'
  if (mode === 'workflow-tasks') return '工作流任务'
  if (mode === 'material') return '物料'
  if (mode === 'device') return '仪器设备'
  if (isRobotWorkbenchViewMode(mode)) return workstationViewLabel(mode)
  return '未打开面板'
}

/**
 * 将机械臂活动栏模式映射为无二级导航的功能模块。
 *
 * @param mode 当前主区模式；非机械臂模式用于隐藏表面的稳定预渲染。
 * @returns 机械臂工作站包接受的模块标识。
 */
export function workstationModule(mode: WorkbenchViewMode): WorkstationModule {
  if (mode === 'robot-points') return 'points'
  if (mode === 'robot-bench') return 'bench'
  if (mode === 'robot-reagents') return 'reagents'
  return 'debug'
}

/**
 * 发布桌面端未保存工作流状态。
 *
 * @param hasUnsavedChanges 当前是否存在未保存修改。
 * @returns 无返回值；非桌面环境没有 preload API 时安全忽略。
 */
export function publishDesktopUnsavedChanges(
  hasUnsavedChanges: boolean
): void {
  const desktopApi = (globalThis as typeof globalThis & {
    api?: { unsavedChanges?: { set(value: boolean): void } }
  }).api
  desktopApi?.unsavedChanges?.set(hasUnsavedChanges)
}

/**
 * 把工作流 IDE 诊断级别映射为 Theia 标准级别。
 *
 * @param severity 工作流 IDE 桥接层的诊断级别。
 * @returns 对应的 Theia 诊断级别。
 */
export function theiaDiagnosticSeverity(
  severity: WorkflowIdeDiagnosticSeverity
): DiagnosticSeverity {
  switch (severity) {
    case 'error': return DiagnosticSeverity.Error
    case 'warning': return DiagnosticSeverity.Warning
    case 'information': return DiagnosticSeverity.Information
    case 'hint': return DiagnosticSeverity.Hint
  }
}

/**
 * 创建尚未连接 PLC-Sim 时的稳定会话快照。
 *
 * @returns 不声称进程已启动的 PLC-Sim 初始事实。
 */
export function emptyPlcSimulatorSnapshot(): WorkbenchSessionSnapshot['plcSimulator'] {
  return {
    phase: 'idle',
    message: '尚未连接环境管理器',
    projectPath: '',
    variableTablePath: '',
    variableTableCandidates: [],
    handshakeProfile: 'szlab',
    pid: null,
    guiUrl: '',
    opcUaUrl: '',
    logPath: '',
    diagnostic: null
  }
}

/**
 * 创建尚未启动 Edge Runtime 时的稳定会话快照。
 *
 * @returns 不声称进程已启动的 Edge Runtime 初始事实。
 */
export function emptyEdgeRuntimeSnapshot(): WorkbenchSessionSnapshot['edgeRuntime'] {
  return {
    phase: 'idle',
    message: 'Edge Runtime 尚未启动',
    pid: null,
    generation: null,
    graphPath: 'deployment/graphs/szlab-local-debug.json',
    mode: 'normal',
    logPath: '',
    diagnostic: null
  }
}

/**
 * 返回机械臂活动栏模式对应的中文主区标题。
 *
 * @param mode 已由类型守卫确认的机械臂模式。
 * @returns 当前功能入口的短标题。
 */
function workstationViewLabel(mode: `robot-${string}`): string {
  if (mode === 'robot-debug') return '动作调试'
  if (mode === 'robot-points') return '点位管理'
  if (mode === 'robot-bench') return '实验台'
  return '试剂'
}
