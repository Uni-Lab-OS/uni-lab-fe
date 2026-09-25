import type {
  TaskJobSummary,
  TaskRuntimeDetail
} from '../workflow-execution-read/model'

export type ActionEditorControl =
  | 'material_port'
  | 'site_selector'
  | 'variable_selector'

export type ActionResourceRole =
  | 'device'
  | 'tool'
  | 'motion'
  | 'site'
  | 'material'

export interface ActionHandle {
  readonly uuid: string
  readonly workflowNodeTemplateUuid: string
  readonly handleKey: string
  readonly ioType: 'source' | 'target'
  readonly displayName: string
  readonly valueType: string
  readonly required: boolean
  readonly dataSource: string | null
  readonly dataKey: string | null
  readonly valueSchema: Readonly<Record<string, unknown>>
  readonly editorControl: ActionEditorControl
  readonly allowedResourceTemplateUuids: readonly string[] | null
  readonly implicitPassthrough: boolean
  readonly structuralRole: 'ready' | null
}

export interface ActionResourceParameter {
  readonly param: string
  readonly role: ActionResourceRole
}

export interface ActionResourceContract {
  readonly version: number
  readonly resourceParams: readonly ActionResourceParameter[]
  readonly requiredDeviceParams: readonly string[]
  readonly transfer?: Readonly<Record<string, unknown>>
  readonly operateInPlace?: Readonly<Record<string, unknown>>
  readonly deviceTenancy?: Readonly<Record<string, unknown>>
  readonly aliquot?: Readonly<Record<string, unknown>>
  readonly orderSensitive?: boolean
  readonly raw: Readonly<Record<string, unknown>>
}

interface ActionDefinitionIdentity {
  readonly source: 'os' | 'fixture'
  readonly actionUuid: string
  readonly name: string
  readonly displayName: string
  readonly actionType: string
  readonly nodeType: string
  readonly resourceTemplateUuid: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface ActionDefinitionSummary extends ActionDefinitionIdentity {
  readonly kind: 'action_definition_summary'
}

export interface ActionDefinition extends ActionDefinitionIdentity {
  readonly kind: 'action_definition'
  readonly actionClass: string | null
  readonly schema: Readonly<Record<string, unknown>>
  readonly goal: Readonly<Record<string, unknown>>
  readonly goalDefault: Readonly<Record<string, unknown>>
  readonly handles: readonly ActionHandle[]
  readonly resourceContract: ActionResourceContract | null
}

export interface DeviceExecutionOccupancy {
  readonly leaseUuid: string | null
  readonly workflowTaskUuid: string | null
  readonly workflowNodeJobUuid: string
  readonly state: string
  readonly actionName: string | null
  readonly acquiredAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface DeviceActionState {
  readonly actionName: string
  readonly actionRef: string
  readonly label: string
  readonly actionType: string
  readonly actionDefinitionUuid: string | null
  readonly isBusy: boolean | null
  readonly busyStatusKnown: boolean
  readonly currentJobUuid: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface DeviceSummary {
  readonly kind: 'device_summary'
  readonly source: 'os' | 'fixture'
  readonly deviceUuid: string
  readonly materialUuid: string
  readonly resourceTemplateUuid: string
  readonly deviceKey: string
  readonly namespace: string
  readonly label: string
  readonly online: boolean | null
  readonly edgeStatus: string | null
  readonly dispatchable: boolean | null
  readonly dispatchBlockReason: string | null
  readonly executionOccupancies: readonly DeviceExecutionOccupancy[] | null
  readonly actions: readonly DeviceActionState[]
  readonly raw: Readonly<Record<string, unknown>>
}

export interface DeviceActionRunRequest {
  readonly materialUuid: string
  readonly workflowNodeTemplateUuid: string
  readonly param: Readonly<Record<string, unknown>>
  readonly executionPolicy?: Readonly<Record<string, unknown>>
  readonly idempotencyKey: string
  readonly description?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface DeviceActionRunAccepted {
  readonly kind: 'device_action_run_accepted'
  readonly source: 'os'
  readonly created: boolean
  readonly taskUuid: string
  readonly jobUuid: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface DeviceActionRunView {
  readonly kind: 'device_action_run_view'
  readonly source: 'os'
  readonly task: TaskRuntimeDetail
  readonly job: TaskJobSummary
}
