import type { PreflightReport, RunConfiguration } from '@unilab-fe/core'

/**
 * 运行向导草稿的刷新持久化。只存浏览器标签页内的 sessionStorage：
 * 刷新或前进后退不丢，关闭标签页即清除；键里带后端地址，切换后端不会串用。
 */
const VERSION = 'v1'

export interface PersistedRunDraft {
  readonly configuration: RunConfiguration
  readonly preflight: PreflightReport | null
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function draftKey(apiUrl: string, workflowUuid: string): string {
  return `unilab:run-draft:${VERSION}:${apiUrl}:${workflowUuid}`
}

function debugKey(apiUrl: string): string {
  return `unilab:debug-workflow:${VERSION}:${apiUrl}`
}

export function readRunDraft(apiUrl: string, workflowUuid: string): PersistedRunDraft | null {
  try {
    const raw = storage()?.getItem(draftKey(apiUrl, workflowUuid))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedRunDraft> | null
    const configuration = parsed?.configuration
    if (!configuration || typeof configuration !== 'object' || typeof configuration.input !== 'object') {
      return null
    }
    const preflight = parsed?.preflight
    return {
      configuration,
      preflight:
        preflight && preflight.kind === 'preflight_report' && preflight.workflowUuid === workflowUuid
          ? preflight
          : null,
    }
  } catch {
    return null
  }
}

export function writeRunDraft(
  apiUrl: string,
  workflowUuid: string,
  draft: PersistedRunDraft,
): void {
  try {
    storage()?.setItem(draftKey(apiUrl, workflowUuid), JSON.stringify(draft))
  } catch {
    // 存储不可用或已满时退回为仅内存保留，不影响运行向导本身。
  }
}

export function clearRunDraft(apiUrl: string, workflowUuid: string): void {
  try {
    storage()?.removeItem(draftKey(apiUrl, workflowUuid))
  } catch {
    // 同上
  }
}

export function readDebugWorkflow(apiUrl: string): string | null {
  try {
    return storage()?.getItem(debugKey(apiUrl)) ?? null
  } catch {
    return null
  }
}

export function writeDebugWorkflow(apiUrl: string, workflowUuid: string | null): void {
  try {
    if (workflowUuid) storage()?.setItem(debugKey(apiUrl), workflowUuid)
    else storage()?.removeItem(debugKey(apiUrl))
  } catch {
    // 同上
  }
}
