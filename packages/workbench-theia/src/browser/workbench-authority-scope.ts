/**
 * 生成工作台 authority 状态域；Local Backend 复用端口时仍按工作区隔离。
 */
export function workbenchAuthorityScopeKey(
  targetCacheKey: string,
  workspacePath: string | null | undefined
): string {
  const workspaceIdentity = workspacePath?.trim() || 'workspace-pending'
  return `${targetCacheKey}::${workspaceIdentity}`
}
