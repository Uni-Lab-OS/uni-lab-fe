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
