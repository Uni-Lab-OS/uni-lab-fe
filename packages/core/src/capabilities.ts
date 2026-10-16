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
