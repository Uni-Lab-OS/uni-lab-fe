import { describe, expect, it } from 'vitest'
import {
  decodeNodeJobDetail,
  decodeNodeJobFeedbackPage,
  decodeTaskExecutionLockSnapshot,
} from './codec'

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

  it('decodes the task execution lock snapshot with nullable and optional fallbacks', () => {
    const snapshot = decodeTaskExecutionLockSnapshot({
      code: 0,
      data: {
        workflow_task_uuid: 'task-1',
        task_status: 'failed',
        active_device_tenancy_count: 1,
        locks: [
          {
            // 可空字段显式给 null：必须如实保留为 null，不能当成字符串 'null'。
            uuid: 'lock-1',
            workflow_task_uuid: 'task-1',
            workflow_node_job_uuid: null,
            lock_key: 'device:robot-1',
            scope: 'device',
            state: 'reserved',
            claim_uuid: null,
            fencing_token: null,
            job_status: null,
            claim_state: null,
            can_release: false,
            release_block_reason: '设备租约仍被占用，需先在设备页解除占用',
          },
          {
            // 可选字段整段缺失：material_uuid/site_uuid/release_block_reason 必须缺席，
            // 而不是补成空字符串（否则 UI 会伪造出一个不存在的物料/安装位）。
            uuid: 'lock-2',
            workflow_task_uuid: 'task-1',
            workflow_node_job_uuid: 'job-2',
            lock_key: 'site:slot-9',
            scope: 'site',
            state: 'running',
            claim_uuid: 'claim-2',
            fencing_token: 12,
            job_status: 'running',
            claim_state: 'held',
            can_release: true,
          },
        ],
      },
    })

    expect(snapshot).toMatchObject({
      kind: 'workflow_task_execution_lock_snapshot',
      source: 'os',
      workflowTaskUuid: 'task-1',
      taskStatus: 'failed',
      activeDeviceTenancyCount: 1,
    })
    expect(snapshot.locks[0]).toMatchObject({
      uuid: 'lock-1',
      workflowNodeJobUuid: null,
      claimUuid: null,
      fencingToken: null,
      jobStatus: null,
      claimState: null,
      canRelease: false,
      releaseBlockReason: '设备租约仍被占用，需先在设备页解除占用',
    })
    expect(snapshot.locks[1]).toMatchObject({
      uuid: 'lock-2',
      workflowNodeJobUuid: 'job-2',
      canRelease: true,
    })
    expect(snapshot.locks[1]).not.toHaveProperty('materialUuid')
    expect(snapshot.locks[1]).not.toHaveProperty('siteUuid')
    expect(snapshot.locks[1]).not.toHaveProperty('releaseBlockReason')
  })

  it('rejects lock snapshots missing the unlock gate fields', () => {
    expect(() =>
      decodeTaskExecutionLockSnapshot({
        workflow_task_uuid: 'task-1',
        task_status: 'failed',
        active_device_tenancy_count: 0,
      }),
    ).toThrow('task execution locks.locks must be an array')
    expect(() =>
      decodeTaskExecutionLockSnapshot({
        workflow_task_uuid: 'task-1',
        active_device_tenancy_count: 0,
        locks: [],
      }),
    ).toThrow('task execution locks.task_status')
    expect(() =>
      decodeTaskExecutionLockSnapshot({
        data: {
          workflow_task_uuid: 'task-1',
          task_status: 'failed',
          active_device_tenancy_count: 0,
          locks: [{ uuid: 'lock-1', workflow_task_uuid: 'task-1' }],
        },
      }),
    ).toThrow('task execution lock.lock_key')
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
