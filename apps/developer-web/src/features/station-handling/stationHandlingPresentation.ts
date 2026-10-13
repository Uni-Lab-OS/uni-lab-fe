import type {
  StationErrorFact,
  StationHandlingSnapshot,
  StationHandlingStage,
} from '@unilab-fe/core'

/** 状态只能用 tone 做辅助，文案与图标必须同时表达，不能只靠颜色。 */
export type StationTone = 'idle' | 'ok' | 'attention' | 'error'

/**
 * 找到某个 NodeJob 对应的未处置错误事实。
 *
 * 唯一的匹配依据是 OS 给出的 `source_job_uuid`；任务详情抽屉和节点异常标签页
 * 共用这一个谓词，避免两处各自实现后出现「标签有红点但面板说没有异常」。
 */
export function stationErrorForJob(
  snapshot: StationHandlingSnapshot | undefined,
  jobUuid: string | undefined,
): StationErrorFact | null {
  if (!snapshot || !jobUuid) return null
  return snapshot.errors.find((item) => item.sourceJobUuid === jobUuid) ?? null
}

export interface StationStatusPresentation {
  readonly tone: StationTone
  readonly label: string
  readonly detail: string
  readonly needsAction: boolean
}

const stageLabels: Record<StationHandlingStage, string> = {
  DECISION_REQUIRED: '等待处置决定',
  MANUAL_HANDLING: '人工处置中',
  APPLYING: '已受理，正在应用',
  RESOLVED: '已处理',
}

export function stationStageLabel(stage: StationHandlingStage): string {
  return stageLabels[stage]
}

/**
 * 工站状态文案。读不到快照时必须是错误态且不可写 —— 降级要诚实，
 * 不能让用户按过期状态操作工站。
 */
export function stationStatusPresentation(
  snapshot: StationHandlingSnapshot | undefined,
  readError: Error | undefined,
): StationStatusPresentation {
  if (readError) {
    return {
      tone: 'error',
      label: '错误处置状态暂不可用',
      detail: `无法读取工站处置快照，已暂停全部处置写入。${readError.message}`,
      needsAction: true,
    }
  }
  if (!snapshot) {
    return {
      tone: 'idle',
      label: '正在读取工站处置状态',
      detail: '读取完成后才能提交处置动作。',
      needsAction: false,
    }
  }
  if (snapshot.mode === 'RUNNING' && snapshot.errors.length === 0) {
    return {
      tone: 'ok',
      label: '工站运行中',
      detail: '当前没有等待处置的错误事实，节点正常派发。',
      needsAction: false,
    }
  }

  const parts: string[] = []
  if (snapshot.errors.length) parts.push(`${snapshot.errors.length} 个节点等待处置`)
  const pendingCommands = snapshot.controlCommands.filter((item) => item.needsApply).length
  if (pendingCommands) parts.push(`${pendingCommands} 条操作已受理待应用`)
  if (!parts.length) parts.push('节点错误已处理完，但调度还没有恢复')

  return {
    tone: snapshot.mode === 'PAUSED' && !snapshot.errors.length ? 'attention' : 'error',
    label: snapshot.mode === 'PAUSED' ? '工站调度已暂停' : '仍有错误等待决定',
    detail:
      snapshot.mode === 'PAUSED'
        ? `${parts.join(' · ')}；暂停范围：本工站全部工作流任务。已开始的动作继续运行，不再派发新节点。`
        : `${parts.join(' · ')}；工站已由人工恢复调度，错误任务仍等待各自的决定。`,
    needsAction: true,
  }
}

export function errorFactPresentation(error: StationErrorFact): {
  readonly tone: StationTone
  readonly label: string
} {
  if (error.stage === 'RESOLVED') return { tone: 'ok', label: '已处理' }
  if (error.stage === 'MANUAL_HANDLING') return { tone: 'attention', label: '人工处置中' }
  if (error.stage === 'APPLYING') return { tone: 'idle', label: '已受理，正在应用' }
  return { tone: 'error', label: '等待处置决定' }
}

/**
 * 当前这条错误可以做什么。
 *
 * 同一工站一次只允许一个处置会话（active_session_conflict），所以当活跃会话
 * 属于**另一条**错误时，这里必须挡住，而不是让用户提交后拿到 409。
 */
export type DecisionAvailability =
  | { readonly kind: 'none' }
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'applying' }
  | { readonly kind: 'manual'; readonly reason: string }
  | { readonly kind: 'ready' }

