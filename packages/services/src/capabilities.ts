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
  reagentInfo: {
    read: boolean
    create: boolean
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
  'reagentInfo.read',
  'reagentInfo.create',
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
  switch (capability) {
    case 'devices.listOnline':
      return capabilities.devices.listOnline
    case 'devices.listActions':
      return capabilities.devices.listActions
    case 'devices.subscribeStatus':
      return capabilities.devices.subscribeStatus
    case 'devices.forceUnlock':
      return capabilities.devices.forceUnlock
    case 'devices.runActionTask':
      return capabilities.devices.runActionTask
    case 'material.readTemplates':
      return capabilities.material.readTemplates
    case 'material.readGraph':
      return capabilities.material.readGraph
    case 'material.create':
      return capabilities.material.create
    case 'material.updateConfig':
      return capabilities.material.updateConfig
    case 'material.updateSite':
      return capabilities.material.updateSite
    case 'material.move':
      return capabilities.material.move
    case 'material.attach':
      return capabilities.material.attach
    case 'material.detach':
      return capabilities.material.detach
    case 'material.deleteSubtrees':
      return capabilities.material.deleteSubtrees
    case 'material.readContents':
      return capabilities.material.readContents
    case 'material.updateContents':
      return capabilities.material.updateContents
    case 'material.persistentUndo':
      return capabilities.material.persistentUndo
    case 'reagentInfo.read':
      return capabilities.reagentInfo.read
    case 'reagentInfo.create':
      return capabilities.reagentInfo.create
    case 'realtime.pushJointState':
      return capabilities.realtime.pushJointState
    case 'realtime.setJointState':
      return capabilities.realtime.setJointState
    case 'realtime.jointControlLease':
      return capabilities.realtime.jointControlLease
    case 'edge.provisioning':
      return capabilities.edge.provisioning
    case 'edge.undoCreate':
      return capabilities.edge.undoCreate
  }
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
    reagentInfo: {
      read: false,
      create: false
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

function localGoCapabilities(): ServerCapabilities {
  return unavailableCapabilities()
}

function localPythonCapabilities(): ServerCapabilities {
  const capabilities = unavailableCapabilities()
  capabilities.devices.listActions = true
  capabilities.devices.forceUnlock = true
  capabilities.devices.runActionTask = true
  // Edge FastAPI broadcasts at :18003/api/v1/ws/device_status (not Bridge :8014).
  capabilities.devices.subscribeStatus = true
  capabilities.material.readGraph = true
  return capabilities
}

function cloneCapabilities(
  capabilities: ServerCapabilities
): ServerCapabilities {
  return {
    devices: { ...capabilities.devices },
    material: { ...capabilities.material },
    reagentInfo: { ...capabilities.reagentInfo },
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
      return '当前 Go 后端尚未声明统一设备目录与实时状态订阅契约'
    }
    if (capability.startsWith('material.')) {
      return '当前 Go 后端只有行级物料接口，尚未实现统一物料聚合、修订版本与原子命令契约'
    }
    if (capability.startsWith('reagentInfo.')) {
      return '当前 Go 后端试剂信息接口尚未接入统一前端 Service Port'
    }
    if (capability.startsWith('realtime.')) {
      return '当前 Go 后端尚未提供 unilab/realtime-v1 实时接口'
    }
    return '当前 Go 后端尚未提供统一边缘端配置与创建补偿契约'
  }

  if (backend.id === 'local-python') {
    if (capability.startsWith('devices.')) {
      return '当前 Uni-Lab-OS unified v1 bridge 尚未提供设备目录与 device_status 订阅'
    }
    if (capability.startsWith('material.')) {
      return '当前 Uni-Lab-OS 物料图仅开放只读查询，写操作尚未提供统一命令契约'
    }
    if (capability.startsWith('reagentInfo.')) {
      return '当前 Uni-Lab-OS 尚未提供统一试剂信息查询与创建契约'
    }
    if (capability === 'realtime.pushJointState') {
      return '当前 Uni-Lab-OS 仅提供 1 Hz device_status，尚未提供 push_joint_state'
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
