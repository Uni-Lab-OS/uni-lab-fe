import { describe, expect, it } from 'vitest'
import type { DeviceActionRunView } from '@unilab-fe/core'
import { deviceActionErrors, deviceActionReturnInfo, deviceActionRunState } from './deviceActionRunModel'

export function runView(
  task: Partial<DeviceActionRunView['task']>,
  job: Partial<DeviceActionRunView['job']>,
): DeviceActionRunView {
  return {
    kind: 'device_action_run_view',
    source: 'os',
    task: {
      kind: 'task_runtime_detail',
      source: 'os',
      taskUuid: 'task-1',
      workflowUuid: null,
      executionKind: 'device_action',
      status: 'running',
      runMode: 'normal',
      controlStatus: 'active',
      cleanupStatus: 'none',
      createdAt: '',
      updatedAt: '',
      raw: {},
      ...task,
    },
    job: {
      kind: 'task_job_summary',
      source: 'os',
      jobUuid: 'job-1',
      workflowNodeUuid: 'node-1',
      topologicalIndex: 0,
      executorKind: 'device',
      status: 'pending',
      attempt: 1,
      currentAttempt: true,
      controlData: {},
      errorInfo: [],
      waitReason: {},
      expectedChangeSet: {},
      raw: {},
      ...job,
    },
  }
}

describe('deviceActionRunState', () => {
  it('separates accepted, running and succeeded', () => {
    expect(deviceActionRunState(runView({}, { waitReason: { wait_message: '设备忙' } }))).toMatchObject({
      phase: 'accepted',
      settled: false,
      detail: '等待原因：设备忙',
    })
    expect(deviceActionRunState(runView({}, { status: 'running' })).phase).toBe('running')
    expect(deviceActionRunState(runView({ status: 'succeeded' }, { status: 'succeeded' }))).toMatchObject({
      phase: 'succeeded',
      settled: true,
      tone: 'success',
    })
  })

  it('reports a cancel without device receipt as canceling, not as terminated (field 11.14)', () => {
    const state = deviceActionRunState(
      runView(
        { status: 'canceling', cleanupStatus: 'waiting_reconciliation', attentionReason: 'local_cancel_acceptance_unavailable' },
        { status: 'running' },
      ),
    )
    expect(state).toMatchObject({ phase: 'canceling', tone: 'warning', settled: true })
    expect(state.detail).toContain('不要重复提交取消')
  })

  it('reports unknown outcomes for on-site verification', () => {
    const state = deviceActionRunState(runView({}, { status: 'execution_unknown' }))
    expect(state.phase).toBe('unknown')
    expect(state.detail).toContain('不要直接重发')
  })

  it('shows structured device rejection reasons', () => {
    const view = runView(
      { status: 'failed' },
      {
        status: 'failed',
        errorInfo: [
          {
            code: 'ptlc_action_rejected',
            message: "robot.enable: REJECTED: 当前模式 RUN 不允许动作 robot.enable (需 ['DEBUG'])",
            protocol_status: 'REJECTED',
          },
          { code: 'ptlc_action_rejected', message: 'collect.extend: ERROR', protocol_error_code: 421 },
        ],
      },
    )
    expect(deviceActionRunState(view).phase).toBe('failed')
    expect(deviceActionErrors(view)).toEqual([
      { code: '设备拒绝执行', message: expect.stringContaining('需 [\'DEBUG\']'), detail: '协议状态 REJECTED' },
      { code: '设备拒绝执行', message: 'collect.extend: ERROR', detail: 'PLC 错误码 421' },
    ])
  })

  it('reads return_info from the job record', () => {
    const view = runView({}, { status: 'succeeded', raw: { return_info: { z_mm: 494 } } })
    expect(deviceActionReturnInfo(view)).toEqual({ z_mm: 494 })
    expect(deviceActionReturnInfo(runView({}, {}))).toBeUndefined()
  })
})