export function decisionAvailability(
  snapshot: StationHandlingSnapshot | undefined,
  error: StationErrorFact | null | undefined,
  readError?: Error,
): DecisionAvailability {
  if (!error) return { kind: 'none' }
  if (readError) {
    return { kind: 'blocked', reason: '读不到工站快照时不能提交处置，请先重新读取状态。' }
  }
  if (!snapshot) {
    return { kind: 'blocked', reason: '正在读取工站处置状态，稍后再试。' }
  }
  if (error.stage === 'APPLYING') return { kind: 'applying' }
  // 已处理的错误（例如本页快照早于别处完成的处置）不再提供任何决定，避免重复提交。
  if (error.stage === 'RESOLVED') return { kind: 'none' }
  if (error.stage === 'MANUAL_HANDLING') {
    return {
      kind: 'manual',
      // 说明「这里能做什么、什么仍需去 OS 控制台」，不再写「尚未接入」那种自相矛盾的话：
      // 面板本身已经提供完成会话，只有手动动作/上下料/占用释放仍在 OS 侧。
      reason:
        '这个节点已进入人工处置会话。手动执行设备动作、上下料登记与逻辑占用释放仍在 Uni-Lab OS 控制台完成；这里可以结束会话，让节点重新可以取消或重试。',
    }
  }
  const session = snapshot.activeSession
  if (session && session.decisionId !== error.decisionId) {
    return {
      kind: 'blocked',
      reason: `另一条错误正在人工处置（${session.decisionId}）。同一工站一次只允许一个处置会话，请先完成那条会话。`,
    }
  }
  // OS 对取消/重试的会话校验用的是**错误事实自带的 session_id**，不是工站的
  // active_session_id：会话收尾窗口里后者可能已被清空。这时前端拿不到会话版本，
  // 提交必然 409 session_version_conflict，所以必须在这里挡住并要求重新读取。
  if (error.sessionId && session?.sessionId !== error.sessionId) {
    return {
      kind: 'blocked',
      reason:
        '这条错误所属的人工处置会话已不在当前活动会话中（可能正在收尾）。请先重新读取工站处置状态，再决定取消或重试。',
    }
  }
  return { kind: 'ready' }
}

/** 恢复调度的可用性：只有无错误、无待应用命令且工站仍暂停时才提供。 */
/**
 * 任务是否已经进入终态。
 *
 * 终态任务不会再派发、也不会再重试出结果，所以它留下的错误事实只剩一件事要做：
 * 关掉它，让工站能恢复调度。判定只认 OS 的任务状态字符串，不在前端猜。
 */
const TERMINAL_TASK_STATUSES = new Set([
  'canceled',
  'cancelled',
  'succeeded',
  'success',
  'completed',
  'finished',
  'failed',
  'timeout',
  'timed_out',
])

export function isTaskTerminal(status: string | null | undefined): boolean {
  return TERMINAL_TASK_STATUSES.has((status ?? '').trim().toLowerCase())
}

/** 终态任务的错误事实只能被关闭：说明为什么没有重试/手动处理。 */
export function terminalTaskErrorCopy(
  status: string | null | undefined,
  errorCountForTask = 1,
): { readonly title: string; readonly detail: string } {
  const label = (status ?? '').trim().toLowerCase().startsWith('cancel')
    ? '已取消'
    : isTaskTerminal(status)
      ? '已结束'
      : '处理中'
  return {
    title: '任务已结束，这条异常还占着工站',
    detail: `这个任务${label}，节点不会再执行，重试和手动处理都不会再派发。关闭这条错误事实${
      errorCountForTask > 1 ? `（连同本任务剩余的 ${errorCountForTask - 1} 条）` : ''
    }后，工站才能恢复调度。`,
  }
}

export function resumeAvailability(
  snapshot: StationHandlingSnapshot | undefined,
  readError?: Error,
): {
  readonly available: boolean
  readonly reason: string
} {
  if (readError) return { available: false, reason: '读不到工站快照时不能恢复调度。' }
  if (!snapshot) return { available: false, reason: '正在读取工站处置状态。' }
  if (snapshot.mode !== 'PAUSED') return { available: false, reason: '工站已经在调度中。' }
  if (snapshot.errors.length > 0) {
    return { available: false, reason: '还有错误等待决定，先把它们处理完再恢复调度。' }
  }
  if (snapshot.controlCommands.some((item) => item.needsApply)) {
    return { available: false, reason: '还有已受理未应用的操作，先应用它们再恢复调度。' }
  }
  return { available: true, reason: '错误已处理完。确认现场后恢复调度，工站才会继续派发节点。' }
}
