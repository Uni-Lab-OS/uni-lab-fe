/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: Uni-Lab-OS REST 客户端封装(设备/资源/任务)
 * Context: 对接 http://localhost:8002/api/v1,统一 { code, data, message } 解包
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import { requestData, type HttpClient } from './http'
import { ServiceError } from './errors'

export interface DeviceActionTarget {
  deviceId: string
  label: string
}

export interface OnlineDevice {
  id: string
  deviceKey: string
  namespace: string
  machineName: string
  online: boolean
  actions: DeviceAction[]
}

export interface DeviceAction {
  actionName: string
  actionRef: string
  displayName: string
  label: string
  typeName: string
  isBusy: boolean
  currentJobId: string | null
  schema: Record<string, unknown> | null
  inputSchema: Record<string, DeviceActionInputSchema>
  outputSchema: Record<string, DeviceActionInputSchema>
}

export interface DeviceActionInputSchema {
  type?: string
  title?: string
  description?: string
  default?: unknown
  enum?: unknown[]
  required?: boolean
  minimum?: number
  maximum?: number
}

export interface DeviceActionSchema {
  schema: Record<string, unknown>
  goalDefault: Record<string, unknown>
  actionType: string
  isBusy: boolean
  currentJobId: string | null
}

export interface DeviceStatus {
  deviceId: string
  status: Record<string, unknown>
  timestamp: number
}

export interface DeviceCatalogAction {
  actionName: string
  actionRef: string
  label: string
  typeName: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  isBusy: boolean
}

export interface DeviceCatalogItem {
  deviceId: string
  deviceTypeId: string
  deviceKey: string
  namespace: string
  label: string
  online: boolean
  actions: DeviceCatalogAction[]
}

export interface ResourceNode {
  id: string
  uuid: string
  name: string
  type: string
  className: string
  parent: string | null
  config: Record<string, unknown>
  data: Record<string, unknown>
  position: { x: number; y: number; z: number }
  children: ResourceNode[]
}

export interface JobRequest {
  deviceId: string
  action: string
  actionArgs: Record<string, unknown>
}

export type ActionRunStatus =
  | 'unknown'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'cancel_requested'
  | 'reconciling'
  | 'dispatch_unknown'

export interface JobResult {
  jobId: string
  status: ActionRunStatus
  result: Record<string, unknown> | null
  feedback: Record<string, unknown> | null
}

interface RuntimeActionTemplate {
  actionRef: string
  actionName: string
  deviceId: string
  label: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
}

let actionRunSequence = 0

