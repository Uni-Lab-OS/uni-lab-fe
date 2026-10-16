import type {
  TaskJobSummary,
  TaskRuntimeDetail,
  WorkflowDebugFacts,
  WorkflowExecutionLockFact,
  WorkflowJobStatusCounts,
  WorkflowProgressFact,
  WorkflowJoinFact,
  WorkflowReadyFrontierCandidate,
  WorkflowResourceWaitFact,
} from './model'

/** 将 OS 投影中已经存在的调试事实规范化；缺失字段保持为空，不猜测运行状态。 */
export function deriveWorkflowDebugFacts(
  task: TaskRuntimeDetail,
  jobs: readonly TaskJobSummary[],
): WorkflowDebugFacts {
  const taskRaw = task.raw
  const frontier = readArray(
    taskRaw.ready_frontier ?? asRecord(taskRaw.execution_plan)?.ready_frontier,
  )
    .map(readFrontier)
    .filter((candidate): candidate is WorkflowReadyFrontierCandidate => candidate !== null)
  const joins = readArray(taskRaw.joins ?? asRecord(taskRaw.execution_plan)?.joins)
    .map(readJoin)
    .filter((join): join is WorkflowJoinFact => join !== null)
  const progress = readProgress(taskRaw.progress)
  const resourceWaits = [
    ...readArray(taskRaw.resource_waits).map(readResourceWait),
    ...jobs
      .filter((job) => Object.keys(job.waitReason).length > 0)
      .map(
        (job) =>
          ({
            resourceUuid:
              stringValue(job.waitReason.resource_uuid ?? job.waitReason.resourceUuid) ?? null,
            resourceKind:
              stringValue(job.waitReason.resource_kind ?? job.waitReason.resourceKind) ?? null,
            reason: stringValue(job.waitReason.reason ?? job.waitReason.message) ?? null,
            blocking:
              job.status === 'pending' || job.status === 'dispatched' || job.status === 'running',
            raw: job.waitReason,
          }) satisfies WorkflowResourceWaitFact,
      ),
  ]
  const locks = readArray(taskRaw.execution_locks ?? taskRaw.locks)
    .map(readLock)
    .filter((lock): lock is WorkflowExecutionLockFact => lock !== null)
  const executionUnknown =
    task.status === 'execution_unknown' || jobs.some((job) => job.status === 'execution_unknown')
  const requiresReconciliation =
    task.controlStatus === 'waiting_reconciliation' ||
    task.cleanupStatus === 'requires_attention' ||
    executionUnknown
  return {
    readyFrontier: frontier,
    joins,
    progress,
    jobCounts: countWorkflowJobs(jobs),
    resourceWaits,
    recovery: {
      executionUnknown,
      requiresReconciliation,
      locks,
      raw: asRecord(taskRaw.recovery),
    },
  }
}

/** 将列表投影中的进度也规范化为同一份 Core 事实；OS 未提供时为 null，不按 job 状态估算。 */
export function deriveWorkflowProgress(value: unknown): WorkflowProgressFact | null {
  return readProgress(value)
}

interface CountableJob {
  readonly status: string
  readonly currentAttempt?: boolean
  readonly raw?: Readonly<Record<string, unknown>>
}

/**
 * 按 OS Job 状态如实计数（只算当前 attempt）。取消与跳过分开计；运行中/失败但带
 * uncertainty_reason 的作业计为结果未知，不算运行中或普通失败。
 */
export function countWorkflowJobs(jobs: readonly CountableJob[]): WorkflowJobStatusCounts {
  const counts = {
    total: 0,
    succeeded: 0,
    failed: 0,
    timeout: 0,
    canceled: 0,
    skipped: 0,
    running: 0,
    waiting: 0,
    unknown: 0,
    historicalAttempts: 0,
  }
  for (const job of jobs) {
    if (job.currentAttempt === false) {
      counts.historicalAttempts += 1
      continue
    }
    counts.total += 1
    const uncertain = typeof job.raw?.uncertainty_reason === 'string' && job.raw.uncertainty_reason !== ''
    const status = job.status
    if (status === 'execution_unknown' || (uncertain && (status === 'running' || status === 'failed'))) {
      counts.unknown += 1
    } else if (status === 'succeeded') counts.succeeded += 1
    else if (status === 'failed') counts.failed += 1
    else if (status === 'timeout') counts.timeout += 1
    else if (status === 'canceled' || status === 'cancelled') counts.canceled += 1
    else if (status === 'skipped') counts.skipped += 1
    else if (['running', 'dispatched', 'cancel_requested'].includes(status)) counts.running += 1
    else counts.waiting += 1
  }
  return counts
}

