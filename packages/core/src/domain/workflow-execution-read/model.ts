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