export function createLaboratoryService(http: HttpClient) {
  return {
    async ping(): Promise<boolean> {
      try {
        await http.request<unknown>('/health')
        return true
      } catch {
        return false
      }
    },

    async getActionDevices(): Promise<DeviceActionTarget[]> {
      const templates = await getRuntimeActionTemplates(http)
      return [...new Set(templates.map((template) => template.deviceId))]
        .sort()
        .map((deviceId) => ({ deviceId, label: deviceId }))
    },

    async getDeviceCatalog(): Promise<DeviceCatalogItem[]> {
      const raw = await http.request<Record<string, unknown>>('/api/v1/devices')
      const items = Array.isArray(raw.items) ? raw.items : []
      return items.map((value) => mapDeviceCatalogItem(asRecord(value)))
    },

    async getOnlineDevices(): Promise<OnlineDevice[]> {
      const templates = await getRuntimeActionTemplates(http)
      const actionsByDevice = new Map<string, RuntimeActionTemplate[]>()
      for (const template of templates) {
        const actions = actionsByDevice.get(template.deviceId) ?? []
        actions.push(template)
        actionsByDevice.set(template.deviceId, actions)
      }
      return [...actionsByDevice.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([deviceId, actions]) => ({
          id: deviceId,
          deviceKey: `/devices/${deviceId}`,
          namespace: '/devices',
          machineName: 'Uni-Lab OS',
          online: true,
          actions: actions.map(mapDeviceAction)
        }))
    },

    async getDeviceActions(deviceId: string): Promise<DeviceAction[]> {
      const templates = await getRuntimeActionTemplates(http)
      return templates
        .filter((template) => template.deviceId === deviceId)
        .map(mapDeviceAction)
    },

    async getActionSchema(
      deviceId: string,
      actionName: string
    ): Promise<DeviceActionSchema> {
      const actionRef = `${deviceId}.${actionName}`
      const template = (await getRuntimeActionTemplates(http)).find(
        (candidate) => candidate.actionRef === actionRef
      )
      if (!template) {
        throw new ServiceError({
          code: 'ACTION_NOT_FOUND',
          message: `未找到 Action：${actionRef}`,
          status: 404,
          retryable: false
        })
      }
      return mapDeviceActionSchema(template)
    },

    async getResources(): Promise<ResourceNode[]> {
      const raw = await requestData<Record<string, unknown>[]>(
        http,
        '/api/v1/resources'
      )
      return raw.map(mapResource)
    },

    async addJob(job: JobRequest): Promise<JobResult> {
      const clientRequestId = actionRunId()
      const actionRef = `${job.deviceId}.${job.action}`
      const raw = await http.request<Record<string, unknown>>(
        '/api/v1/runtime/runs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: {
              format: 'workflow_revision_v2',
              revision: {
                schema_version: '2',
                revision_id: clientRequestId,
                workflow_id: `single-action:${job.deviceId}`,
                invocations: [
                  {
                    node_id: 'action',
                    action_ref: actionRef,
                    name: job.action,
                    input_bindings: Object.fromEntries(
                      Object.entries(job.actionArgs).map(([name, value]) => [
                        name,
                        { kind: 'literal', value }
                      ])
                    )
                  }
                ],
                control_edges: []
              }
            },
            client_request_id: clientRequestId
          })
        }
      )
      return mapRuntimeJob(raw)
    },

    async getJobStatus(jobId: string): Promise<JobResult> {
      const encodedJobId = encodeURIComponent(jobId)
      const [run, nodePage, eventPage] = await Promise.all([
        http.request<Record<string, unknown>>(
          `/api/v1/runtime/runs/${encodedJobId}`
        ),
        http.request<Record<string, unknown>>(
          `/api/v1/runtime/runs/${encodedJobId}/nodes`
        ),
        http.request<Record<string, unknown>>(
          `/api/v1/runtime/runs/${encodedJobId}/events?after_seq=0`
        )
      ])
      return mapRuntimeJob(run, nodePage, eventPage)
    },

    async cancelJob(jobId: string): Promise<JobResult> {
      const raw = await http.request<Record<string, unknown>>(
        `/api/v1/runtime/runs/${encodeURIComponent(jobId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }
      )
      return mapRuntimeJob(raw)
    }
  }
}

export type LaboratoryService = ReturnType<typeof createLaboratoryService>

function mapDeviceCatalogItem(
  raw: Record<string, unknown>
): DeviceCatalogItem {
  const deviceId = str(raw.id)
  return {
    deviceId,
    // 当前 OS device-catalog/v1 只有实例 id；兼容未来补充的类型字段。
    deviceTypeId: str(raw.deviceTypeId ?? raw.typeId ?? raw.className) || deviceId,
    deviceKey: str(raw.deviceKey),
    namespace: str(raw.namespace),
    label: str(raw.name) || deviceId,
    online: Boolean(raw.online),
    actions: Array.isArray(raw.actions)
      ? raw.actions.map((value) => {
          const action = asRecord(value)
          const actionRef = str(action.actionRef)
          const separator = actionRef.lastIndexOf('.')
          return {
            actionName: str(action.id) ||
              (separator >= 0 ? actionRef.slice(separator + 1) : actionRef),
            actionRef,
            label: str(action.name) || str(action.id),
            typeName: str(action.typeName),
            inputSchema: asRecord(action.inputSchema),
            outputSchema: asRecord(action.outputSchema),
            isBusy: Boolean(action.busy)
          }
        })
      : []
  }
}

function mapDeviceAction(template: RuntimeActionTemplate): DeviceAction {
  const schema = normalizeInputSchema(template.inputSchema)
  return {
    actionName: template.actionName,
    actionRef: template.actionRef,
    displayName: template.label,
    label: template.label,
    typeName: template.actionRef,
    isBusy: false,
    currentJobId: null,
    schema,
    inputSchema: mapActionSchema(schema.properties),
    outputSchema: mapActionSchema(template.outputSchema)
  }
}

function mapDeviceActionSchema(
  template: RuntimeActionTemplate
): DeviceActionSchema {
  const schema = normalizeInputSchema(template.inputSchema)
  return {
    schema,
    goalDefault: defaultsFromInputSchema(schema),
    actionType: template.actionRef,
    isBusy: false,
    currentJobId: null
  }
}

function mapResource(raw: Record<string, unknown>): ResourceNode {
  const pos = isRecord(raw.position) ? raw.position : {}
  return {
    id: str(raw.id),
    uuid: str(raw.uuid),
    name: str(raw.name),
    type: str(raw.type),
    className: str(raw.class),
    parent: raw.parent == null ? null : str(raw.parent),
    config: isRecord(raw.config) ? raw.config : {},
    data: isRecord(raw.data) ? raw.data : {},
    position: { x: num(pos.x), y: num(pos.y), z: num(pos.z) },
    children: Array.isArray(raw.children)
      ? raw.children.map((child) => mapResource(asRecord(child)))
      : []
  }
}

async function getRuntimeActionTemplates(
  http: HttpClient
): Promise<RuntimeActionTemplate[]> {
  const raw = await http.request<Record<string, unknown>>(
    '/api/v1/workflow-node-templates'
  )
  const items = Array.isArray(raw.items) ? raw.items : []
  return items.flatMap((value) => {
    const item = asRecord(value)
    if (item.kind !== 'action') return []
    const actionRef = str(item.id)
    const separator = actionRef.lastIndexOf('.')
    if (separator <= 0 || separator === actionRef.length - 1) return []
    return [
      {
        actionRef,
        deviceId: actionRef.slice(0, separator),
        actionName: actionRef.slice(separator + 1),
        label: str(item.label) || actionRef.slice(separator + 1),
        inputSchema: asRecord(item.inputSchema),
        outputSchema: asRecord(item.outputSchema)
      }
    ]
  })
}

function mapActionSchema(
  value: unknown
): Record<string, DeviceActionInputSchema> {
  const schema = asRecord(value)
  return Object.fromEntries(
    Object.entries(schema).map(([name, definition]) => [
      name,
      asRecord(definition) as DeviceActionInputSchema
    ])
  )
}

function normalizeInputSchema(
  inputSchema: Record<string, unknown>
): Record<string, unknown> {
  if (inputSchema.type === 'object' && isRecord(inputSchema.properties)) {
    return inputSchema
  }
  return {
    type: 'object',
    properties: inputSchema
  }
}

function defaultsFromInputSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const properties = asRecord(schema.properties)
  return Object.fromEntries(
    Object.entries(properties).flatMap(([name, value]) => {
      const definition = asRecord(value)
      return Object.prototype.hasOwnProperty.call(definition, 'default')
        ? [[name, definition.default]]
        : []
    })
  )
}

function mapRuntimeJob(
  raw: Record<string, unknown>,
  nodePage?: Record<string, unknown>,
  eventPage?: Record<string, unknown>
): JobResult {
  const nodes = Array.isArray(nodePage?.items) ? nodePage.items : []
  const events = Array.isArray(eventPage?.events) ? eventPage.events : []
  return {
    jobId: str(raw.id ?? raw.run_id),
    status: actionRunStatus(raw.status),
    result: nodes.length > 0 ? { nodes } : null,
    feedback: events.length > 0 ? { events } : null
  }
}

function actionRunStatus(value: unknown): ActionRunStatus {
  switch (value) {
    case 'pending':
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'cancel_requested':
    case 'reconciling':
    case 'dispatch_unknown':
      return value
    default:
      return 'unknown'
  }
}

function actionRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  actionRunSequence += 1
  return `device-action-${Date.now()}-${actionRunSequence}`
}

function str(value: unknown): string {
  return value == null ? '' : String(value)
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}
