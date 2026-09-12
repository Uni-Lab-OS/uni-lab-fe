import type { WorkflowIntervention } from './workflowInterventions'

/** 公共人工入库请求的只读快照；计划物料不得冒充已有库存实例。 */
export interface WorkflowLoadingRow {
  key: string
  instrument: { id: string; label: string }
  site: { id: string; label: string }
  material: { label: string; templateId?: string } & (
    | { identity: 'existing'; id: string }
    | { identity: 'planned' }
  )
  quantity: number
  unit: string
  availability: { allowed: boolean; reason?: string }
}

export interface WorkflowLoadingRequest {
  schema_version: 1
  request_uuid: string
  revision: number
  rows: WorkflowLoadingRow[]
}

type LoadingProjection = { kind: 'absent' } | { kind: 'invalid'; message: string }
  | { kind: 'ready'; request: WorkflowLoadingRequest }

/** 严格识别公共 loading 快照；格式不兼容时禁止退回通用确认按钮。 */
export function readWorkflowLoadingRequest(item: WorkflowIntervention): LoadingProjection {
  const value = item.meta_data.loading
  if (value === undefined && !item.options.some(option => option.id === 'confirm_loading')) return { kind: 'absent' }
  const invalid = { kind: 'invalid' as const, message: '入库明细格式不完整或版本不兼容，请重新读取或更新服务。' }
  if (!record(value) || value.schema_version !== 1 || !text(value.request_uuid) ||
    !Number.isInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.rows)) return invalid
  const keys = new Set<string>()
  for (const row of value.rows) {
    if (!record(row) || !text(row.key) || keys.has(row.key) || !reference(row.instrument) || !reference(row.site) ||
      !record(row.material) || !text(row.material.label) ||
      (row.material.templateId !== undefined && !text(row.material.templateId)) ||
      (row.material.identity !== 'existing' && row.material.identity !== 'planned') ||
      (row.material.identity === 'existing' && !text(row.material.id)) ||
      (row.material.identity === 'planned' && row.material.id !== undefined) ||
      typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity <= 0 || !text(row.unit) ||
      !record(row.availability) || typeof row.availability.allowed !== 'boolean' ||
      (row.availability.reason !== undefined && typeof row.availability.reason !== 'string')) return invalid
    keys.add(row.key)
  }
  return { kind: 'ready', request: value as unknown as WorkflowLoadingRequest }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function reference(value: unknown): boolean { return record(value) && text(value.id) && text(value.label) }
