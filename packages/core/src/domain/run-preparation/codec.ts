import { RunPreparationError } from './errors'
import type { NodeJobDetail, PreflightCheck, PreflightReport, SubmittedRun } from './model'
import type { RunPreparationRecord } from './api'
import type { RunConfiguration } from './model'

export function decodePreflightReport(
  value: unknown,
  configuration: RunConfiguration,
): PreflightReport {
  const record = unwrapData(asRecord(value, 'preflight'))
  const checks = Array.isArray(record.checks)
    ? record.checks.map((check, index) => {
        const path = `checks[${index}]`
        return decodeCheck(asRecord(check, path), path)
      })
    : []
  const workflowRevision = numberValue(
    record.workflow_revision ?? record.revision,
    'preflight.workflow_revision',
  )
  const checkedAt = stringValue(record.checked_at, 'preflight.checked_at')
  const status = enumValue(
    record.status,
    ['runnable_now', 'temporarily_unavailable', 'invalid'] as const,
    'preflight.status',
  )
  return {
    kind: 'preflight_report',
    source: 'os',
    workflowUuid: stringValue(record.workflow_uuid, 'preflight.workflow_uuid'),
    workflowRevision,
    runMode: configuration.runMode,
    ...(optionalString(record.target_node_uuid) === undefined
      ? {}
      : { targetNodeUuid: optionalString(record.target_node_uuid) }),
    status,
    canRun: record.can_run === true || status === 'runnable_now',
    checkedAt,
    checks,
  }
}

export function decodeSubmittedRun(value: unknown): SubmittedRun {
  const record = unwrapData(asRecord(value, 'submit run'))
  const taskUuid = stringValue(record.task_uuid ?? record.uuid, 'submit run.task_uuid')
  return {
    kind: 'submitted_run',
    source: 'os',
    taskUuid,
    ...(optionalString(record.accepted_at) === undefined
      ? {}
      : { acceptedAt: optionalString(record.accepted_at) }),
    raw: record,
  }
}

export function decodeNodeJobDetail(value: unknown): NodeJobDetail {
  const record = unwrapData(asRecord(value, 'node job detail'))
  return {
    kind: 'node_job_detail',
    source: 'os',
    jobUuid: stringValue(record.uuid ?? record.job_uuid, 'node job.uuid'),
    workflowTaskUuid: stringValue(
      record.workflow_task_uuid ?? record.task_uuid,
      'node job.workflow_task_uuid',
    ),
    workflowNodeUuid: stringValue(record.workflow_node_uuid, 'node job.workflow_node_uuid'),
    executorKind: stringValue(record.executor_kind, 'node job.executor_kind'),
    logicalStatus: stringValue(record.status, 'node job.status'),
    attempt: numberValue(record.attempt, 'node job.attempt'),
    ...(optionalString(record.uncertainty_reason) === undefined
      ? {}
      : { uncertaintyReason: optionalString(record.uncertainty_reason) }),
    raw: record,
  }
}

function decodeCheck(value: RunPreparationRecord, path: string): PreflightCheck {
  return {
    type: stringValue(value.type, `${path}.type`),
    status: enumValue(
      value.status,
      ['passed', 'blocked', 'deferred', 'confirmation_required'] as const,
      `${path}.status`,
    ),
    code: stringValue(value.code, `${path}.code`),
    message: stringValue(value.message, `${path}.message`),
    blocking: value.blocking === true,
    ...(optionalString(value.node_uuid) === undefined
      ? {}
      : { nodeUuid: optionalString(value.node_uuid) }),
    ...(optionalString(value.node_name) === undefined
      ? {}
      : { nodeName: optionalString(value.node_name) }),
    details: asOptionalRecord(value.details) ?? {},
  }
}

function unwrapData(value: RunPreparationRecord): RunPreparationRecord {
  if (value.code !== undefined && value.code !== 0 && value.code !== '0') {
    const error = asOptionalRecord(value.error)
    const errorCode = optionalString(error?.code)
    const message = optionalString(error?.message ?? error?.msg ?? value.message)
    if (errorCode === 'develop_task_conflict') {
      throw new RunPreparationError('DEVELOP_TASK_CONFLICT', formatDevelopTaskConflict(message))
    }
    throw new RunPreparationError(
      'OS_REQUEST_REJECTED',
      message ?? `OS request rejected with code ${String(value.code)}`,
    )
  }
  return asOptionalRecord(value.data) ?? value
}

function formatDevelopTaskConflict(message: string | undefined): string {
  const match = message?.match(/^develop_task_conflict:([^:]+):([^:]+)$/)
  if (!match) return '开发模式已有未结束的任务，请先结束或取消该任务后再提交。'
  const [, taskUuid, status] = match
  const statusLabel =
    status === 'pending'
      ? '等待中'
      : status === 'running'
        ? '执行中'
        : status === 'canceling'
          ? '取消中'
          : status
  return `开发模式已有未结束的任务（${statusLabel}，任务 ID：${taskUuid}），请先结束或取消该任务后再提交。`
}

function asRecord(value: unknown, path: string): RunPreparationRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RunPreparationError('INVALID_RUN_PREPARATION_RESPONSE', `${path} must be an object`)
  }
  return value as RunPreparationRecord
}

function asOptionalRecord(value: unknown): RunPreparationRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RunPreparationRecord)
    : undefined
}

function stringValue(value: unknown, path: string): string {
  const result = optionalString(value)
  if (result === undefined) {
    throw new RunPreparationError('INVALID_RUN_PREPARATION_RESPONSE', `${path} must be a string`)
  }
  return result
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RunPreparationError('INVALID_RUN_PREPARATION_RESPONSE', `${path} must be a number`)
  }
  return value
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] {
  if (typeof value === 'string' && values.includes(value)) return value as Values[number]
  throw new RunPreparationError('INVALID_RUN_PREPARATION_RESPONSE', `${path} is invalid`)
}
