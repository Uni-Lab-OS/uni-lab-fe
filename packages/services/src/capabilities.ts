import type { BackendConfig } from './backends'

export interface ServerCapabilities {
  devices: {
    listOnline: boolean
    listActions: boolean
    subscribeStatus: boolean
    forceUnlock: boolean
    runActionTask: boolean
    manualExclusive: boolean
  }
  material: {
    readTemplates: boolean
    readGraph: boolean
    subscribeMoves: boolean
    create: boolean
    updateConfig: boolean
    updateSite: boolean
    move: boolean
    attach: boolean
    detach: boolean
    deleteSubtrees: boolean
    readContents: boolean
    updateContents: boolean
    persistentUndo: boolean
  }
  workflow: {
    readDefinitions: boolean
    authoring: boolean
    editDefinitions: boolean
    runTasks: boolean
    subscribeEvents: boolean
  }
  reagentInfo: {
    read: boolean
    create: boolean
    update: boolean
    delete: boolean
  }
  inventory: {
    readReagents: boolean
    createReagent: boolean
    updateReagent: boolean
    deleteReagent: boolean
    readReagentHistory: boolean
  }
  realtime: {
    subscribeJointState: boolean
    subscribeKinematicAttachment: boolean
    pushJointState: boolean
    setJointState: boolean
    jointControlLease: boolean
  }
  edge: {
    provisioning: boolean
    undoCreate: boolean
  }
}

export const SERVER_CAPABILITY_KEYS = [
  'devices.listOnline',
  'devices.listActions',
  'devices.subscribeStatus',
  'devices.forceUnlock',
  'devices.runActionTask',
  'devices.manualExclusive',
  'material.readTemplates',
  'material.readGraph',
  'material.subscribeMoves',
  'material.create',
  'material.updateConfig',
  'material.updateSite',
  'material.move',
  'material.attach',
  'material.detach',
  'material.deleteSubtrees',
  'material.readContents',
  'material.updateContents',
  'material.persistentUndo',
  'workflow.readDefinitions',
  'workflow.authoring',
  'workflow.editDefinitions',
  'workflow.runTasks',
  'workflow.subscribeEvents',
  'reagentInfo.read',
  'reagentInfo.create',
  'reagentInfo.update',
  'reagentInfo.delete',
  'inventory.readReagents',
  'inventory.createReagent',
  'inventory.updateReagent',
  'inventory.deleteReagent',
  'inventory.readReagentHistory',
  'realtime.subscribeJointState',
  'realtime.subscribeKinematicAttachment',
  'realtime.pushJointState',
  'realtime.setJointState',
  'realtime.jointControlLease',
  'edge.provisioning',
  'edge.undoCreate'
] as const

export type ServerCapability = (typeof SERVER_CAPABILITY_KEYS)[number]

export interface CapabilityStatus {
  available: boolean
  reason?: string
}

/**
 * These presets describe the APIs that are available now, not the APIs planned
 * by the target architecture. A capability only becomes true when the selected
 * server implements the complete semantics represented by its key.
 */
const CURRENT_DEFAULT_CAPABILITIES: Readonly<
  Record<string, ServerCapabilities>
> = {
  'local-go': localGoCapabilities(),
  'local-python': localPythonCapabilities(),
  cloud: unavailableCapabilities()
}

/**
 * Capabilities are resolved statically. Unknown/custom profile IDs are
 * deny-by-default until an adapter explicitly declares support.
 */
export function resolveServerCapabilities(
  backend: Pick<BackendConfig, 'id'>
): ServerCapabilities {
  return cloneCapabilities(
    CURRENT_DEFAULT_CAPABILITIES[backend.id] ?? unavailableCapabilities()
  )
}

export function hasServerCapability(
  capabilities: ServerCapabilities,
  capability: ServerCapability
): boolean {
  const [group, key] = capability.split('.') as [
    keyof ServerCapabilities,
    string
  ]
  const groupCapabilities = capabilities[group] as unknown as
    Record<string, boolean>
  return groupCapabilities[key] === true
}

export function getCapabilityStatus(
  backend: Pick<BackendConfig, 'id' | 'name'>,
  capabilities: ServerCapabilities,
  capability: ServerCapability
): CapabilityStatus {
  if (hasServerCapability(capabilities, capability)) {
    return { available: true }
  }

  return {
    available: false,
    reason: unavailableReason(backend, capability)
  }
}

function unavailableCapabilities(): ServerCapabilities {
  return {
    devices: {
      listOnline: false,
      listActions: false,
      subscribeStatus: false,
      forceUnlock: false,
      runActionTask: false,
      manualExclusive: false
    },
    material: {
      readTemplates: false,
      readGraph: false,
      subscribeMoves: false,
      create: false,
      updateConfig: false,
      updateSite: false,
      move: false,
      attach: false,
      detach: false,
      deleteSubtrees: false,
      readContents: false,
      updateContents: false,
      persistentUndo: false
    },
    workflow: {
      readDefinitions: false,
      authoring: false,
      editDefinitions: false,
      runTasks: false,
      subscribeEvents: false
    },
    reagentInfo: {
      read: false,
      create: false,
      update: false,
      delete: false
    },
    inventory: {
      readReagents: false,
      createReagent: false,
      updateReagent: false,
      deleteReagent: false,
      readReagentHistory: false
    },
    realtime: {
      subscribeJointState: false,
      subscribeKinematicAttachment: false,
      pushJointState: false,
      setJointState: false,
      jointControlLease: false
    },
    edge: {
      provisioning: false,
      undoCreate: false
    }
  }
}

