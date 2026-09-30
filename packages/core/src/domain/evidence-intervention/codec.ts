import type { EvidenceInterventionRecord, InterventionListResponse } from './api'
import { EvidenceInterventionError } from './errors'
import type {
  WorkflowIntervention,
  WorkflowInterventionDeliveryStatus,
  WorkflowInterventionOption,
  WorkflowInterventionStatus,
} from './model'

export function decodeInterventionList(value: unknown): readonly WorkflowIntervention[] {
  const payload = unwrapEnvelope(value)
  const items = Array.isArray(payload)
    ? payload
    : (asRecord(payload, 'intervention list') as InterventionListResponse).items
  if (!Array.isArray(items)) invalid('intervention list.items must be an array')
  return items.map((item, index) => decodeIntervention(asRecord(item, `interventions[${index}]`)))
}

export function decodeIntervention(value: unknown): WorkflowIntervention {
  const raw = asRecord(unwrapEnvelope(value), 'intervention')
  const options = decodeOptions(raw.options)
  return {
    kind: 'workflow_intervention',
    source: 'os',
    interventionUuid: requiredString(raw.uuid, 'intervention.uuid'),
    workflowTaskUuid: requiredString(raw.workflow_task_uuid, 'intervention.workflow_task_uuid'),
    workflowNodeJobUuid: requiredString(
      raw.workflow_node_job_uuid,
      'intervention.workflow_node_job_uuid',
    ),
    edgeCommandUuid: nullableString(raw.edge_command_uuid, 'intervention.edge_command_uuid'),
    revision: positiveInteger(raw.revision, 'intervention.revision'),
    status: interventionStatus(raw.status, 'intervention.status'),
    options,
    resumeControlStatus: requiredString(
      raw.resume_control_status,
      'intervention.resume_control_status',
    ),
    selectedOptionId: nullableString(raw.selected_option_id, 'intervention.selected_option_id'),
    selectedOption: optionalRecord(raw.selected_option, 'intervention.selected_option'),
    deliveryStatus: deliveryStatus(raw.delivery_status, 'intervention.delivery_status'),
    description: nullableString(raw.description, 'intervention.description'),
    metadata: optionalRecord(raw.meta_data, 'intervention.meta_data'),
    openedAt: requiredString(raw.opened_at, 'intervention.opened_at'),
    createdAt: requiredString(raw.create_time, 'intervention.create_time'),
    updatedAt: requiredString(raw.update_time, 'intervention.update_time'),
    decidedAt: nullableString(raw.decided_at, 'intervention.decided_at'),
    deliveredAt: nullableString(raw.delivered_at, 'intervention.delivered_at'),
    raw,
  }
}

function decodeOptions(value: unknown): readonly WorkflowInterventionOption[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    invalid('intervention.options must contain 1-100 items')
  }
  const ids = new Set<string>()
  return value.map((item, index) => {
    const raw = asRecord(item, `intervention.options[${index}]`)
    const id = requiredString(raw.id ?? raw.action, `intervention.options[${index}].id`)
    if (ids.has(id)) invalid(`duplicate intervention option id: ${id}`)
    ids.add(id)
    return { id, raw }
  })
}

function unwrapEnvelope(value: unknown): unknown {
  const root = asOptionalRecord(value)
  if (!root || (!('data' in root) && root.code === undefined && root.error === undefined))
    return value
  if (root.code !== undefined && root.code !== 0 && root.code !== '0') {
    throw new EvidenceInterventionError(
      'OS_REQUEST_REJECTED',
      optionalString(
        asOptionalRecord(root.error)?.message ?? asOptionalRecord(root.error)?.msg ?? root.message,
      ) ?? `OS request rejected with code ${String(root.code)}`,
    )
  }
  return root.data
}

function asRecord(value: unknown, path: string): EvidenceInterventionRecord {
  const record = asOptionalRecord(value)
  if (!record) invalid(`${path} must be an object`)
  return record
}

function asOptionalRecord(value: unknown): EvidenceInterventionRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as EvidenceInterventionRecord)
    : undefined
}

function optionalRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (value === undefined || value === null) return {}
  return asRecord(value, path)
}

function requiredString(value: unknown, path: string): string {
  const result = optionalString(value)
  if (result === undefined) invalid(`${path} must be a non-empty string`)
  return result
}

function nullableString(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null
  return requiredString(value, path)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid(`${path} must be a positive safe integer`)
  }
  return value
}

function interventionStatus(value: unknown, path: string): WorkflowInterventionStatus {
  if (value === 'open' || value === 'selected' || value === 'superseded') return value
  invalid(`${path} is not a supported intervention status`)
}

function deliveryStatus(value: unknown, path: string): WorkflowInterventionDeliveryStatus {
  if (value === 'none' || value === 'pending' || value === 'accepted' || value === 'unknown')
    return value
  invalid(`${path} is not a supported delivery status`)
}

function invalid(message: string): never {
  throw new EvidenceInterventionError('INVALID_INTERVENTION_RESPONSE', message)
}
