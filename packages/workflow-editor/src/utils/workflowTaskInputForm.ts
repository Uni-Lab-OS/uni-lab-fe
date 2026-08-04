import type {
  WorkflowAuthoringAggregate,
  WorkflowInputDescriptor,
  WorkflowJsonValue,
  WorkflowTask,
  WorkflowValueSchema
} from '@unilab/services'

export type WorkflowTaskInputFieldState =
  | { kind: 'untouched' }
  | { kind: 'explicit_null' }
  | { kind: 'value'; value: WorkflowJsonValue }

export interface WorkflowTaskInputField {
  descriptor: WorkflowInputDescriptor
  state: WorkflowTaskInputFieldState
}

export interface WorkflowTaskInputFormState {
  workflowUuid: string
  appliedRevision: number
  fields: WorkflowTaskInputField[]
}

export type WorkflowTaskInputSubmissionResult =
  | {
      kind: 'reproject_before_create'
      authority: WorkflowAuthoringAggregate
      form: WorkflowTaskInputFormState
      message: string
    }
  | {
      kind: 'created'
      task: WorkflowTask
      message: string
    }
  | {
      kind: 'reproject_after_create'
      task: WorkflowTask
      authority: WorkflowAuthoringAggregate
      form: WorkflowTaskInputFormState
      message: string
    }

export function createWorkflowTaskInputForm(
  aggregate: WorkflowAuthoringAggregate
): WorkflowTaskInputFormState {
  const parameters = aggregate.applied_graph.workflow.meta_data?.unilab
    ?.input_contract?.parameters ?? []
  return {
    workflowUuid: aggregate.workflow_uuid,
    appliedRevision: aggregate.workflow_revision,
    fields: parameters.map((descriptor) => ({
      descriptor: structuredClone(descriptor),
      state: { kind: 'untouched' }
    }))
  }
}

export function setWorkflowTaskInputField(
  form: WorkflowTaskInputFormState,
  name: string,
  state: WorkflowTaskInputFieldState
): WorkflowTaskInputFormState {
  const index = form.fields.findIndex(({ descriptor }) =>
    descriptor.name === name
  )
  if (index < 0) throw new Error(`工作流入参不存在：${name}`)
  const field = form.fields[index]
  if (!field) throw new Error(`工作流入参不存在：${name}`)
  validateFieldState(field.descriptor, state, false)
  return {
    ...form,
    fields: form.fields.map((current, currentIndex) =>
      currentIndex === index
        ? { ...current, state: cloneFieldState(state) }
        : current
    )
  }
}

export function buildWorkflowTaskInput(
  form: WorkflowTaskInputFormState
): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const { descriptor, state } of form.fields) {
    validateFieldState(descriptor, state, true)
    if (state.kind === 'untouched') {
      if (descriptor.required) {
        throw new Error(`必填的工作流入参尚未填写：${descriptor.name}`)
      }
      continue
    }
    input[descriptor.name] = state.kind === 'explicit_null'
      ? null
      : structuredClone(state.value)
  }
  return input
}

export async function submitWorkflowTaskInput(options: {
  form: WorkflowTaskInputFormState
  readApplied: () => Promise<WorkflowAuthoringAggregate>
  createTask: (input: Record<string, unknown>) => Promise<WorkflowTask>
}): Promise<WorkflowTaskInputSubmissionResult> {
  const input = buildWorkflowTaskInput(options.form)
  const beforeCreate = await options.readApplied()
  const beforeCreateForm = createWorkflowTaskInputForm(beforeCreate)
  if (!isSameAppliedTaskInputContract(options.form, beforeCreateForm)) {
    return {
      kind: 'reproject_before_create',
      authority: beforeCreate,
      form: beforeCreateForm,
      message:
        `Applied Workflow 已从 revision ${options.form.appliedRevision} ` +
        `更新到 ${beforeCreateForm.appliedRevision}；表单已重投影，请重新填写确认`
    }
  }

  const task = await options.createTask(input)
  const snapshotRevision = workflowTaskSnapshotRevision(task)
  if (
    snapshotRevision !== null &&
    snapshotRevision !== beforeCreateForm.appliedRevision
  ) {
    const afterCreate = await options.readApplied()
    const afterCreateForm = createWorkflowTaskInputForm(afterCreate)
    return {
      kind: 'reproject_after_create',
      task,
      authority: afterCreate,
      form: afterCreateForm,
      message:
        `任务已创建，使用快照版本 ${snapshotRevision}；` +
        `最新已应用版本 ${afterCreateForm.appliedRevision}，` +
        '表单已重新投影，如需再次运行请重新填写确认'
    }
  }

  return {
    kind: 'created',
    task,
    message:
      `任务已按已应用版本 ${beforeCreateForm.appliedRevision} 创建；` +
      '输入默认值与规范化结果以 OS 任务投影为准'
  }
}

export function isNullableWorkflowInputSchema(
  schema: WorkflowValueSchema
): boolean {
  return 'anyOf' in schema
}

export function containsResourceSlotInput(
  schema: WorkflowValueSchema
): boolean {
  if ('anyOf' in schema) return containsResourceSlotInput(schema.anyOf[0])
  if ('$slot' in schema) return true
  return schema.type === 'array' && containsResourceSlotInput(schema.items)
}

