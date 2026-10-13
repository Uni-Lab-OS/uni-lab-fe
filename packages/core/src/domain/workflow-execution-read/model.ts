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

/**
 * Task 命令只表达意图；命令回执与 Task/Job 投影分开保存。
 *
 * `unlock_resources` 为任务级整组解锁，**仅供调试场景使用**：它绕过按节点粒度的
 * 处置路径，一次性解除整个 Task 的执行锁与资源占用。
 * **它不在 AGENTS.md 的生产共享 Runtime 命令白名单内**（生产白名单只有
 * step/pause/resume/cancel），不得据此把生产命令面扩大；生产 UI 仍只应下发
 * 这四类命令。
 */
export type WorkflowTaskCommandType = 'step' | 'pause' | 'resume' | 'cancel' | 'unlock_resources'

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
  /** HTTP 是否 durable accepted；不等于命令已生效，真实结果看 lifecycle 与 result。 */
  readonly accepted: boolean
  readonly lifecycle: WorkflowTaskCommandLifecycle
  readonly statusCode: number | null
  readonly result: Readonly<Record<string, unknown>>
  readonly createdAt: string | null
  readonly updatedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * 任务级整组解锁专用端点（`GET /api/v1/workflow-tasks/{task_uuid}/execution-locks`）
 * 返回的单把执行锁。
 *
 * 与任务详情投影里的 `WorkflowExecutionLockFact` **不是同一份数据**：后者取自
 * Task 详情，常常为空，且形状不同（`lockUuid`/`blockingReasons` 等）。
 * 本类型的字段一一对应锁快照端点的 snake_case 线协议字段。
 */
export interface WorkflowTaskExecutionLock {
  readonly uuid: string
  readonly workflowTaskUuid: string
  /** 锁归属的节点 Job；任务级或尚未派发的锁为 null。 */
  readonly workflowNodeJobUuid: string | null
  readonly lockKey: string
  readonly scope: string
  /** 锁定的物料；非物料锁或未绑定时缺省。 */
  readonly materialUuid?: string
  /** 锁定的安装位；非安装位锁或未绑定时缺省。 */
  readonly siteUuid?: string
  /** 原始锁状态字符串；未知取值如实透传，不在 core 折叠成枚举。 */
  readonly state: string
  readonly claimUuid: string | null
  readonly fencingToken: string | null
  readonly jobStatus: string | null
  readonly claimState: string | null
  /** OS 判定这一把锁当前是否可释放；**不是**「整个任务能不能整组解锁」。 */
  readonly canRelease: boolean
  /** OS 给出的不可释放原因，用于向用户说明还差什么才能解锁。 */
  readonly releaseBlockReason?: string
}

/**
 * 任务级整组解锁所需的锁快照。它只是读取投影，**不代表已经解锁**；
 * 解锁必须另发 unlock_resources 命令并以后续 Task/锁投影确认。
 */
export interface WorkflowTaskExecutionLockSnapshot {
  readonly kind: 'workflow_task_execution_lock_snapshot'
  readonly source: 'os'
  readonly workflowTaskUuid: string
  readonly taskStatus: string
  readonly locks: readonly WorkflowTaskExecutionLock[]
  /**
   * 仍持有设备租约的数量。必须和 locks 一起看：整组解锁要解除的是任务持有的
   * 全部资源，设备占用也算可解资源；只看 locks 会把「有占用但没锁」的任务
   * 误判成无可解资源。
   */
  readonly activeDeviceTenancyCount: number
  readonly raw: Readonly<Record<string, unknown>>
}

export interface WorkflowRuntimeInvalidation {
  readonly id: string
  readonly event:
    | 'workflow.runtime.changed'
    | 'device_action_task.changed'
    | 'station.error_handling.changed'
  /** 事件指向的 Task；工站级事件与单个 Task 无关，如实为 null，不编造 UUID。 */
  readonly workflowTaskUuid: string | null
  /** 事件指向的工站；非工站级事件为 null。 */
  readonly stationId: string | null
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

export interface WorkflowDebugFacts {
  readonly readyFrontier: readonly WorkflowReadyFrontierCandidate[]
  readonly joins: readonly WorkflowJoinFact[]
  readonly progress: WorkflowProgressFact | null
  readonly resourceWaits: readonly WorkflowResourceWaitFact[]
  readonly recovery: WorkflowRecoveryFact
}