function readFrontier(value: unknown): WorkflowReadyFrontierCandidate | null {
  const raw = asRecord(value)
  const nodeUuid = stringValue(raw.node_uuid ?? raw.workflow_node_uuid)
  if (!nodeUuid) return null
  return {
    nodeUuid,
    jobUuid: stringValue(raw.job_uuid ?? raw.workflow_node_job_uuid) ?? null,
    branchUuid: stringValue(raw.branch_uuid ?? raw.branch_id) ?? null,
    label: stringValue(raw.label ?? raw.name ?? raw.node_name) ?? null,
    selectable: raw.selectable === undefined ? true : raw.selectable === true,
    blockedBy: stringArray(raw.blocked_by),
    waitReason: asRecord(raw.wait_reason),
    raw,
  }
}

function readJoin(value: unknown): WorkflowJoinFact | null {
  const raw = asRecord(value)
  const nodeUuid = stringValue(raw.node_uuid ?? raw.workflow_node_uuid)
  if (!nodeUuid) return null
  const required = stringArray(raw.required_branch_uuids ?? raw.required_branches)
  const satisfied = stringArray(raw.satisfied_branch_uuids ?? raw.satisfied_branches)
  return {
    nodeUuid,
    requiredBranchUuids: required,
    satisfiedBranchUuids: satisfied,
    missingConditions: stringArray(raw.missing_conditions ?? raw.missing),
    ready:
      raw.ready === true || (required.length > 0 && required.every((id) => satisfied.includes(id))),
    raw,
  }
}

function readProgress(value: unknown): WorkflowProgressFact | null {
  const raw = asRecord(value)
  const completed = nonNegative(raw.completed ?? raw.completed_count)
  const total = nonNegative(raw.total ?? raw.total_count)
  if (total !== null) {
    return {
      completed: completed ?? 0,
      total,
      percent:
        numberValue(raw.percent ?? raw.percentage) ??
        (total > 0 ? Math.round(((completed ?? 0) / total) * 100) : 0),
      raw,
    }
  }
  // OS 未提供业务进度：不把“已进入终态的 Job 数”冒充完成度（取消会让它变成 100%）。
  return null
}

function readResourceWait(value: unknown): WorkflowResourceWaitFact {
  const raw = asRecord(value)
  return {
    resourceUuid: stringValue(raw.resource_uuid ?? raw.resourceUuid) ?? null,
    resourceKind: stringValue(raw.resource_kind ?? raw.resourceKind ?? raw.kind) ?? null,
    reason: stringValue(raw.reason ?? raw.message) ?? null,
    blocking: raw.blocking !== false,
    raw,
  }
}

function readLock(value: unknown): WorkflowExecutionLockFact | null {
  const raw = asRecord(value)
  if (Object.keys(raw).length === 0) return null
  const state = stringValue(raw.state ?? raw.status)
  return {
    lockUuid: stringValue(raw.uuid ?? raw.lock_uuid) ?? null,
    jobUuid: stringValue(raw.job_uuid ?? raw.workflow_node_job_uuid) ?? null,
    lockKey: stringValue(raw.lock_key ?? raw.key) ?? null,
    scope: stringValue(raw.scope) ?? null,
    claimUuid: stringValue(raw.claim_uuid ?? raw.claim) ?? null,
    fencingToken: stringValue(raw.fencing_token ?? raw.fence) ?? null,
    state:
      state === 'reserved' || state === 'running' || state === 'released' || state === 'uncertain'
        ? state
        : 'unknown',
    canRelease: typeof raw.can_release === 'boolean' ? raw.can_release : null,
    blockingReasons: stringArray(raw.blocking_reasons ?? raw.blocked_by),
    raw,
  }
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
