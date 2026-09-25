import type {
  ActionDefinitionDetailResponse,
  ActionDefinitionListResponse,
  DeviceActionRecord
} from './api'
import { DeviceActionError } from './errors'
import type {
  ActionDefinition,
  ActionDefinitionSummary,
  ActionEditorControl,
  ActionHandle,
  ActionResourceContract,
  ActionResourceParameter,
  ActionResourceRole,
  DeviceActionRunAccepted,
  DeviceExecutionOccupancy,
  DeviceSummary
} from './model'

export function decodeDeviceList(value: unknown): readonly DeviceSummary[] {
  const payload = unwrapEnvelope(value)
  const root = asOptionalRecord(payload)
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.items)
      ? root.items
      : Array.isArray(root?.devices)
        ? root.devices
        : Array.isArray(root?.data)
          ? root.data
          : []
  try {
    return items.map((item, index) => decodeDevice(asRecord(item, `devices[${index}]`)))
  } catch (error) {
    if (error instanceof DeviceActionError && error.code === 'INVALID_ACTION_DEFINITION') {
      throw new DeviceActionError('INVALID_DEVICE_CATALOG', error.message)
    }
    throw error
  }
}

export function decodeActionRunAccepted(value: unknown): DeviceActionRunAccepted {
  try {
    const payload = unwrapEnvelope(value)
    const root = asRecord(payload, 'device action run')
    const task = asRecord(root.task, 'device action run.task')
    const job = asRecord(root.job, 'device action run.job')
    return {
      kind: 'device_action_run_accepted',
      source: 'os',
      created: booleanValue(root.created, 'device action run.created'),
      taskUuid: requiredString(task.uuid ?? task.task_uuid, 'device action run.task.uuid'),
      jobUuid: requiredString(job.uuid ?? job.job_uuid, 'device action run.job.uuid'),
      raw: root
    }
  } catch (error) {
    if (error instanceof DeviceActionError && error.code === 'INVALID_ACTION_DEFINITION') {
      throw new DeviceActionError('INVALID_ACTION_RUN_RESPONSE', error.message)
    }
    throw error
  }
}

export function decodeActionDefinitionList(
  value: unknown
): readonly ActionDefinitionSummary[] {
  const payload = unwrapEnvelope(value)
  const root = asRecord(payload, 'action definition list') as ActionDefinitionListResponse
  const items = Array.isArray(root.items)
    ? root.items
    : Array.isArray(root.data)
      ? root.data
      : []
  return items.map((item, index) => decodeSummary(asRecord(item, `items[${index}]`)))
}

export function decodeActionDefinition(
  value: ActionDefinitionDetailResponse
): ActionDefinition {
  const payload = unwrapEnvelope(value)
  const root = asRecord(payload, 'action definition') as ActionDefinitionDetailResponse
  const template = asOptionalRecord(root.template) ?? root
  const summary = decodeSummary(template)
  const handles = Array.isArray(root.handles)
    ? root.handles.map((handle, index) => decodeHandle(asRecord(handle, `handles[${index}]`)))
    : []
  return {
    ...summary,
    kind: 'action_definition',
    actionClass: nullableString(template.class, 'action.class'),
    schema: asRecord(template.schema, 'action.schema'),
    goal: asRecord(template.goal, 'action.goal'),
    goalDefault: asRecord(template.goal_default, 'action.goal_default'),
    handles,
    resourceContract: decodeResourceContract(template)
  }
}

function decodeSummary(value: DeviceActionRecord): ActionDefinitionSummary {
  const resource = asOptionalRecord(value.resource_template)
  return {
    kind: 'action_definition_summary',
    source: 'os',
    actionUuid: requiredString(value.uuid, 'action.uuid'),
    name: requiredString(value.name, 'action.name'),
    displayName: requiredString(value.display_name, 'action.display_name'),
    actionType: requiredString(value.type, 'action.type'),
    nodeType: requiredString(value.node_type, 'action.node_type'),
    resourceTemplateUuid: requiredString(
      value.resource_template_uuid ?? resource?.uuid,
      'action.resource_template_uuid'
    ),
    raw: value
  }
}

