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
