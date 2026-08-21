import type { WorkbenchConnectionMode } from './workbench-connection-profile'

export type WorkbenchAuthorityTransitionPhase =
  | 'saving'
  | 'publishing'
  | 'canceling'
  | 'verifying'
  | 'switching'

export interface WorkbenchAuthorityTransitionOperations {
  saveWorkspace: () => Promise<void>
  publishAndActivateBackend: () => Promise<void>
  switchAuthority: (
    mode: WorkbenchConnectionMode,
    options?: { force?: boolean; cancelActiveTasks?: boolean }
  ) => Promise<void>
  verifyAuthority: (mode: WorkbenchConnectionMode) => Promise<void>
}

/**
 * 将环境选择收敛成一个事务入口，界面只负责表达阶段和失败恢复。
 *
 * 正常 Local -> Backend 必须保存、替换发布、回读验证并激活；强制路径只
 * 切换 Authority，明确跳过保存、发布和验证。活动任务门禁由 Workspace Host
 * 在权威边界再次校验，不能由前端选项绕过。
 */
export async function transitionWorkbenchAuthority({
  from,
  to,
  force = false,
  cancelActiveTasks = false,
  operations,
  onPhase
}: {
  from: WorkbenchConnectionMode
  to: WorkbenchConnectionMode
  force?: boolean
  cancelActiveTasks?: boolean
  operations: WorkbenchAuthorityTransitionOperations
  onPhase: (phase: WorkbenchAuthorityTransitionPhase) => void
}): Promise<void> {
  if (from === to) return
  if (cancelActiveTasks && from !== 'local') {
    onPhase('canceling')
    await operations.switchAuthority(to, { cancelActiveTasks: true })
    onPhase('verifying')
    await operations.verifyAuthority(to)
    return
  }
  if (force) {
    onPhase('switching')
    await operations.switchAuthority(to, { force: true })
    return
  }
  if (from === 'local' && to === 'backend') {
    onPhase('saving')
    await operations.saveWorkspace()
    onPhase('publishing')
    await operations.publishAndActivateBackend()
    onPhase('verifying')
    await operations.verifyAuthority('backend')
    return
  }
  onPhase('switching')
  await operations.switchAuthority(to)
  onPhase('verifying')
  await operations.verifyAuthority(to)
}

export function workbenchAuthorityTransitionLabel(
  phase: WorkbenchAuthorityTransitionPhase
): string {
  if (phase === 'saving') return '正在保存 Workspace 修改…'
  if (phase === 'publishing') return '正在替换 Backend 定义…'
  if (phase === 'canceling') return '正在取消任务并切换…'
  if (phase === 'verifying') return '正在验证目标方式…'
  return '正在切换调试方式…'
}
