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
  readonly event: 'workflow.runtime.changed' | 'device_action_task.changed'
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

export interface WorkflowDebugFacts {
  readonly readyFrontier: readonly WorkflowReadyFrontierCandidate[]
  readonly joins: readonly WorkflowJoinFact[]
  readonly progress: WorkflowProgressFact | null
  readonly resourceWaits: readonly WorkflowResourceWaitFact[]
  readonly recovery: WorkflowRecoveryFact
}
