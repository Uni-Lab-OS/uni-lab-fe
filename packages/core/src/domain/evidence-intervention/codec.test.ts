import { describe, expect, it } from 'vitest'
import { decodeIntervention, decodeInterventionList } from './codec'

describe('evidence intervention codec', () => {
  it('maps an open intervention while preserving device options and delivery state', () => {
    expect(
      decodeIntervention({
        code: 0,
        data: intervention('intervention-1', 'open'),
      }),
    ).toMatchObject({
      kind: 'workflow_intervention',
      interventionUuid: 'intervention-1',
      status: 'open',
      options: [{ id: 'retry' }, { id: 'abort' }],
      deliveryStatus: 'none',
      selectedOption: {},
    })
  })

  it('accepts the direct list payload and rejects duplicate option identities', () => {
    expect(decodeInterventionList([intervention('intervention-1', 'selected')])).toMatchObject([
      { status: 'selected' },
    ])

    expect(() =>
      decodeIntervention({
        ...intervention('intervention-1', 'open'),
        options: [{ id: 'retry' }, { id: 'retry' }],
      }),
    ).toThrow('duplicate intervention option id')
  })
})

function intervention(uuid: string, status: string) {
  return {
    uuid,
    create_time: '2026-09-25T00:00:00Z',
    update_time: '2026-09-25T00:00:01Z',
    meta_data: { source: 'edge' },
    workflow_task_uuid: 'task-1',
    workflow_node_job_uuid: 'job-1',
    edge_command_uuid: null,
    revision: 1,
    status,
    options: [
      { id: 'retry', action: 'retry', label: 'Retry' },
      { id: 'abort', action: 'abort' },
    ],
    resume_control_status: 'active',
    selected_option: {},
    delivery_status: 'none',
    opened_at: '2026-09-25T00:00:00Z',
  }
}