function decodeDevice(value: DeviceActionRecord): DeviceSummary {
  const binding = asRecord(value.binding, 'device.binding')
  const material = asRecord(value.material, 'device.material')
  const deviceUuid = requiredString(material.uuid, 'device.material.uuid')
  const deviceKey = requiredString(binding.local_id, 'device.binding.local_id')
  const namespace = requiredString(binding.edge_uuid, 'device.binding.edge_uuid')
  const resourceTemplateUuid = requiredString(
    material.resource_template_uuid ?? value.resource_template_uuid,
    'device.material.resource_template_uuid'
  )
  const busyActions: readonly unknown[] = value.actions === undefined
    ? []
    : Array.isArray(value.actions)
      ? value.actions
      : invalid('device.actions must be an array')
  return {
    kind: 'device_summary',
    source: 'os',
    deviceUuid,
    materialUuid: deviceUuid,
    resourceTemplateUuid,
    deviceKey,
    namespace,
    label: optionalString(material.name) ?? optionalString(binding.name) ?? deviceKey,
    online: optionalBoolean(value.online, 'device.online'),
    edgeStatus: nullableString(value.edge_status ?? value.edgeStatus, 'device.edge_status'),
    dispatchable: optionalBoolean(
      value.dispatchable ?? value.can_dispatch ?? value.canDispatch,
      'device.dispatchable'
    ),
    dispatchBlockReason: nullableString(
      binding.dispatch_block_reason ?? binding.dispatchBlockReason ??
        value.dispatch_block_reason ?? value.dispatchBlockReason,
      'device.dispatch_block_reason'
    ),
    executionOccupancies: decodeOccupancies(
      value.execution_occupancies ?? value.executionOccupancies
    ),
    actions: busyActions.map((action, index) =>
      decodeDeviceAction(asRecord(action, `device.actions[${index}]`), deviceUuid)
    ),
    raw: value
  }
}

function decodeDeviceAction(
  value: DeviceActionRecord,
  deviceUuid: string
): DeviceSummary['actions'][number] {
  const actionName = requiredString(value.name, 'device.actions[].name')
  const actionType = requiredString(value.type, 'device.actions[].type')
  const busy = value.is_busy ?? value.isBusy ?? value.busy
  return {
    actionName,
    actionRef: optionalString(value.action_ref ?? value.actionRef ?? value.ref) ??
      `${deviceUuid}.${actionName}`,
    label: optionalString(value.label ?? value.display_name ?? value.displayName) ?? actionName,
    actionType,
    actionDefinitionUuid: nullableString(
      value.action_definition_uuid ?? value.actionDefinitionUuid ?? value.workflow_node_template_uuid,
      'device.actions[].action_definition_uuid'
    ),
    isBusy: busy === undefined ? null : booleanValue(busy, 'device.actions[].busy'),
    busyStatusKnown: busy !== undefined,
    currentJobUuid: nullableString(
      value.current_job_uuid ?? value.current_job_id ?? value.currentJobUuid ?? value.currentJobId,
      'device.actions[].current_job_uuid'
    ),
    raw: value
  }
}

function decodeOccupancies(value: unknown): readonly DeviceExecutionOccupancy[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) throw invalid('device.execution_occupancies must be an array')
  return value.map((item, index) => {
    const raw = asRecord(item, `device.execution_occupancies[${index}]`)
    return {
      leaseUuid: nullableString(raw.lease_uuid ?? raw.leaseUuid, `device.execution_occupancies[${index}].lease_uuid`),
      workflowTaskUuid: nullableString(
        raw.workflow_task_uuid ?? raw.workflowTaskUuid,
        `device.execution_occupancies[${index}].workflow_task_uuid`
      ),
      workflowNodeJobUuid: requiredString(
        raw.workflow_node_job_uuid ?? raw.workflowNodeJobUuid,
        `device.execution_occupancies[${index}].workflow_node_job_uuid`
      ),
      state: requiredString(raw.state, `device.execution_occupancies[${index}].state`),
      actionName: nullableString(raw.action_name ?? raw.actionName, `device.execution_occupancies[${index}].action_name`),
      acquiredAt: nullableString(raw.acquired_at ?? raw.acquiredAt, `device.execution_occupancies[${index}].acquired_at`),
      raw
    }
  })
}

function decodeHandle(value: DeviceActionRecord): ActionHandle {
  return {
    uuid: requiredString(value.uuid, 'handle.uuid'),
    workflowNodeTemplateUuid: requiredString(
      value.workflow_node_template_uuid,
      'handle.workflow_node_template_uuid'
    ),
    handleKey: requiredString(value.handle_key, 'handle.handle_key'),
    ioType: enumValue(value.io_type, ['source', 'target'], 'handle.io_type'),
    displayName: requiredString(value.display_name, 'handle.display_name'),
    valueType: requiredString(value.type ?? value.value_type, 'handle.type'),
    required: booleanValue(value.required, 'handle.required'),
    dataSource: nullableString(value.data_source, 'handle.data_source'),
    dataKey: nullableString(value.data_key, 'handle.data_key'),
    valueSchema: asRecord(value.value_schema, 'handle.value_schema'),
    editorControl: enumValue(
      value.editor_control,
      ['material_port', 'site_selector', 'variable_selector'],
      'handle.editor_control'
    ),
    allowedResourceTemplateUuids: nullableStringArray(
      value.allowed_resource_template_uuids,
      'handle.allowed_resource_template_uuids'
    ),
    implicitPassthrough: booleanValue(
      value.implicit_passthrough,
      'handle.implicit_passthrough'
    ),
    structuralRole: nullableEnum(value.structural_role, ['ready'], 'handle.structural_role')
  }
}

