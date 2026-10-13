/**
 * 任务级整组解锁的门禁。
 *
 * 语义照抄 OS 内置前端的执行锁面板（`TaskResourceUnlock.tsx`），不要自己发明：
 *
 * - 只有**异常终态**（failed / canceled / timeout）的任务才允许整组解锁。
 *   正常跑完或还在跑的任务不该走这条路 —— 那时锁本来就该被持有。
 * - 而且必须**确有资源可解**（有执行锁，或有活动的设备占用）。没有资源时点了也没意义。
 * - 例外：没有活动锁、但清理状态是 `requires_attention` 且人工复核关注点未了结时，
 *   走的是「清理交接残留」——那是另一件事，**本次不实现**，但必须能识别出来，
 *   否则界面会把"该清理残留"误说成"没有可解的资源"。
 */

const ABNORMAL_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'failed',
  'canceled',
  'timeout',
])

export type TaskResourceUnlockReadiness =
  | { readonly kind: 'ready'; readonly label: string }
  /** 有交接残留要清理，但本前端没做这条路径。 */
  | { readonly kind: 'cleanup'; readonly label: string; readonly reason: string }
  | { readonly kind: 'blocked'; readonly reason: string }

export interface TaskResourceUnlockInput {
  readonly taskStatus: string | null
  readonly lockCount: number
  readonly activeDeviceTenancyCount: number
  readonly cleanupStatus?: string | null
  readonly manualReviewAttentionResolved?: boolean
}

export function taskResourceUnlockReadiness(
  input: TaskResourceUnlockInput,
): TaskResourceUnlockReadiness {
  const terminal =
    input.taskStatus != null && ABNORMAL_TERMINAL_STATUSES.has(input.taskStatus)
  const hasResources = input.lockCount > 0 || input.activeDeviceTenancyCount > 0
  const cleanupOnly =
    !hasResources &&
    input.cleanupStatus === 'requires_attention' &&
    input.manualReviewAttentionResolved !== true

  if (cleanupOnly) {
    return {
      kind: 'cleanup',
      label: '清理交接残留',
      reason:
        '这个任务没有活动执行锁，但清理状态是「需要处理」且人工复核关注点还没有了结。这条路径本前端未接入，请先在 Uni-Lab OS 控制台处理。',
    }
  }
  if (!terminal) {
    return {
      kind: 'blocked',
      reason: `只有异常终态（失败 / 已取消 / 超时）的任务才能整组解锁；这个任务当前是「${describeStatus(input.taskStatus)}」。`,
    }
  }
  if (!hasResources) {
    return {
      kind: 'blocked',
      reason: '这个任务没有持有执行锁，也没有活动的设备占用，没有可解除的资源。',
    }
  }
  const parts = [
    input.lockCount > 0 ? `${input.lockCount} 把执行锁` : null,
    input.activeDeviceTenancyCount > 0
      ? `${input.activeDeviceTenancyCount} 项设备占用`
      : null,
  ].filter((item): item is string => item !== null)
  return { kind: 'ready', label: `解除任务全部锁（${parts.join('、')}）` }
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  running: '执行中',
  pending: '等待派发',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
  timeout: '超时',
}

function describeStatus(status: string | null): string {
  if (!status) return '未知'
  return STATUS_LABELS[status] ?? status
}

/**
 * 整组解锁命令的请求体。
 *
 * `unlock_resources` **只用于调试场景**：它不在 AGENTS.md 的共享 Runtime 命令白名单内
 * （白名单只有 step / pause / resume / cancel）。这里的 `meta_data.confirmed_physical_safe`
 * 是 OS 的硬性要求（`workflow/service.py` 缺它直接 `invalid_input`），不是可选装饰。
 */
export function buildTaskResourceUnlockCommand(input: {
  readonly idempotencyKey: string
  readonly description: string
}): {
  readonly type: 'unlock_resources'
  readonly idempotencyKey: string
  readonly description: string
  readonly metadata: Readonly<Record<string, unknown>>
} {
  return {
    type: 'unlock_resources',
    idempotencyKey: input.idempotencyKey,
    description: input.description,
    metadata: { source: 'unilabos-frontend', confirmed_physical_safe: true },
  }
}
