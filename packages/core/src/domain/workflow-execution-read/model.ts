export interface TaskRuntimeDetail {
  readonly kind: 'task_runtime_detail'
  readonly source: 'os' | 'fixture'
  readonly taskUuid: string
  readonly workflowUuid: string | null
  readonly executionKind: string
  readonly status: string
  readonly runMode: string
  readonly controlStatus: string
  readonly cleanupStatus: string
  readonly priority?: string
  readonly description?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly finishedAt?: string
  readonly attentionReason?: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface TaskRuntimePage {
  readonly items: readonly TaskRuntimeDetail[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly hasMore: boolean
  readonly raw: Readonly<Record<string, unknown>>
}

export interface TaskRuntimePresentationJob {
  readonly kind: 'task_runtime_presentation_job'
  readonly source: 'os' | 'fixture'
  readonly jobUuid: string
  readonly workflowNodeUuid: string
  readonly topologicalIndex: number
  readonly executorKind: string
  readonly status: string
  readonly attempt: number
  readonly currentAttempt: boolean
  readonly executionSource: string | null
  readonly startState: string | null
  readonly controlData: Readonly<Record<string, unknown>>
  readonly errorInfo: readonly unknown[]
  readonly waitReason: Readonly<Record<string, unknown>>
  readonly expectedChangeSet: Readonly<Record<string, unknown>>
  readonly finishedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface TaskRuntimePresentation {
  readonly kind: 'task_runtime_presentation'
  readonly source: 'os' | 'fixture'
  readonly taskUuid: string
  readonly workflowUuid: string | null
  readonly executionKind: string
  readonly status: string
  readonly runMode: string
  readonly controlStatus: string
  readonly cleanupStatus: string
  readonly priority: string | null
  readonly description: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly finishedAt: string | null
  readonly attentionReason: string | null
  readonly progress: WorkflowProgressFact | null
  readonly jobCounts: WorkflowJobStatusCounts
  readonly jobs: readonly TaskRuntimePresentationJob[]
  readonly raw: Readonly<Record<string, unknown>>
}

export interface TaskRuntimePresentationPage {
  readonly items: readonly TaskRuntimePresentation[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly raw: Readonly<Record<string, unknown>>
}

/** 摘要视图中的在途 Job（dispatched/running/intervention_required/cancel_requested）。 */
export interface TaskRuntimeSummaryActiveJob {
  readonly jobUuid: string
  readonly workflowNodeUuid: string
  /** OS 从冻结执行计划取的节点名（name，缺失时 action_name）；都没有时为 null。 */
  readonly nodeName: string | null
  readonly executorKind: string
  readonly status: string
  readonly attempt: number
  /** 实际执行者优先，其次执行计划固定绑定；人工确认、物料来源等非设备节点为 null。 */
  readonly deviceId: string | null
  readonly startedAt: string | null
  readonly uncertaintyReason: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * 任务列表摘要（view=summary，summary_version=1）。Task 字段与默认展示视图同名同义；
 * 不含执行计划与逐 Job 数组，Job 计数由 OS 聚合。OS 不提供业务进度，这里也没有进度字段。
 */
export interface TaskRuntimeSummary {
  readonly kind: 'task_runtime_summary'
  readonly source: 'os' | 'fixture'
  readonly taskUuid: string
  readonly workflowUuid: string | null
  readonly executionKind: string
  readonly status: string
  readonly runMode: string
  readonly controlStatus: string
  readonly cleanupStatus: string
  readonly priority: string | null
  readonly description: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly attentionReason: string | null
  /** 由 OS 聚合计数还原，与按逐 Job 数组调用 countWorkflowJobs 的结果一致。 */
  readonly jobCounts: WorkflowJobStatusCounts
  /** 全部 attempt 中最早开始与最晚结束时间。 */
  readonly jobActivity: {
    readonly firstStartedAt: string | null
    readonly lastFinishedAt: string | null
  }
  /** 当前 attempt 的在途 Job，按拓扑顺序；OS 最多列 20 个。 */
  readonly activeJobs: readonly TaskRuntimeSummaryActiveJob[]
  readonly activeJobsTruncated: boolean
  readonly pendingManualConfirmationCount: number
  readonly manualReviewAttentionResolved: boolean
  readonly raw: Readonly<Record<string, unknown>>
}

export interface TaskRuntimeSummaryPage {
  readonly view: 'summary'
  readonly summaryVersion: 1
  readonly items: readonly TaskRuntimeSummary[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly raw: Readonly<Record<string, unknown>>
}

/** 任务列表条目：默认展示投影或摘要投影；共有字段同名同义，用 kind 区分。 */
export type TaskRuntimeListItem = TaskRuntimePresentation | TaskRuntimeSummary

export interface TaskRuntimeListPage {
  readonly items: readonly TaskRuntimeListItem[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly raw: Readonly<Record<string, unknown>>
}

export interface TaskJobSummary {
  readonly kind: 'task_job_summary'
  readonly source: 'os' | 'fixture'
  readonly jobUuid: string
  readonly workflowNodeUuid: string
  readonly topologicalIndex: number
  readonly executorKind: string
  readonly status: string
  readonly attempt: number
  readonly currentAttempt: boolean
  readonly executionSource?: string
  readonly startState?: string
  readonly controlData: Readonly<Record<string, unknown>>
  readonly errorInfo: readonly unknown[]
  readonly waitReason: Readonly<Record<string, unknown>>
  readonly expectedChangeSet: Readonly<Record<string, unknown>>
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface WorkflowNodeJobDetail {
  readonly kind: 'node_job_detail'
  readonly source: 'os' | 'fixture'
  readonly jobUuid: string
  readonly workflowTaskUuid: string
  readonly workflowNodeUuid: string
  readonly materialUuid: string | null
  readonly edgeUuid: string | null
  readonly edgeCommandUuid: string | null
  readonly feedbackSequence: number | null
  readonly topologicalIndex: number | null
  readonly executorKind: string
  readonly executionPolicy: Readonly<Record<string, unknown>>
  readonly executionTimeoutSeconds: number | null
  readonly status: string
  readonly attempt: number
  readonly param: Readonly<Record<string, unknown>>
  readonly feedbackData: Readonly<Record<string, unknown>>
  readonly returnInfo: Readonly<Record<string, unknown>>
  readonly controlData: Readonly<Record<string, unknown>>
  readonly errorInfo: readonly unknown[]
  readonly uncertaintyReason: string | null
  readonly dispatchDeadlineAt: string | null
  readonly executionDeadlineAt: string | null
  readonly cancelCommandUuid: string | null
  readonly cancelAckDeadlineAt: string | null
  readonly cancelCompleteDeadlineAt: string | null
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface NodeJobFeedback {
  readonly kind: 'node_job_feedback'
  readonly source: 'os' | 'fixture'
  readonly feedbackUuid: string
  readonly jobUuid: string
  readonly sequence: number
  readonly feedbackType: string
  readonly data: Readonly<Record<string, unknown>>
  readonly observedAt: string
  readonly receivedAt: string
  readonly publishedAt: string | null
  readonly idempotencyKey: string
  readonly description: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly raw: Readonly<Record<string, unknown>>
}

export interface NodeJobFeedbackPage {
  readonly items: readonly NodeJobFeedback[]
  readonly nextCursor: number
  readonly hasMore: boolean
  readonly raw: Readonly<Record<string, unknown>>
}

/** Task 命令只表达意图；命令回执与 Task/Job 投影分开保存。 */
export type WorkflowTaskCommandType = 'step' | 'pause' | 'resume' | 'cancel'

export interface WorkflowTaskCommandRequest {
  readonly type: WorkflowTaskCommandType
  readonly targetNodeUuid?: string | null
  readonly idempotencyKey: string
  readonly description?: string | null
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type WorkflowTaskCommandLifecycle = 'accepted' | 'applied' | 'rejected' | 'unknown'

export interface WorkflowTaskCommandReceipt {
  readonly kind: 'workflow_task_command_receipt'
  readonly commandUuid: string | null
  readonly workflowTaskUuid: string
  readonly type: WorkflowTaskCommandType
  readonly targetNodeUuid: string | null
  readonly idempotencyKey: string
  readonly accepted: boolean
  readonly lifecycle: WorkflowTaskCommandLifecycle
  readonly statusCode: number | null
  readonly result: Readonly<Record<string, unknown>>
  readonly createdAt: string | null
  readonly updatedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface WorkflowRuntimeInvalidation {
  readonly id: string
  readonly event:
    | 'workflow.runtime.changed'
    | 'device_action_task.changed'
    | 'station.error_handling.changed'
  /** 工站错误处置通知不针对单个任务，此时为空字符串。 */
  readonly workflowTaskUuid: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface WorkflowRuntimeSubscription {
  readonly dispose: () => void
}

export interface WorkflowReadyFrontierCandidate {
  readonly nodeUuid: string
  readonly jobUuid: string | null
  readonly branchUuid: string | null
  readonly label: string | null
  readonly selectable: boolean
  readonly blockedBy: readonly string[]
  readonly waitReason: Readonly<Record<string, unknown>>
  readonly raw: Readonly<Record<string, unknown>>
}

export interface WorkflowJoinFact {
  readonly nodeUuid: string
  readonly requiredBranchUuids: readonly string[]
  readonly satisfiedBranchUuids: readonly string[]
  readonly missingConditions: readonly string[]
  readonly ready: boolean
  readonly raw: Readonly<Record<string, unknown>>
}

export interface WorkflowProgressFact {
  readonly completed: number
  readonly total: number
  readonly percent: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface WorkflowResourceWaitFact {
  readonly resourceUuid: string | null
  readonly resourceKind: string | null
  readonly reason: string | null
  readonly blocking: boolean
  readonly raw: Readonly<Record<string, unknown>>
}

export type WorkflowExecutionLockState =
  | 'reserved'
  | 'running'
  | 'released'
  | 'uncertain'
  | 'unknown'

export interface WorkflowExecutionLockFact {
  readonly lockUuid: string | null
  readonly jobUuid: string | null
  readonly lockKey: string | null
  readonly scope: string | null
  readonly claimUuid: string | null
  readonly fencingToken: string | null
  readonly state: WorkflowExecutionLockState
  readonly canRelease: boolean | null
  readonly blockingReasons: readonly string[]
  readonly raw: Readonly<Record<string, unknown>>
}

export interface WorkflowRecoveryFact {
  readonly executionUnknown: boolean
  readonly requiresReconciliation: boolean
  readonly locks: readonly WorkflowExecutionLockFact[]
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * 节点作业按状态计数。只统计当前 attempt；被重试替代的旧 attempt 计入 historicalAttempts。
 * 这是 OS Job 状态的如实汇总，不是“实验完成度”：canceled/skipped 是未执行，
 * succeeded 也包含控制、数据等非设备节点。
 */
export interface WorkflowJobStatusCounts {
  readonly total: number
  readonly succeeded: number
  readonly failed: number
  readonly timeout: number
  readonly canceled: number
  readonly skipped: number
  readonly running: number
  readonly waiting: number
  /** 结果未知：execution_unknown，或 OS 记录了 uncertainty_reason 的运行中/失败作业。 */
  readonly unknown: number
  readonly historicalAttempts: number
}

export interface WorkflowDebugFacts {
  readonly readyFrontier: readonly WorkflowReadyFrontierCandidate[]
  readonly joins: readonly WorkflowJoinFact[]
  /** 仅当 OS 提供业务进度时存在；前端不按 Job 状态估算百分比。 */
  readonly progress: WorkflowProgressFact | null
  readonly jobCounts: WorkflowJobStatusCounts
  readonly resourceWaits: readonly WorkflowResourceWaitFact[]
  readonly recovery: WorkflowRecoveryFact
}
