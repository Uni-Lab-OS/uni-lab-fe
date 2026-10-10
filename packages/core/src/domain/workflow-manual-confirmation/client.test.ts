import { describe, expect, it } from 'vitest'
import { WorkflowManualConfirmationClient } from './client'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

describe('WorkflowManualConfirmationClient', () => {
  it('posts an approve decision to the OS-only manual confirmation endpoint', async () => {
    let request: TransportRequest | undefined
    const transport: RequestTransport = {
      async request<Value>(input: TransportRequest): Promise<TransportResponse<Value>> {
        request = input
        return { status: 200, headers: {}, data: { status: 'approved' } as Value }
      },
    }

    const decision = await new WorkflowManualConfirmationClient(transport).decide(
      'job/1',
      'approve',
    )

    expect(request).toMatchObject({
      method: 'POST',
      url: '/api/v1/workflow-node-jobs/job%2F1/manual-confirmation',
      body: { action: 'approve' },
    })
    expect(decision).toMatchObject({
      kind: 'workflow_manual_confirmation_decision',
      source: 'os',
      jobUuid: 'job/1',
      action: 'approve',
      raw: { status: 'approved' },
    })
  })
})
