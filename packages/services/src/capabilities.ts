import type { BackendConfig } from './backends'

export interface ServerCapabilities {
  devices: {
    listOnline: boolean
    listActions: boolean
    subscribeStatus: boolean
    forceUnlock: boolean
    runActionTask: boolean
  }
  material: {
    readTemplates: boolean
    readGraph: boolean
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
    recovery: boolean
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
    dispenseReagent: boolean
    readReagentHistory: boolean
  }
  realtime: {
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
  'material.readTemplates',
  'material.readGraph',
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
  'workflow.recovery',
  'reagentInfo.read',
  'reagentInfo.create',
  'reagentInfo.update',
  'reagentInfo.delete',
  'inventory.readReagents',
  'inventory.createReagent',
  'inventory.updateReagent',
  'inventory.deleteReagent',
  'inventory.dispenseReagent',
  'inventory.readReagentHistory',
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
 * 现在只连 Uni-Lab-OS。能力表不再按 local-go / cloud 分流。
 */
export function resolveServerCapabilities(
  _backend?: Pick<BackendConfig, 'id'>
): ServerCapabilities {
  return cloneCapabilities(osCapabilities())
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
      runActionTask: false
    },
    material: {
      readTemplates: false,
      readGraph: false,
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
      subscribeEvents: false,
      recovery: false
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
      dispenseReagent: false,
      readReagentHistory: false
    },
    realtime: {
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

function osCapabilities(): ServerCapabilities {
  const capabilities = unavailableCapabilities()
  capabilities.workflow.recovery = true
  capabilities.devices.listOnline = true
  capabilities.devices.listActions = true
  capabilities.devices.forceUnlock = true
  capabilities.devices.runActionTask = true
  capabilities.devices.subscribeStatus = true
  capabilities.material.readGraph = true
  capabilities.workflow.readDefinitions = true
  capabilities.workflow.authoring = true
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
  capabilities.inventory.dispenseReagent = true
  capabilities.inventory.readReagentHistory = true
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
  _backend: Pick<BackendConfig, 'id' | 'name'>,
  capability: ServerCapability
): string {
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
    return '当前 Uni-Lab-OS 仅提供 1 Hz device_status，尚未提供 push_joint_state'
  }
  if (capability.startsWith('realtime.')) {
    return '当前 Uni-Lab-OS 尚未提供统一关节命令与控制租约契约'
  }
  return '当前 Uni-Lab-OS 尚未向前端公开统一 provisioning 与创建补偿契约'
}
