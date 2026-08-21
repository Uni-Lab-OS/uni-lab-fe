import type {
  WorkbenchEnvironmentLogKind,
  WorkbenchSessionPhase,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'

import type {
  ManagedRuntimeInstallationSnapshot
} from './desktop-managed-runtime'

export type EnvironmentOverviewTone =
  | 'ready'
  | 'attention'
  | 'busy'
  | 'idle'

export type EnvironmentRecommendedAction =
  | 'install-runtime'
  | 'rebuild-local-data'
  | 'restart-os'
  | 'start-plc'
  | null

export interface EnvironmentOverview {
  tone: EnvironmentOverviewTone
  title: string
  message: string
  modeLabel: string
  issueCount: number
  recommendedAction: EnvironmentRecommendedAction
  recommendedActionLabel: string | null
  logKind: WorkbenchEnvironmentLogKind
}

export interface EnvironmentOperationError {
  title: string
  message: string
  technicalDetail?: string
}

/** 将内部阶段翻译成面向操作者的稳定中文状态。 */
export function environmentPhaseLabel(phase: string): string {
  switch (phase) {
    case 'ready': return '已就绪'
    case 'external': return '使用现有环境'
    case 'idle': return '未启动'
    case 'validating': return '正在校验'
    case 'starting': return '正在启动'
    case 'waiting': return '正在等待'
    case 'installing': return '正在安装'
    case 'stopping': return '正在停止'
    case 'not-installed': return '尚未安装'
    case 'unavailable': return '当前不可用'
    case 'failed': return '需要处理'
    default: return phase
  }
}

/** 为标题栏提供面向任务的本地调试状态，而不是单个进程状态。 */
export function localEnvironmentTone(
  session: WorkbenchSessionSnapshot
): EnvironmentOverviewTone {
  if (
    session.phase === 'failed'
    || session.edgeRuntime.phase === 'failed'
  ) return 'attention'
  if (
    isBusyPhase(session.phase)
    || isBusyPhase(session.edgeRuntime.phase)
  ) return 'busy'
  if (session.phase === 'ready' && session.edgeRuntime.phase === 'ready') {
    return 'ready'
  }
  return 'idle'
}

/** 汇总用户真正需要判断的可调试性、设备动作和下一步操作。 */
export function deriveEnvironmentOverview(
  session: WorkbenchSessionSnapshot,
  runtime: ManagedRuntimeInstallationSnapshot | null
): EnvironmentOverview {
  const tone = localEnvironmentTone(session)
  const mode = session.edgeRuntime.mode ?? session.configuredRuntimeMode
  const modeLabel = mode === 'dry-run'
    ? '不会控制设备 · 模拟'
    : '会控制设备'
  const runtimeIssue = Boolean(
    runtime
    && runtime.phase !== 'unavailable'
    && ['not-installed', 'failed'].includes(runtime.phase)
  )
  const sessionIssue = session.phase === 'failed'
  const edgeIssue = session.edgeRuntime.phase === 'failed'
  const plcIssue = session.plcSimulator.phase === 'failed'
  const agentIssue = session.agent?.phase === 'failed'
  const issueCount = [
    runtimeIssue,
    sessionIssue || edgeIssue,
    plcIssue,
    agentIssue
  ].filter(Boolean).length

  if (runtimeIssue && session.phase !== 'ready') {
    return {
      tone: 'attention',
      title: '本地调试组件需要安装',
      message: runtime?.error ?? '安装应用组件后即可开始本地调试。',
      modeLabel,
      issueCount,
      recommendedAction: 'install-runtime',
      recommendedActionLabel: '安装调试组件',
      logKind: 'workspace-backend'
    }
  }

  if (sessionIssue) {
    const rebuild = session.diagnostic?.recovery.includes('重建') === true
    return {
      tone: 'attention',
      title: '开始调试前需要处理',
      message: localDebugIssueMessage(session),
      modeLabel,
      issueCount,
      recommendedAction: rebuild ? 'rebuild-local-data' : 'restart-os',
      recommendedActionLabel: rebuild ? '重建本地数据' : '重新启动本地调试',
      logKind: session.diagnostic?.code === 'plc_connection_failed'
        ? 'plc-sim'
        : 'os'
    }
  }

  if (edgeIssue) {
    return {
      tone: 'attention',
      title: '开始调试前需要处理',
      message: localDebugIssueMessage(session),
      modeLabel,
      issueCount,
      recommendedAction: 'restart-os',
      recommendedActionLabel: '重新启动本地调试',
      logKind: 'os'
    }
  }

  if (tone === 'busy') {
    return {
      tone,
      title: '正在准备本地调试',
      message: busyEnvironmentMessage(),
      modeLabel,
      issueCount,
      recommendedAction: null,
      recommendedActionLabel: null,
      logKind: 'os'
    }
  }

  if (tone === 'ready') {
    return {
      tone,
      title: '可以开始本地调试',
      message: mode === 'dry-run'
        ? '工作流会完整执行，但不会控制设备。'
        : '工作流和设备已准备好；开始后会控制已连接设备。',
      modeLabel,
      issueCount,
      recommendedAction: null,
      recommendedActionLabel: null,
      logKind: 'os'
    }
  }

  return {
    tone: 'idle',
    title: '本地调试尚未启动',
    message: '需要时启动，即可在当前工作区调试工作流。',
    modeLabel,
    issueCount,
    recommendedAction: 'restart-os',
    recommendedActionLabel: '启动本地调试',
    logKind: 'os'
  }
}

/** 将操作异常转换成“问题—影响—下一步”，原始文本仅作技术详情。 */
export function describeEnvironmentOperationError(
  action: string,
  technicalDetail: string
): EnvironmentOperationError {
  const known: Record<string, Omit<EnvironmentOperationError, 'technicalDetail'>> = {
    'install-runtime': {
      title: '调试组件安装失败',
      message: '未能准备本地调试组件。请检查安装包完整性后重试。'
    },
    'save-graph': {
      title: '设备配置未保存',
      message: '请确认设备配置路径有效并仍位于当前工作区，然后重试。'
    },
    'rebuild-local-data': {
      title: '本地数据重建失败',
      message: '原有本地数据未被确认替换。请查看调试日志后重试。'
    },
    'restart-os': {
      title: '本地调试未能启动',
      message: '请查看当前诊断和调试日志；若端口被占用，再使用维修操作。'
    },
    'stop-os': {
      title: '本地调试未能停止',
      message: '服务可能仍在工作。请查看调试日志后重试。'
    },
    'release-os-ports': {
      title: '本地端口仍被占用',
      message: '未能释放本地调试端口。请确认没有其他工作区正在使用这些端口。'
    },
    'start-plc': {
      title: 'PLC-Sim 未能启动',
      message: '请检查项目目录、变量表和握手器配置后重试。'
    },
    'save-plc': {
      title: 'PLC 配置未保存',
      message: '请检查项目目录和变量表路径；正在运行时保存会重新启动 PLC-Sim。'
    },
    'refresh-plc-tables': {
      title: '没有更新变量表推荐',
      message: '请确认设备配置和 PLC 项目目录可访问，然后重试。'
    },
    'release-plc-ports': {
      title: 'PLC 端口仍被占用',
      message: '请确认没有其他 PLC-Sim 实例正在使用 18765 或 4855 端口。'
    },
    'read-log': {
      title: '日志读取失败',
      message: '当前日志不可读取。请确认对应服务已启动后重试。'
    },
    'start-agent': {
      title: '工作区助手未能启动',
      message: '请查看助手日志并确认应用安装完整。'
    },
    'restart-agent': {
      title: '工作区助手未能重启',
      message: '请查看助手日志后重试。'
    }
  }
  const resolved = known[action] ?? {
    title: '本次操作未完成',
    message: '当前状态未发生确认变更。请查看技术信息后重试。'
  }
  return {
    ...resolved,
    technicalDetail
  }
}

export function environmentOperationSuccess(action: string): string | null {
  switch (action) {
    case 'install-runtime': return '本地调试组件已安装并通过验证。'
    case 'save-graph': return '设备配置已保存；下次重建本地数据时生效。'
    case 'rebuild-local-data': return '本地数据已重建，可以重新启动或运行工作流。'
    case 'restart-os': return '本地调试已启动。'
    case 'stop-os': return '本地调试已停止。'
    case 'release-os-ports': return '本地调试端口已释放。'
    case 'save-plc': return 'PLC 配置已保存。'
    case 'start-plc': return 'PLC-Sim 已启动。'
    case 'stop-plc': return 'PLC-Sim 已停止。'
    case 'refresh-plc-tables': return '变量表推荐已更新。'
    case 'release-plc-ports': return 'PLC-Sim 端口已释放。'
    case 'start-agent': return '工作区助手已启动。'
    case 'restart-agent': return '工作区助手已重启。'
    case 'stop-agent': return '工作区助手已停止。'
    default: return null
  }
}

function isBusyPhase(phase: WorkbenchSessionPhase | string): boolean {
  return ['validating', 'starting', 'waiting', 'stopping', 'installing']
    .includes(phase)
}

function busyEnvironmentMessage(): string {
  return '正在准备工作流和设备连接…'
}

function localDebugIssueMessage(session: WorkbenchSessionSnapshot): string {
  return session.diagnostic?.message
    ?? session.edgeRuntime.diagnostic
    ?? '本地调试尚未准备好；请查看调试日志后重试。'
}