function decodeResourceContract(
  template: DeviceActionRecord
): ActionResourceContract | null {
  const metadata = asOptionalRecord(template.meta_data)
  const unilab = asOptionalRecord(metadata?.unilab)
  const raw = asOptionalRecord(unilab?.resource_contract)
    ?? asOptionalRecord(unilab?.action_resource_contract)
  if (!raw) return null

  const resourceParams = Array.isArray(raw.resource_params)
    ? raw.resource_params.map((item, index) => decodeResourceParameter(
        asRecord(item, `resource_contract.resource_params[${index}]`),
        index
      ))
    : []
  return {
    version: raw.version === undefined ? 1 : positiveInteger(raw.version, 'resource_contract.version'),
    resourceParams,
    requiredDeviceParams: stringArray(
      raw.required_device_params,
      'resource_contract.required_device_params'
    ),
    ...(optionalRecordField(raw.transfer, 'resource_contract.transfer')),
    ...(optionalRecordField(raw.operate_in_place, 'resource_contract.operate_in_place', 'operateInPlace')),
    ...(optionalRecordField(raw.device_tenancy, 'resource_contract.device_tenancy', 'deviceTenancy')),
    ...(optionalRecordField(raw.aliquot, 'resource_contract.aliquot')),
    ...(raw.order_sensitive === undefined
      ? {}
      : { orderSensitive: booleanValue(raw.order_sensitive, 'resource_contract.order_sensitive') }),
    raw
  }
}

function decodeResourceParameter(
  value: DeviceActionRecord,
  index: number
): ActionResourceParameter {
  return {
    param: requiredString(value.param, `resource_contract.resource_params[${index}].param`),
    role: enumValue(
      value.role,
      ['device', 'tool', 'motion', 'site', 'material'],
      `resource_contract.resource_params[${index}].role`
    )
  }
}

function unwrapEnvelope(value: unknown): unknown {
  const record = asOptionalRecord(value)
  if (!record || (!('data' in record) && record.code === undefined && record.error === undefined)) {
    return value
  }
  if (record.code !== undefined && record.code !== 0 && record.code !== '0') {
    const error = asOptionalRecord(record.error)
    const message = optionalString(error?.message ?? error?.msg ?? record.message)
      ?? `OS request rejected with code ${String(record.code)}`
    throw new DeviceActionError('OS_REQUEST_REJECTED', message)
  }
  return record.data
}

function asRecord(value: unknown, path: string): DeviceActionRecord {
  const record = asOptionalRecord(value)
  if (!record) throw invalid(`${path} must be an object`)
  return record
}

function asOptionalRecord(value: unknown): DeviceActionRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as DeviceActionRecord
    : undefined
}

function requiredString(value: unknown, path: string): string {
  const result = optionalString(value)
  if (result === undefined) throw invalid(`${path} must be a string`)
  return result
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null
  return requiredString(value, path)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalid(`${path} must be a positive integer`)
  }
  return value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw invalid(`${path} must be a boolean`)
  return value
}

function optionalBoolean(value: unknown, path: string): boolean | null {
  if (value === undefined || value === null) return null
  return booleanValue(value, path)
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw invalid(`${path} must be an array of strings`)
  }
  return value
}

function nullableStringArray(
  value: unknown,
  path: string
): readonly string[] | null {
  if (value === null || value === undefined) return null
  return stringArray(value, path)
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string
): Values[number] {
  if (typeof value === 'string' && values.includes(value)) return value as Values[number]
  throw invalid(`${path} is invalid`)
}

function nullableEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string
): Values[number] | null {
  if (value === null || value === undefined) return null
  return enumValue(value, values, path)
}

function optionalRecordField(
  value: unknown,
  path: string,
  outputKey?: string
): Record<string, unknown> {
  if (value === undefined) return {}
  return { [outputKey ?? camelCase(path.split('.').at(-1) ?? '')]: asRecord(value, path) }
}

function camelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function invalid(message: string): never {
  throw new DeviceActionError('INVALID_ACTION_DEFINITION', message)
}
