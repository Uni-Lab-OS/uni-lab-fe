import { describe, expect, it } from 'vitest'
import { decodeNodeJobDetail, decodeNodeJobFeedbackPage } from './codec'

describe('workflow execution read codec', () => {
  it('keeps execution_unknown and uncertainty as NodeJob facts', () => {
    expect(
      decodeNodeJobDetail({
        code: 0,
        data: {
          uuid: 'job-1',
          workflow_task_uuid: 'task-1',
          workflow_node_uuid: 'node-1',
          executor_kind: 'material_transfer',
          status: 'execution_unknown',
          attempt: 2,
          uncertainty_reason: 'edge receipt missing',
          param: { amount: 1 },
          return_info: { state: 'unknown' },
          error_info: [],
        },
      }),
    ).toMatchObject({
      kind: 'node_job_detail',
      status: 'execution_unknown',
      attempt: 2,
      uncertaintyReason: 'edge receipt missing',
      param: { amount: 1 },
      feedbackData: {},
      controlData: {},
    })
  })

  it('maps feedback identity, sequence and metadata without interpreting payload data', () => {
    expect(
      decodeNodeJobFeedbackPage({
        code: 0,
        data: {
          items: [
            {
              uuid: 'feedback-1',
              workflow_node_job_uuid: 'job-1',
              sequence: 3,
              feedback_type: 'device.progress',
              data: { raw: 'payload' },
              observed_at: '2026-09-25T00:00:00Z',
              received_at: '2026-09-25T00:00:01Z',
              published_at: null,
              idempotency_key: 'feedback-1',
              meta_data: { source: 'edge' },
            },
          ],
          has_more: false,
          page: 1,
          page_size: 20,
        },
      }),
    ).toMatchObject({
      nextCursor: 3,
      hasMore: false,
      items: [
        {
          feedbackUuid: 'feedback-1',
          sequence: 3,
          data: { raw: 'payload' },
          metadata: { source: 'edge' },
        },
      ],
    })
  })

  it('rejects malformed feedback page contracts', () => {
    expect(() =>
      decodeNodeJobFeedbackPage({
        items: [{ uuid: 'feedback-1' }],
        has_more: false,
      }),
    ).toThrow('feedback.workflow_node_job_uuid')
  })
})
