import type { WorkflowInputParameter } from '../../domain/workflow-definition/model'

/** 将领域模型中的默认值转换成表单控件可以编辑的值。 */
export function workflowInputDefaults(
  parameters: readonly WorkflowInputParameter[]
): Record<string, unknown> {
  return Object.fromEntries(
    parameters
      .filter((parameter) => parameter.defaultValue !== undefined)
      .map((parameter) => [
        parameter.name,
        formValue(parameter, parameter.defaultValue)
      ])
  )
}

/** 将表单值还原成 run preparation 需要的工作流入参对象。 */
export function normalizeWorkflowInput(
  values: Readonly<Record<string, unknown>>,
  parameters: readonly WorkflowInputParameter[]
): Record<string, unknown> {
  const raw = asRecord(values.workflowInput) ?? values
  const result: Record<string, unknown> = {}
  for (const parameter of parameters) {
    if (!Object.prototype.hasOwnProperty.call(raw, parameter.name)) continue
    const value = raw[parameter.name]
    if (value === undefined || value === null || value === '') continue
    if (parameter.schema.$slot === 'ResourceSlot') {
      result[parameter.name] =
        typeof value === 'string' ? { uuid: value.trim() } : value
      continue
    }
    if (
      typeof value === 'string' &&
      (parameter.schema.type === 'object' || parameter.schema.type === 'array')
    ) {
      try {
        result[parameter.name] = JSON.parse(value) as unknown
      } catch {
        throw new Error('参数“' + parameterLabel(parameter) + '”必须是合法 JSON')
      }
      continue
    }
    result[parameter.name] = value
  }
  return result
}

function parameterLabel(parameter: WorkflowInputParameter): string {
  return parameter.title || parameter.name
}

function formValue(
  parameter: WorkflowInputParameter,
  value: unknown
): unknown {
  if (parameter.schema.$slot === 'ResourceSlot') {
    const record = asRecord(value)
    return record && typeof record.uuid === 'string' ? record.uuid : value
  }
  if (
    (parameter.schema.type === 'object' || parameter.schema.type === 'array') &&
    typeof value === 'object' &&
    value !== null
  ) {
    return JSON.stringify(value, null, 2)
  }
  return value
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
