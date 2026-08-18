import type { DeviceManagementConnection } from '@unilab/device-management'
import type { WorkbenchSessionSnapshot } from '@unilab/workbench-session'

import type { WorkbenchConnectionMode } from './workbench-connection-profile'

/**
 * 设备页的“Edge 在线”只取真实 Edge Runtime，而不是 Workspace Backend
 * 目录接口的连通状态。Backend 模式继续使用远端 Authority 健康结果。
 */
export function workbenchDeviceConnection(
  mode: WorkbenchConnectionMode,
  authorityConnection: DeviceManagementConnection,
  edgePhase: WorkbenchSessionSnapshot['edgeRuntime']['phase']
): DeviceManagementConnection {
  if (mode === 'backend') return authorityConnection
  if (edgePhase === 'ready') return 'connected'
  if (
    edgePhase === 'starting' ||
    edgePhase === 'waiting' ||
    edgePhase === 'validating' ||
    edgePhase === 'stopping'
  ) return 'connecting'
  if (edgePhase === 'failed') return 'error'
  return 'disconnected'
}