function validateFieldState(
  descriptor: WorkflowInputDescriptor,
  state: WorkflowTaskInputFieldState,
  enforceConstraints: boolean
): void {
  if (state.kind === 'untouched') return
  if (state.kind === 'explicit_null') {
    if (!isNullableWorkflowInputSchema(descriptor.schema)) {
      throw new Error(`${descriptor.name} 不是允许为空的工作流入参`)
    }
    return
  }
  requireSchemaValue(
    descriptor.schema,
    state.value,
    descriptor.name,
    enforceConstraints
  )
}

function requireSchemaValue(
  schema: WorkflowValueSchema,
  value: WorkflowJsonValue,
  path: string,
  enforceConstraints: boolean
): void {
  if ('anyOf' in schema) {
    if (value === null) {
      throw new Error(`${path} 的 null 必须使用“显式空值”状态`)
    }
    requireSchemaValue(schema.anyOf[0], value, path, enforceConstraints)
    return
  }
  if ('$slot' in schema) {
    requireClosedResourceSlot(value, path)
    return
  }
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') typeError(path, 'string')
      if (
        enforceConstraints &&
        schema.enum &&
        !schema.enum.includes(value as string)
      ) {
        throw new Error(`${path} 不在文本可选值中`)
      }
      if (
        enforceConstraints &&
        schema.minLength !== undefined &&
        (value as string).length < schema.minLength
      ) throw new Error(`${path} 少于最短长度`)
      if (
        enforceConstraints &&
        schema.maxLength !== undefined &&
        (value as string).length > schema.maxLength
      ) throw new Error(`${path} 超过最长长度`)
      return
    case 'integer':
    case 'number': {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (schema.type === 'integer' && !Number.isInteger(value))
      ) typeError(path, schema.type)
      const numberValue = value as number
      if (
        enforceConstraints &&
        schema.enum &&
        !schema.enum.includes(numberValue)
      ) {
        throw new Error(`${path} 不在 ${schema.type} 类型的可选值中`)
      }
      if (
        enforceConstraints &&
        schema.minimum !== undefined &&
        numberValue < schema.minimum
      ) {
        throw new Error(`${path} 小于最小值`)
      }
      if (
        enforceConstraints &&
        schema.maximum !== undefined &&
        numberValue > schema.maximum
      ) {
        throw new Error(`${path} 大于最大值`)
      }
      return
    }
    case 'boolean':
      if (typeof value !== 'boolean') typeError(path, 'boolean')
      if (
        enforceConstraints &&
        schema.enum &&
        !schema.enum.includes(value as boolean)
      ) {
        throw new Error(`${path} 不在布尔可选值中`)
      }
      return
    case 'object':
      if (!isJsonObject(value)) typeError(path, 'object')
      requireJsonValue(value, path)
      return
    case 'array':
      if (!Array.isArray(value)) typeError(path, 'array')
      if (
        enforceConstraints &&
        schema.minItems !== undefined &&
        value.length < schema.minItems
      ) {
        throw new Error(`${path} 少于最少项目数`)
      }
      if (
        enforceConstraints &&
        schema.maxItems !== undefined &&
        value.length > schema.maxItems
      ) {
        throw new Error(`${path} 超过最多项目数`)
      }
      value.forEach((item, index) =>
        requireSchemaValue(
          schema.items,
          item,
          `${path}/${index}`,
          enforceConstraints
        )
      )
  }
}

function requireClosedResourceSlot(value: unknown, path: string): void {
  if (!isJsonObject(value)) {
    throw new Error(`${path} 资源位必须是仅含 {uuid} 的对象`)
  }
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'uuid') {
    throw new Error(`${path} 资源位只允许 uuid 字段`)
  }
  if (
    typeof value.uuid !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value.uuid)
  ) {
    throw new Error(`${path} 资源位 uuid 无效`)
  }
}

function isSameAppliedTaskInputContract(
  left: WorkflowTaskInputFormState,
  right: WorkflowTaskInputFormState
): boolean {
  return left.workflowUuid === right.workflowUuid &&
    left.appliedRevision === right.appliedRevision &&
    JSON.stringify(left.fields.map(({ descriptor }) => descriptor)) ===
      JSON.stringify(right.fields.map(({ descriptor }) => descriptor))
}

function workflowTaskSnapshotRevision(task: WorkflowTask): number | null {
  const workflow = task.workflow_snapshot.workflow
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return null
  }
  const revision = (workflow as Record<string, unknown>).revision
  return typeof revision === 'number' && Number.isInteger(revision)
    ? revision
    : null
}

function requireJsonValue(value: unknown, path: string): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} 不是有效的 JSON 数值`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => requireJsonValue(item, `${path}/${index}`))
    return
  }
  if (isJsonObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      requireJsonValue(item, `${path}/${key}`)
    }
    return
  }
  throw new Error(`${path} 不是有效的 JSON 值`)
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function typeError(path: string, expected: string): never {
  throw new Error(`${path} 类型错误：必须是 ${expected}`)
}

function cloneFieldState(
  state: WorkflowTaskInputFieldState
): WorkflowTaskInputFieldState {
  return state.kind === 'value'
    ? { kind: 'value', value: structuredClone(state.value) }
    : { ...state }
}
