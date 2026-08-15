import type {
  CapabilityStatus,
  WorkflowRunPreflightReport,
  WorkflowTaskRunMode
} from '@unilab/services'

/** Identifies the execution-readiness state that owns one run-preflight result. */
export function existingWorkflowPreflightReadinessKey(
  status?: CapabilityStatus
): string {
  if (!status) return 'unknown'
  return status.available
    ? 'available'
    : `blocked:${status.reason ?? ''}`
}

/** Backend 已有工作流入口公开的三种正式运行模式。 */
export const EXISTING_WORKFLOW_RUN_MODE_OPTIONS: ReadonlyArray<{
  value: WorkflowTaskRunMode
  label: string
  description: string
}> = [
  {
    value: 'normal',
    label: '完整运行',
    description: 'Scheduler 自动推进全部可执行节点'
  },
  {
    value: 'step',
    label: '单步运行',
    description: '创建后暂停，每次“单步”最多放行一个节点'
  },
  {
    value: 'single_node',
    label: '单节点调试',
    description: '只创建并运行明确选择的一个节点'
  }
]

/** 返回正式运行模式的中文领域名称。 */
export function existingWorkflowRunModeLabel(
  runMode: WorkflowTaskRunMode
): string {
  return {
    normal: '完整运行',
    step: '单步运行',
    single_node: '单节点运行'
  }[runMode]
}

/** 返回当前模式对应的主操作文案，并保留默认模式的既有入口名称。 */
export function existingWorkflowRunButtonLabel(
  runMode: WorkflowTaskRunMode
): string {
  return runMode === 'normal'
    ? '运行已有工作流'
    : `创建${existingWorkflowRunModeLabel(runMode)}任务`
}

/** 把运行预检快照投影为紧凑、可操作的状态摘要。 */
export function existingWorkflowPreflightSummaryLabel(options: {
  loading: boolean
  report: WorkflowRunPreflightReport | null
  error: string | null
  targetRequired: boolean
}): string {
  if (options.targetRequired) return '选择目标节点后开始预检'
  if (options.loading) return '正在检查设备、资源与执行计划…'
  if (options.error) return `预检失败：${options.error}`
  if (!options.report) return '尚无预检结果'
  if (options.report.status === 'ready' && options.report.can_run) {
    return `已通过 · ${options.report.summary.execution_node_count} 个执行节点`
  }
  if (options.report.status === 'requires_confirmation') {
    return `需要确认 · ${options.report.summary.confirmation_required_count} 项`
  }
  return `存在阻塞 · ${options.report.summary.blocking_check_count} 项`
}

/** 返回 Backend 预检拒绝创建任务时最具体的一条诊断。 */
export function existingWorkflowPreflightFailureMessage(
  report: WorkflowRunPreflightReport
): string {
  const diagnostic = report.checks.find((check) => (
    check.blocking || check.status === 'confirmation_required'
  ))
  if (diagnostic) return `运行预检未通过：${diagnostic.message}`
  return report.status === 'requires_confirmation'
    ? '运行预检需要人工确认，Backend 尚未提供确认提交合同'
    : '运行预检未通过，请检查设备、资源和工作流定义'
}

/** 解释主运行按钮在当前权威状态下为何不可提交。 */
export function existingWorkflowStartDisabledReason(options: {
  busy: boolean
  loadingTask: boolean
  liveTask: boolean
  executionBlockedReason?: string | null
  preflightLoading: boolean
  preflight: WorkflowRunPreflightReport | null
  preflightError: string | null
  targetRequired: boolean
}): string {
  if (options.busy) return '正在提交运行操作'
  if (options.executionBlockedReason) return options.executionBlockedReason
  if (options.loadingTask) return '正在确认是否已有未结束的工作流任务'
  if (options.liveTask) return '当前工作流仍有未结束的任务，请先等待或取消'
  if (options.targetRequired) return '单节点调试必须先选择一个可运行节点'
  if (options.preflightLoading) return '正在执行 Backend 运行预检'
  if (options.preflightError) return 'Backend 运行预检失败，请重新预检'
  if (options.preflight?.status === 'requires_confirmation') {
    return '运行条件需要人工确认，当前接口尚未提供确认提交合同'
  }
  if (!options.preflight?.can_run) return 'Backend 运行预检尚未通过'
  return '当前不能创建工作流任务'
}
