import { describe, expect, it } from 'vitest'
import { decodeTaskPresentationPage } from './codec'

describe('task presentation codec', () => {
  it('keeps the OS-provided matrix projection and embedded job states intact', () => {
    expect(
      decodeTaskPresentationPage({
        code: 0,
        data: {
          items: [
            {
              uuid: 'task-1',
              workflow_uuid: 'workflow-1',
              execution_kind: 'workflow',
              status: 'execution_unknown',
              run_mode: 'normal',
              control_status: 'waiting_intervention',
              cleanup_status: 'none',
              create_time: '2026-09-25T00:00:00Z',
              update_time: '2026-09-25T00:00:01Z',
              progress: { completed: 1, total: 2, percent: 50 },
              jobs: [
                {
                  uuid: 'job-1',
                  workflow_node_uuid: 'node-1',
                  topological_index: 0,
                  executor_kind: 'device',
                  status: 'execution_unknown',
                  attempt: 1,
                  current_attempt: true,
                  execution_source: 'edge',
                  start_state: 'unknown',
                  control_data: {},
                  error_info: [],
                  wait_reason: {},
                  expected_change_set: {},
                },
              ],
            },
          ],
          total: 1,
          page: 1,
          page_size: 20,
        },
      }),
    ).toMatchObject({
      total: 1,
      items: [
        {
          status: 'execution_unknown',
          controlStatus: 'waiting_intervention',
          progress: { completed: 1, total: 2, percent: 50 },
          jobs: [{ status: 'execution_unknown', executionSource: 'edge' }],
        },
      ],
    })
  })
})
