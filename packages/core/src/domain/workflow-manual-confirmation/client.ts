import type { RequestTransport } from '../../transport/request'
import type { ManualConfirmationAction, WorkflowManualConfirmationDecision } from './model'
import type { WorkflowManualConfirmationPort } from './port'

export class WorkflowManualConfirmationClient implements WorkflowManualConfirmationPort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1',
  ) {}

  async decide(
    jobUuid: string,
    action: ManualConfirmationAction,
  ): Promise<WorkflowManualConfirmationDecision> {
    const response = await this.transport.request<unknown>({
      method: 'POST',
      url: `${this.apiPrefix}/workflow-node-jobs/${encodeURIComponent(jobUuid)}/manual-confirmation`,
      body: { action },
    })
    const raw = asRecord(response.data) ?? {}
    const data = asRecord(raw.data) ?? raw
    return {
      kind: 'workflow_manual_confirmation_decision',
      source: 'os',
      jobUuid,
      action,
      raw: data,
    }
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}
