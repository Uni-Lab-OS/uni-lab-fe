import { createElement, Fragment, type ReactElement, type ReactNode } from 'react'

/**
 * 生成持久工作区状态域；相同 Backend 地址复用于不同工作区时仍保持隔离。
 */
export function workbenchWorkspaceScopeKey(
  targetCacheKey: string,
  workspacePath: string | null | undefined
): string {
  const workspaceIdentity = workspacePath?.trim() || 'workspace-pending'
  return `${targetCacheKey}::${workspaceIdentity}`
}

/** 保留既有 authority 命名，供独立测试夹具和外部调用继续使用。 */
export function workbenchAuthorityScopeKey(
  targetCacheKey: string,
  workspacePath: string | null | undefined
): string {
  return workbenchWorkspaceScopeKey(targetCacheKey, workspacePath)
}

/**
 * 生成当前会话状态域；同一路径重启后也必须重建在途的领域状态。
 */
export function workbenchSessionScopeKey(
  targetCacheKey: string,
  workspacePath: string | null | undefined,
  generation: string | null | undefined
): string {
  const workspaceScope = workbenchWorkspaceScopeKey(
    targetCacheKey,
    workspacePath
  )
  const sessionGeneration = generation?.trim() || 'generation-pending'
  return `${workspaceScope}::${sessionGeneration}`
}

/** 在 authority 状态域改变时重建工作台领域子树，清除旧工作流的在途状态。 */
export function WorkbenchAuthorityScopeBoundary({
  scopeKey,
  children
}: {
  scopeKey: string
  children: ReactNode
}): ReactElement {
  return createElement(Fragment, { key: scopeKey }, children)
}
