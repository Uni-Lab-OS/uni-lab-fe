import type { RequestTransport } from '../../transport/request'
import type {
  WorkflowTaskCommandReceipt,
  WorkflowTaskCommandRequest,
  WorkflowTaskCommandType
} from '../workflow-execution-read/model'
import type { WorkflowExecutionControlPort } from './port'

export class WorkflowExecutionControlClient implements WorkflowExecutionControlPort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1'
  ) {}

  async sendTaskCommand(taskUuid: string, request: WorkflowTaskCommandRequest): Promise<WorkflowTaskCommandReceipt> {
    const response = await this.transport.request<Record<string, unknown>>({
      method: 'POST',
      url: `${this.apiPrefix}/workflow-tasks/${encodeURIComponent(taskUuid)}/commands`,
      body: {
        type: request.type,
        ...(request.targetNodeUuid === undefined ? {} : { target_node_uuid: request.targetNodeUuid }),
        idempotency_key: request.idempotencyKey,
        ...(request.description === undefined ? {} : { description: request.description }),
        ...(request.metadata === undefined ? {} : { meta_data: request.metadata })
      }
    })
    return decodeCommandReceipt(response.data, response.status, taskUuid, request)
  }
}

function decodeCommandReceipt(
  value: unknown,
  statusCode: number,
  taskUuid: string,
  request: WorkflowTaskCommandRequest
): WorkflowTaskCommandReceipt {
  const root = asRecord(value) ?? {}
  const data = asRecord(root.data) ?? root
  const status = stringValue(data.status)
  const lifecycle = status === 'rejected'
    ? 'rejected'
    : status === 'succeeded' || status === 'applied' || status === 'completed'
      ? 'applied'
      : statusCode >= 200 && statusCode < 300
        ? 'accepted'
        : 'unknown'
  return {
    kind: 'workflow_task_command_receipt',
    commandUuid: stringValue(data.uuid ?? data.command_uuid) ?? null,
    workflowTaskUuid: stringValue(data.workflow_task_uuid) ?? taskUuid,
    type: (stringValue(data.type) as WorkflowTaskCommandType | undefined) ?? request.type,
    targetNodeUuid: stringValue(data.target_node_uuid ?? request.targetNodeUuid) ?? null,
    idempotencyKey: stringValue(data.idempotency_key) ?? request.idempotencyKey,
    accepted: statusCode >= 200 && statusCode < 300,
    lifecycle,
    statusCode,
    result: asRecord(data.result) ?? {},
    createdAt: stringValue(data.create_time ?? data.created_at) ?? null,
    updatedAt: stringValue(data.update_time ?? data.updated_at) ?? null,
    raw: data
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
