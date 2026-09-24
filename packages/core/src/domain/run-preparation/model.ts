export interface RunConfiguration {
  readonly runMode: 'normal' | 'step' | 'single_node'
  readonly targetNodeUuid?: string
  readonly priority?: 'normal' | 'high'
  readonly description?: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly input: Readonly<Record<string, unknown>>
}

export interface BindingDraft {
  readonly source: 'user' | 'fixture'
  readonly inventoryBindings: readonly Readonly<Record<string, unknown>>[]
  readonly selectedResources: Readonly<Record<string, string>>
}

export type PreflightReportStatus = 'runnable_now' | 'temporarily_unavailable' | 'invalid'
export type PreflightCheckStatus = 'passed' | 'blocked' | 'deferred' | 'confirmation_required'

export interface PreflightCheck {
  readonly type: string
  readonly status: PreflightCheckStatus
  readonly code: string
  readonly message: string
  readonly blocking: boolean
  readonly nodeUuid?: string
  readonly nodeName?: string
  readonly details: Readonly<Record<string, unknown>>
}

export interface PreflightReport {
  readonly kind: 'preflight_report'
  readonly source: 'os' | 'fixture'
  readonly workflowUuid: string
  readonly workflowRevision: number
  readonly runMode: RunConfiguration['runMode']
  readonly targetNodeUuid?: string
  readonly status: PreflightReportStatus
  readonly canRun: boolean
  readonly checkedAt: string
  readonly checks: readonly PreflightCheck[]
}

export interface SubmittedRun {
  readonly kind: 'submitted_run'
  readonly source: 'os' | 'fixture'
  readonly taskUuid: string
  readonly acceptedAt?: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface NodeJobDetail {
  readonly kind: 'node_job_detail'
  readonly source: 'os' | 'fixture'
  readonly jobUuid: string
  readonly workflowTaskUuid: string
  readonly workflowNodeUuid: string
  readonly executorKind: string
  readonly logicalStatus: string
  readonly attempt: number
  readonly uncertaintyReason?: string
  readonly raw: Readonly<Record<string, unknown>>
}
