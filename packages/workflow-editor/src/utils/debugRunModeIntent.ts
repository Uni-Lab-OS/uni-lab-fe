import type { WorkflowTaskRunMode } from '@unilab/services'

export type WorkflowRunIntent = WorkflowTaskRunMode | 'debug'

/**
 * 把新增的调试标记提升为真实调试启动意图。
 *
 * 移除标记只修改调试配置，不擅自覆盖用户随后明确选择的运行模式。
 */
export function runModeAfterDebugMarkerChange(
  current: WorkflowRunIntent,
  removing: boolean
): WorkflowRunIntent {
  return removing ? current : 'debug'
}
