import { describe, expect, it } from 'vitest'
import type { WorkflowNodeJobDetail } from '@unilab-fe/core'
import { readManualResolution, retryBlockReason } from './actionRetryGuard'

const job = (overrides: Partial<WorkflowNodeJobDetail> = {}): WorkflowNodeJobDetail => ({
  kind: 'node_job_detail',
  source: 'os',
  jobUuid: 'job-1',
  workflowTaskUuid: 'task-1',
  workflowNodeUuid: 'node-1',
  materialUuid: null,
  edgeUuid: null,
  edgeCommandUuid: null,
  feedbackSequence: null,
  topologicalIndex: 4,
  executorKind: 'device_action',
  executionPolicy: {},
  executionTimeoutSeconds: null,
  status: 'failed',
  attempt: 1,
  param: {},
  feedbackData: {},
  returnInfo: {},
  controlData: {},
  errorInfo: [],
  uncertaintyReason: null,
  dispatchDeadlineAt: null,
  executionDeadlineAt: null,
  cancelCommandUuid: null,
  cancelAckDeadlineAt: null,
  cancelCompleteDeadlineAt: null,
  startedAt: null,
  finishedAt: null,
  raw: {},
  ...overrides,
})

describe('retryBlockReason', () => {
  it('allows re-executing only actions the OS reports as ended without an unknown result', () => {
    expect(retryBlockReason(job())).toBeNull()
    expect(retryBlockReason(job({ status: 'timeout' }))).toBeNull()
    // 结果未知按已取消收尾后，OS 清除不确定原因并把作业记为 canceled。
    expect(retryBlockReason(job({ status: 'canceled' }))).toBeNull()
    expect(retryBlockReason(job({ status: 'running' }))).toMatch(/尚未结束（OS 状态 running）/)
    expect(retryBlockReason(job({ status: 'dispatched' }))).toMatch(/尚未结束/)
  })

  it('requires settling an unknown result as canceled before re-executing', () => {
    expect(retryBlockReason(job({ uncertaintyReason: 'ptlc_action_timeout' }))).toMatch(
      /结果未知（ptlc_action_timeout）.*请先现场核对并“按已取消收尾”/,
    )
    // 即使 OS 状态已是 failed，只要仍带不确定原因就不能重发。
    expect(
      retryBlockReason(job({ status: 'failed', uncertaintyReason: 'dispatch_unknown' })),
    ).toMatch(/结果未知/)
    expect(
      retryBlockReason(
        job({
          uncertaintyReason: 'ptlc_action_timeout',
          controlData: { manual_resolution: { status: 'pending_edge_confirmation' } },
        }),
      ),
    ).toMatch(/等待设备侧确认/)
  })
})

describe('readManualResolution', () => {
  it('reads the OS manual resolution record and ignores malformed values', () => {
    expect(
      readManualResolution(
        job({ controlData: { manual_resolution: { reason: '现场未动作', status: 'confirmed' } } }),
      ),
    ).toEqual({ reason: '现场未动作', status: 'confirmed' })
    expect(readManualResolution(job({ controlData: { manual_resolution: {} } }))).toEqual({
      reason: '',
      status: '',
    })
    expect(readManualResolution(job({ controlData: { manual_resolution: ['x'] } }))).toBeNull()
    expect(readManualResolution(job())).toBeNull()
    expect(readManualResolution(null)).toBeNull()
  })
})
