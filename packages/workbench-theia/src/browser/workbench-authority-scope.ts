import { createElement, Fragment, type ReactElement, type ReactNode } from 'react'

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
