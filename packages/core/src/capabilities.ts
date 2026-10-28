/** 当前前端需要展示的后端能力声明。能力是静态 profile 事实，不通过试请求推断。 */
export const SERVER_CAPABILITY_KEYS = [
  'workflow.editDefinitions',
  'reagentInfo.create',
  'reagentInfo.update',
  'reagentInfo.delete',
  'reagentInfo.batchImport',
  'reagentInfo.readStructure3d',
  'reagentInfo.lookupCompound',
  'inventory.createReagent',
  'inventory.updateReagent',
  'inventory.deleteReagent',
  'inventory.readReagentHistory',
  'inventory.batchImportReagents',
  'inventory.dispenseReagent',
  'deviceAction.presentation',
  'workflow.humanInteraction',
  'workflow.resolveUncertain',
  'workflow.unlockResources',
  'scheduler.timePlan',
  'station.errorHandling',
  'workflow.taskPresentationSummary',
  'material.sitePlacement',
] as const

export type ServerCapability = (typeof SERVER_CAPABILITY_KEYS)[number]

export interface BackendCapabilityTarget {
  readonly id: string
  readonly name: string
}

export interface CapabilityStatus {
  readonly available: boolean
  readonly reason?: string
}

const LOCAL_GO_CAPABILITIES = new Set<ServerCapability>([
  'workflow.editDefinitions',
  'reagentInfo.create',
  'reagentInfo.update',
  'reagentInfo.delete',
  'inventory.createReagent',
  'inventory.updateReagent',
  'inventory.deleteReagent',
  'inventory.readReagentHistory',
])

const LOCAL_PYTHON_CAPABILITIES = new Set<ServerCapability>([
  ...LOCAL_GO_CAPABILITIES,
  // OS 工作流人工交互（HumanCommands）读取与回复：/workflow-tasks/{task}/human-interactions。
  'workflow.humanInteraction',
  'reagentInfo.batchImport',
  'reagentInfo.readStructure3d',
  'reagentInfo.lookupCompound',
  'inventory.batchImportReagents',
  'inventory.dispenseReagent',
])

/**
 * pTLC 设备包启动的 OS 控制台（Uni-Lab-pTLC tools/ptlc_migration/preview.py）。
 * 在本地 Python OS 能力之上额外提供设备动作展示元数据（中文标签、范围、枚举、点位、类别）。
 */
const PTLC_NATIVE_CAPABILITIES = new Set<ServerCapability>([
  ...LOCAL_PYTHON_CAPABILITIES,
  'deviceAction.presentation',
  // 设备包实现了 OS UNKNOWN 处置执行端（tools/ptlc_migration/unknown_resolution.py）。
  'workflow.resolveUncertain',
  // OS 任务命令 unlock_resources：异常终态任务确认现场安全后整组释放资源（本机仿真验证）。
  'workflow.unlockResources',
  // OS 调度器只读观测：/api/v1/scheduler/time-plan 与 /api/v1/timeline（pTLC 控制台挂载了调度路由）。
  'scheduler.timePlan',
  // OS 工站错误处置：/api/v1/stations/local/error-handling 及决定/会话/恢复（本机仿真验证）。
  'station.errorHandling',
  // 任务列表摘要视图 GET /api/v1/workflow-task-presentations?view=summary（summary_version=1）：
  // 不返回执行计划与逐 Job 数组。需要包含 Uni-Lab-OS 提交 e1b7a42a 的 OS 构建；更早的 OS
  // 以 invalid_input 拒绝该视图，部署旧 OS 时必须从本 profile 移除此能力。
  'workflow.taskPresentationSummary',
  // OS 人工上下料 PUT /api/v1/materials/{uuid} 的 site_placement（place 放入或换到库位、remove 解除占用）：
  // 带 expected_revision 修订校验，任务占用物料或库位时 OS 拒绝。Uni-Lab-OS feat/multi-sample 76bd1c27
  // 本机仿真验证；不带幂等键，失败或超时不自动重试，以重读的物料图为准。
  'material.sitePlacement',
])

/** 返回当前 profile 已完成联调的能力集合；未知 profile 默认关闭。 */
export function resolveServerCapabilities(
  target: Pick<BackendCapabilityTarget, 'id'>,
): ReadonlySet<ServerCapability> {
  if (target.id === 'local-python') return LOCAL_PYTHON_CAPABILITIES
  if (target.id === 'ptlc-native') return PTLC_NATIVE_CAPABILITIES
  if (target.id === 'local-go') return LOCAL_GO_CAPABILITIES
  return new Set<ServerCapability>()
}

export function getCapabilityStatus(
  target: BackendCapabilityTarget,
  capabilities: ReadonlySet<ServerCapability>,
  capability: ServerCapability,
): CapabilityStatus {
  if (capabilities.has(capability)) return { available: true }
  return {
    available: false,
    reason: `${target.name} 尚未声明 ${capability} 能力`,
  }
}
