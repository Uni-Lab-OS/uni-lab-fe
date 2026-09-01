import type {
  WorkflowAuthoringAggregate,
  WorkflowAuthoringApplyResponse
} from '@unilab/services'

export type WorkflowStartPhase =
  | 'idle'
  | 'saving'
  | 'awaiting_source_review'
  | 'applying'
  | 'reading_applied'
  | 'opening_input'

export interface WorkflowStartContext {
  aggregate: WorkflowAuthoringAggregate | null
  dirty: boolean
  blockedReason: string | null
}

export interface WorkflowStartSnapshot {
  phase: WorkflowStartPhase
  label: '保存并运行' | '应用并运行' | '开始运行'
  disabled: boolean
  disabledReason: string | null
}

export interface WorkflowStartSourceReview {
  before: string
  after: string
  expectedDraftHash: string | null
  expectedWorkflowRevision: number
  reason: 'canvas_save'
  resumeMode: 'code' | 'canvas'
}

export type WorkflowStartCommand =
  | { kind: 'save_draft' }
  | { kind: 'review_source'; review: WorkflowStartSourceReview }
  | {
      kind: 'save_reviewed_source'
      pythonSource: string
      expectedDraftHash: string | null
      expectedWorkflowRevision: number
      resumeMode: 'code' | 'canvas'
      reason: WorkflowStartSourceReview['reason']
    }
  | { kind: 'apply_candidate'; candidateHash: string }
  | { kind: 'read_applied'; expectedRevision: number }
  | {
      kind: 'open_task_input'
      authority: WorkflowAuthoringAggregate
    }
  | { kind: 'blocked'; message: string }

export type WorkflowStartEvent =
  | {
      kind: 'draft_saved'
      aggregate: WorkflowAuthoringAggregate
    }
  | {
      kind: 'candidate_applied'
      response: WorkflowAuthoringApplyResponse
    }
  | {
      kind: 'source_review_required'
      review: WorkflowStartSourceReview
    }
  | { kind: 'source_review_accepted' }
  | {
      kind: 'applied_read'
      aggregate: WorkflowAuthoringAggregate
    }

export interface WorkflowStartFlow {
  snapshot(context: WorkflowStartContext): WorkflowStartSnapshot
  start(context: WorkflowStartContext): WorkflowStartCommand
  resume(event: WorkflowStartEvent): WorkflowStartCommand
  cancel(): void
}

/**
 * 创建工作流（Workflow）运行入口状态机，在小接口后集中保存、应用与运行顺序。
 *
 * @returns 具有状态快照与启动命令接口的工作流运行入口。
 */
