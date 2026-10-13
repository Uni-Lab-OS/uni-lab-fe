import type { StationHandlingSnapshot, StationManualActionJob } from '@unilab-fe/core'

/**
 * 人工处置里「处理操作」的投影与门禁。
 *
 * 这里刻意把两种来源分开处理，因为它们的权威程度不同：
 *
 * - **设备动作**：`snapshot.manualActions` 是权威事实（OS 的 `manual_actions` 投影，
 *   带会话 id、动作名、设备、结果与不确定原因）。列表直接从它派生。
 * - **物料位置 / 释放占用**：OS 的 `control_commands` 只序列化
 *   `command_uuid / operation / status / needs_apply`，**请求体被剥掉了**，所以服务端
 *   能证明「发生过一次库存更正」，但不能证明「改的是哪个物料、改到哪里」。
 *   内容只能来自本次打开弹窗时记下的条目（按 commandUuid 对齐）。
 *   拿不到内容时如实显示成通用文案，而不是猜一个位置出来。
 */

export type ManualOperationKind = 'device' | 'material' | 'occupancy'

/** 界面上一条处理操作的呈现状态。`attention` 覆盖「结果待核对」这种需要人再看一眼的状态。 */
export type ManualOperationTone = 'ok' | 'busy' | 'attention'

export interface ManualOperationEntry {
  readonly id: string
  readonly kind: ManualOperationKind
  /** 内容文案（例如「S06 机械臂 · 夹爪闭合」）。 */
  readonly label: string
  /** 提交后 OS 返回的命令 id：用来和快照对账，判断到底有没有生效。 */
  readonly commandUuid: string | null
  /** 设备动作的 manual_command_id：登记物料位置时可以关联回这条动作。 */
  readonly manualCommandId: string | null
  readonly createdAt: string
}

export interface ManualOperationView {
  readonly id: string
  readonly kind: ManualOperationKind
  readonly label: string
  readonly tone: ManualOperationTone
  readonly status: string
  readonly detail: string | null
  /** true 表示这条来自服务端投影，不是本次弹窗记下的。 */
  readonly fromServer: boolean
}

const MANUAL_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'succeeded',
  'failed',
  'canceled',
  'timeout',
])

export function manualActionEnded(job: StationManualActionJob): boolean {
  return MANUAL_TERMINAL_STATUSES.has(job.status)
}

/**
 * 与 OS 的 `manualActionNeedsReview` 同义：动作已结束、结果不确定、且还没核对。
 * 在完成现场核对之前 OS 会以 `manual_actions_unresolved` 拒绝后续操作，
 * 所以界面必须把它当真。
 */
export function manualActionNeedsReview(job: StationManualActionJob): boolean {
  return manualActionEnded(job) && Boolean(job.uncertaintyReason) && !job.resultReviewed
}

export interface ManualHandlingBlockers {
  readonly running: readonly StationManualActionJob[]
  readonly unresolved: readonly StationManualActionJob[]
  readonly blocked: boolean
}

/**
 * 门禁只按**会话内的手动动作**算，和 OS 的服务端校验同源：
 * 动作没结束、或结果没核对，都不允许提交。
 */
export function manualHandlingBlockers(
  snapshot: StationHandlingSnapshot | undefined,
  sessionId: string | null,
): ManualHandlingBlockers {
  const jobs = (snapshot?.manualActions ?? []).filter(
    (job) => sessionId != null && job.sessionId === sessionId,
  )
  const running = jobs.filter((job) => !manualActionEnded(job))
  const unresolved = jobs.filter(manualActionNeedsReview)
  return { running, unresolved, blocked: running.length + unresolved.length > 0 }
}

function manualJobView(job: StationManualActionJob): ManualOperationView {
  const tone: ManualOperationTone = !manualActionEnded(job)
    ? 'busy'
    : manualActionNeedsReview(job)
      ? 'attention'
      : job.status === 'succeeded'
        ? 'ok'
        : 'attention'
  const status = !manualActionEnded(job)
    ? '执行中'
    : job.status === 'succeeded'
      ? '成功'
      : job.status === 'canceled'
        ? '已停止'
        : job.status === 'timeout'
          ? '超时'
          : '失败'
  return {
    id: `job:${job.jobUuid}`,
    kind: 'device',
    label: [job.deviceId, job.actionName].filter(Boolean).join(' · ') || '手动设备动作',
    tone,
    status: manualActionNeedsReview(job) ? `${status} · 结果待核对` : status,
    detail: job.resultReviewed ? '结果已人工核对' : (job.uncertaintyReason ?? null),
    fromServer: true,
  }
}

function commandTone(status: string, needsApply: boolean): ManualOperationTone {
  if (status === 'FAILED') return 'attention'
  if (needsApply || status === 'PENDING') return 'busy'
  return 'ok'
}

function commandStatusText(status: string, needsApply: boolean): string {
  if (status === 'FAILED') return '失败'
  if (status === 'PENDING' || needsApply) return '已受理，尚未生效'
  return '已生效'
}

/** 服务端知道发生过、但本次弹窗没留下内容时的通用文案。 */
const KIND_FALLBACK_LABEL: Readonly<Record<ManualOperationKind, string>> = {
  device: '手动设备动作',
  material: '登记了物料位置',
  occupancy: '释放了逻辑占用',
}

/**
 * 把本地条目和服务端投影合成界面要显示的列表。
 *
 * 排序按发生时间：服务端条目没有本地时间，用它在列表里的原始顺序兜底，
 * 不伪造一个时间出来。
 */
export function projectManualOperations(
  snapshot: StationHandlingSnapshot | undefined,
  entries: readonly ManualOperationEntry[],
  sessionId: string | null,
): readonly ManualOperationView[] {
  const jobs = (snapshot?.manualActions ?? []).filter(
    (job) => sessionId != null && job.sessionId === sessionId,
  )
  const jobIds = new Set(jobs.map((job) => job.edgeCommandUuid).filter(Boolean) as string[])
  const commands = new Map(
    (snapshot?.controlCommands ?? []).map((command) => [command.commandUuid, command]),
  )

  const localViews: ManualOperationView[] = []
  for (const entry of entries) {
    // 设备动作一律以服务端投影为准（下面会单独补），本地只留还没对上的那些。
    if (entry.kind === 'device' && entry.commandUuid && jobIds.has(entry.commandUuid)) continue
    const command = entry.commandUuid ? commands.get(entry.commandUuid) : undefined
    localViews.push({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      tone: command ? commandTone(command.status, command.needsApply) : 'busy',
      status: command ? commandStatusText(command.status, command.needsApply) : '已提交，等待确认',
      detail: null,
      fromServer: false,
    })
  }

  return [...localViews, ...jobs.map(manualJobView)]
}

/** 设备动作已经做过、但还没登记物料位置 —— 提交时要显式承担这个不一致。 */
export function needsInventoryRiskAck(views: readonly ManualOperationView[]): boolean {
  if (views.length === 0) return false
  return (
    views.some((view) => view.kind === 'device') && !views.some((view) => view.kind === 'material')
  )
}

export function fallbackOperationLabel(kind: ManualOperationKind): string {
  return KIND_FALLBACK_LABEL[kind]
}