/** 返回已完成真实 Backend 联调的本地 Go 能力集合；未验证写能力继续关闭失败。 */
function localGoCapabilities(): ServerCapabilities {
  const capabilities = unavailableCapabilities()
  capabilities.devices.listOnline = true
  capabilities.devices.listActions = true
  capabilities.devices.runActionTask = true
  capabilities.material.readTemplates = true
  capabilities.material.readGraph = true
  capabilities.workflow.readDefinitions = true
  capabilities.workflow.editDefinitions = true
  capabilities.workflow.runTasks = true
  capabilities.workflow.subscribeEvents = true
  capabilities.reagentInfo.read = true
  capabilities.reagentInfo.create = true
  capabilities.reagentInfo.update = true
  capabilities.reagentInfo.delete = true
  capabilities.inventory.readReagents = true
  capabilities.inventory.createReagent = true
  capabilities.inventory.updateReagent = true
  capabilities.inventory.deleteReagent = true
  capabilities.inventory.readReagentHistory = true
  return capabilities
}

function localPythonCapabilities(): ServerCapabilities {
  const capabilities = unavailableCapabilities()
  capabilities.devices.listOnline = true
  capabilities.devices.listActions = true
  capabilities.devices.forceUnlock = true
  capabilities.devices.runActionTask = true
  capabilities.devices.manualExclusive = true
  // 本地后端（Local Backend）把 Edge 短通知投影为统一设备遥测 SSE。
  capabilities.devices.subscribeStatus = true
  capabilities.realtime.subscribeJointState = true
  capabilities.realtime.subscribeKinematicAttachment = true
  capabilities.material.readGraph = true
  capabilities.material.subscribeMoves = true
  capabilities.workflow.readDefinitions = true
  capabilities.workflow.authoring = true
  capabilities.workflow.runTasks = true
  capabilities.workflow.subscribeEvents = true
  capabilities.inventory.readReagents = true
  return capabilities
}

function cloneCapabilities(
  capabilities: ServerCapabilities
): ServerCapabilities {
  return {
    devices: { ...capabilities.devices },
    material: { ...capabilities.material },
    workflow: { ...capabilities.workflow },
    reagentInfo: { ...capabilities.reagentInfo },
    inventory: { ...capabilities.inventory },
    realtime: { ...capabilities.realtime },
    edge: { ...capabilities.edge }
  }
}

function unavailableReason(
  backend: Pick<BackendConfig, 'id' | 'name'>,
  capability: ServerCapability
): string {
  if (backend.id === 'local-go') {
    if (capability.startsWith('devices.')) {
      return '当前 Backend 已提供设备目录，但动作运行、强制解锁或实时状态仍缺少完整语义'
    }
    if (capability.startsWith('material.')) {
      return '当前 Backend 物料目录与物料图只读可用，写操作尚未对齐修订、幂等与补偿契约'
    }
    if (capability.startsWith('workflow.')) {
      return '当前 Backend 已提供工作流目录，但前端创作模型、运行事件与安全恢复语义尚未完整对齐'
    }
    if (capability.startsWith('reagentInfo.')) {
      return '当前 Go 后端试剂信息接口尚未接入统一前端 Service Port'
    }
    if (capability.startsWith('inventory.')) {
      return '当前 Go 后端尚未提供该库存只读能力'
    }
    if (capability.startsWith('realtime.')) {
      return '当前 Go 后端尚未提供 unilab/realtime-v1 实时接口'
    }
    return '当前 Go 后端尚未提供统一边缘端配置与创建补偿契约'
  }

  if (backend.id === 'local-python') {
    if (capability.startsWith('devices.')) {
      return '当前 Uni-Lab-OS 尚未提供该设备能力'
    }
    if (capability.startsWith('material.')) {
      return '当前 Uni-Lab-OS 物料图仅开放只读查询，写操作尚未提供统一命令契约'
    }
    if (capability.startsWith('workflow.')) {
      return '当前 Uni-Lab-OS 尚未提供该工作流能力'
    }
    if (capability.startsWith('reagentInfo.')) {
      return '当前 Uni-Lab-OS 尚未提供统一试剂信息查询与创建契约'
    }
    if (capability.startsWith('inventory.')) {
      return '当前 Uni-Lab-OS 尚未提供该库存只读能力'
    }
    if (capability === 'realtime.pushJointState') {
      return '关节状态（JointState）只允许 OS 通过统一设备遥测合同发布，前端不得 push'
    }
    if (capability.startsWith('realtime.')) {
      return '当前 Uni-Lab-OS 尚未提供统一关节命令与控制租约契约'
    }
    return '当前 Uni-Lab-OS 尚未向前端公开统一 provisioning 与创建补偿契约'
  }

  if (backend.id === 'cloud') {
    return '旧版云端接口不属于统一新协议；新版云端服务契约尚未接入'
  }

  return `${backend.name} 尚未声明 ${capability} 能力`
}