export function createWorkflowStartFlow(): WorkflowStartFlow {
  // phase 是浏览器内短暂编排状态，不是工作流任务（WorkflowTask）的权威状态。
  let phase: WorkflowStartPhase = 'idle'
  // expectedRevision 是本次运行输入唯一允许引用的已应用工作流图修订。
  let expectedRevision: number | null = null
  // pendingReview 保存用户正在确认的完整源码差异及其双 CAS 坐标。
  let pendingReview: WorkflowStartSourceReview | null = null

  /**
   * 判断当前权威状态是否必须重新保存并编译工作流源码（Workflow Source）。
   *
   * @param context 当前工作流创作权威与本地修改状态。
   * @returns 需要先保存时为 true。
   */
  const needsDraftSave = (context: WorkflowStartContext): boolean =>
    context.dirty || [
      'candidate_stale',
      'applied_source_stale'
    ].includes(context.aggregate?.state ?? '')

  /**
   * 返回禁止直接运行旧已应用工作流图（Applied Workflow Graph）的创作诊断。
   *
   * @param context 当前工作流创作权威与本地修改状态。
   * @returns 关闭失败原因；允许继续时返回 null。
   */
  const authoringBlockedReason = (
    context: WorkflowStartContext
  ): string | null => {
    if (context.aggregate?.state === 'compiling') {
      return 'OS 正在检查工作流，请等待编译完成'
    }
    if (
      context.aggregate?.state === 'draft_invalid' &&
      !context.dirty
    ) {
      return '工作流草稿存在错误，请修改后再运行'
    }
    return null
  }

  /**
   * 根据已保存且已通过 OS 校验的权威进入候选应用命令。
   *
   * @param authority OS 返回的工作流创作权威聚合。
   * @returns 下一条应用命令；候选不完整时关闭失败。
   */
  const continueFromSaved = (
    authority: WorkflowAuthoringAggregate
  ): WorkflowStartCommand => {
    const candidate = authority.candidate
    if (!candidate) {
      phase = 'idle'
      return {
        kind: 'blocked',
        message: '工作流源码未生成可应用候选，请修复诊断后重试'
      }
    }
    if (!authority.draft) {
      phase = 'idle'
      return {
        kind: 'blocked',
        message: '当前候选缺少可确认的工作流源码，请刷新后重试'
      }
    }
    phase = 'applying'
    return {
      kind: 'apply_candidate',
      candidateHash: candidate.candidate_hash
    }
  }

  return {
    /**
     * 投影动态主入口的可见文案与禁用原因。
     *
     * @param context 当前工作流创作（Workflow Authoring）权威与本地修改状态。
     * @returns 用户可观察的主入口状态快照。
     */
    snapshot(context): WorkflowStartSnapshot {
      const disabledReason = phase !== 'idle'
        ? '正在处理工作流，请稍候'
        : context.blockedReason ?? authoringBlockedReason(context) ?? (
            context.aggregate ? null : '工作流尚未加载完成'
          )
      return {
        phase,
        label: needsDraftSave(context) ||
          context.aggregate?.state === 'draft_invalid'
          ? '保存并运行'
          : context.aggregate?.candidate
            ? '应用并运行'
            : '开始运行',
        disabled: disabledReason !== null,
        disabledReason
      }
    },

    /**
     * 启动一次运行意图；未保存修改只能先产生保存工作流源码命令。
     *
     * @param context 当前工作流创作权威与本地修改状态。
     * @returns 调用方下一步必须执行的公开命令。
     */
    start(context): WorkflowStartCommand {
      const snapshot = this.snapshot(context)
      if (snapshot.disabled) {
        return {
          kind: 'blocked',
          message: snapshot.disabledReason ?? '当前不能开始运行'
        }
      }
      if (needsDraftSave(context)) {
        phase = 'saving'
        return { kind: 'save_draft' }
      }
      const authority = context.aggregate
      if (!authority) {
        return { kind: 'blocked', message: '工作流尚未加载完成' }
      }
      const candidate = authority.candidate
      if (candidate) {
        return continueFromSaved(authority)
      }
      phase = 'reading_applied'
      expectedRevision = authority.workflow_revision
      return {
        kind: 'read_applied',
        expectedRevision: authority.workflow_revision
      }
    },

    /**
     * 使用上一条命令的权威结果推进运行入口，禁止跳过中间门禁。
     *
     * @param event 保存、应用或补读操作返回的公开结果。
     * @returns 下一条必须串行执行的命令。
     */
    resume(event): WorkflowStartCommand {
      if (event.kind === 'draft_saved' && phase === 'saving') {
        return continueFromSaved(event.aggregate)
      }
      if (event.kind === 'source_review_required' && phase === 'saving') {
        pendingReview = event.review
        phase = 'awaiting_source_review'
        return { kind: 'review_source', review: event.review }
      }
      if (
        event.kind === 'source_review_accepted' &&
        phase === 'awaiting_source_review' &&
        pendingReview
      ) {
        const acceptedReview = pendingReview
        pendingReview = null
        phase = 'saving'
        return {
          kind: 'save_reviewed_source',
          pythonSource: acceptedReview.after,
          expectedDraftHash: acceptedReview.expectedDraftHash,
          expectedWorkflowRevision: acceptedReview.expectedWorkflowRevision,
          resumeMode: acceptedReview.resumeMode,
          reason: acceptedReview.reason
        }
      }
      if (event.kind === 'candidate_applied' && phase === 'applying') {
        expectedRevision = event.response.apply_result.workflow_revision
        phase = 'reading_applied'
        return {
          kind: 'read_applied',
          expectedRevision
        }
      }
      if (event.kind === 'applied_read' && phase === 'reading_applied') {
        if (
          expectedRevision === null ||
          event.aggregate.workflow_revision !== expectedRevision
        ) {
          phase = 'idle'
          return {
            kind: 'blocked',
            message: '已应用工作流修订在运行前发生变化，请确认最新内容后重试'
          }
        }
        phase = 'opening_input'
        return {
          kind: 'open_task_input',
          authority: event.aggregate
        }
      }
      return {
        kind: 'blocked',
        message: '工作流运行入口收到了顺序不一致的结果，请重新开始'
      }
    },

    /**
     * 取消本次浏览器编排意图，不撤销已经由 OS 持久化的草稿或已应用修订。
     *
     * @returns 无返回值；状态恢复为空闲，下一次点击重新读取权威事实。
     */
    cancel(): void {
      phase = 'idle'
      expectedRevision = null
      pendingReview = null
    }
  }
}
