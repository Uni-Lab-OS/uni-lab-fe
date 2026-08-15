import type { CapabilityStatus } from '@unilab/services'
import type { WorkbenchEdgeRuntimeSnapshot } from '@unilab/workbench-session'

import type { WorkbenchConnectionMode } from './workbench-connection-profile'

/**
 * 按当前调度权威选择工作流执行门禁。
 * 后端控制（backend_controlled）的 Edge 在线性由 Backend 预检负责，本地 Edge 快照只约束本地调试。
 *
 * @param mode 当前 Workbench 连接模式。
 * @param edgeRuntime 本地 Edge 运行态快照。
 * @param backendRunStatus Backend 报告的工作流任务运行能力。
 * @returns 与当前调度权威一致的运行门禁状态。
 */
export function workflowExecutionStatusForConnection(
  mode: WorkbenchConnectionMode,
  edgeRuntime: Pick<
    WorkbenchEdgeRuntimeSnapshot,
    'phase' | 'message' | 'diagnostic'
  >,
  backendRunStatus: CapabilityStatus
): CapabilityStatus {
  return mode === 'backend'
    ? backendRunStatus
    : workflowExecutionStatusForEdge(edgeRuntime)
}

/**
 * 把受管 Edge Runtime 状态投影为工作流运行门禁。
 *
 * 该状态只管理任务执行，不会关闭 Local 或 Backend 的图定义编辑能力。
 */
export function workflowExecutionStatusForEdge(
  edgeRuntime: Pick<
    WorkbenchEdgeRuntimeSnapshot,
    'phase' | 'message' | 'diagnostic'
  >
): CapabilityStatus {
  if (edgeRuntime.phase === 'ready') return { available: true }
  if (edgeRuntime.phase === 'idle') {
    return {
      available: false,
      reason: 'OS 尚未启动；请先在环境管理中启动 OS'
    }
  }
  if (edgeRuntime.phase === 'starting') {
    return {
      available: false,
      reason: 'OS 正在启动；请等待设备控制就绪'
    }
  }
  if (edgeRuntime.phase === 'stopping') {
    return {
      available: false,
      reason: 'OS 正在停止；请等待停止完成'
    }
  }
  return {
    available: false,
    reason: `OS 未就绪：${
      edgeRuntime.diagnostic || edgeRuntime.message || '请检查环境日志'
    }`
  }
}
