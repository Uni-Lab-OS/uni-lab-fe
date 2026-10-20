import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  decodeStationSnapshot,
  StationErrorHandlingClient,
  type WorkflowNodeJobDetail,
} from '@unilab-fe/core'
import { FailedActionRetry } from './TaskFailedActionRetry'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
})

const decision = {
  decision_id: 'd1',
  decision_version: 3,
  source_task_uuid: 'task-1',
  source_job_uuid: 'job-1',
  stage: 'DECISION_REQUIRED',
  status: 'open',
  options: [
    { id: 'cancel_task', label: '取消当前任务' },
    { id: 'retry_current_node', label: '重试当前节点' },
    { id: 'enter_manual_handling', label: '进入手动处理' },
  ],
  meta_data: { message: 'collect.extend 返回错误：电机堵转' },
}
const snapshotRaw = {
  station_id: 'local',
  mode: 'PAUSED',
  error_epoch: 4,
  station_version: 9,
  snapshot_id: 'local:9:4',
  active_session: null,
  manual_actions: [],
  control_commands: [],
  errors: [decision],
}

const { capability, getSnapshot, submit, backend } = vi.hoisted(() => {
  const capability = { available: true }
  const getSnapshot = vi.fn()
  const submit = vi.fn()
  return {
    capability,
    getSnapshot,
    submit,
    backend: {
      getCapabilityStatus: () => capability,
      core: { stationErrorHandling: {} as Record<string, unknown> },
    },
  }
})
vi.mock('../../app/BackendProvider', () => ({ useBackend: () => ({ backend, readyEpoch: 0 }) }))

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
  errorInfo: [{ message: '电机堵转' }],
  uncertaintyReason: null,
  dispatchDeadlineAt: null,
  executionDeadlineAt: null,
  cancelCommandUuid: null,
  cancelAckDeadlineAt: null,
  cancelCompleteDeadlineAt: null,
  startedAt: '2026-10-20T10:00:00Z',
  finishedAt: '2026-10-20T10:00:05Z',
  raw: { current_attempt: 1 },
  ...overrides,
})

beforeEach(() => {
  capability.available = true
  const real = new StationErrorHandlingClient(
    { request: vi.fn() } as never,
    'local',
    '/api/v1',
    () => 'key-1',
  )
  getSnapshot.mockReset().mockResolvedValue(decodeStationSnapshot(snapshotRaw))
  submit.mockReset().mockResolvedValue({})
  backend.core.stationErrorHandling = {
    getSnapshot,
    submit,
    decisionIntent: real.decisionIntent.bind(real),
  }
})

describe('FailedActionRetry', () => {
  it('re-executes the failed action through the OS retry decision after confirmation', async () => {
    const onChanged = vi.fn()
    render(
      <FailedActionRetry
        job={job()}
        actionLabel="收集-伸出"
        device="collect"
        taskStatus="running"
        onChanged={onChanged}
      />,
    )
    expect(await screen.findByText('collect.extend 返回错误：电机堵转')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /同时恢复工站工作流调度/ }))
    fireEvent.click(screen.getByRole('button', { name: '重新执行该动作' }))
    expect(await screen.findByText(/将按原参数重新执行「收集-伸出」（collect）/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认重新执行' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(submit.mock.calls[0]![0]).toMatchObject({
      path: '/errors/d1/decision',
      idempotencyKey: 'key-1',
      body: {
        action: 'retry_current_node',
        expected_station_version: 9,
        expected_decision_version: 3,
        observed_error_epoch: 4,
        resume_requested: true,
        operator_confirmed: true,
        confirm_snapshot_id: 'local:9:4',
      },
    })
    // 提交后重读 OS 快照与任务，不自行推断重试结果。
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('keeps the station paused when the operator does not confirm resuming', async () => {
    render(<FailedActionRetry job={job()} actionLabel="收集-伸出" />)
    expect(await screen.findByText(/未勾选时工站保持暂停/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新执行该动作' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认重新执行' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0]![0].body).toMatchObject({
      resume_requested: false,
      operator_confirmed: false,
    })
  })

  it('requires on-site verification before re-executing an action whose result is unknown', async () => {
    render(
      <FailedActionRetry
        job={job({ uncertaintyReason: 'ptlc_action_timeout' })}
        actionLabel="收集-伸出"
      />,
    )
    expect(await screen.findByText('暂不能重新执行该动作')).toBeTruthy()
    expect(screen.getByText(/请先现场核对并“按已取消收尾”/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重新执行该动作' })).toBeNull()
  })

  it('allows re-executing once the unknown result was settled as canceled by the OS', async () => {
    render(
      <FailedActionRetry
        job={job({
          status: 'canceled',
          controlData: { manual_resolution: { reason: '现场确认未动作', status: 'confirmed' } },
        })}
        actionLabel="收集-伸出"
      />,
    )
    expect(await screen.findByRole('button', { name: '重新执行该动作' })).toBeTruthy()
  })

  it('points to the manual handling session instead of retrying while it is open', async () => {
    getSnapshot.mockResolvedValue(
      decodeStationSnapshot({
        ...snapshotRaw,
        active_session: {
          session_id: 's1',
          decision_id: 'd1',
          stage: 'MANUAL_HANDLING',
          version: 1,
        },
        errors: [{ ...decision, stage: 'MANUAL_HANDLING', session_id: 's1' }],
      }),
    )
    render(<FailedActionRetry job={job()} actionLabel="收集-伸出" />)
    expect(await screen.findByText(/该错误正在人工处置/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重新执行该动作' })).toBeNull()
  })

  it('explains that a finished task cannot re-execute a single action', async () => {
    getSnapshot.mockResolvedValue(decodeStationSnapshot({ ...snapshotRaw, errors: [] }))
    render(<FailedActionRetry job={job()} actionLabel="收集-伸出" taskStatus="failed" />)
    expect(
      await screen.findByText(/任务已结束，OS 不支持对已结束任务重新执行单个动作/),
    ).toBeTruthy()
  })

  it('stays hidden for running, replaced or undeclared cases', async () => {
    const { container, rerender } = render(
      <FailedActionRetry job={job({ status: 'running' })} actionLabel="收集-伸出" />,
    )
    expect(container.textContent).toBe('')
    rerender(<FailedActionRetry job={job({ raw: { current_attempt: 0 } })} actionLabel="x" />)
    expect(container.textContent).toBe('')
    capability.available = false
    rerender(<FailedActionRetry job={job()} actionLabel="x" />)
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(getSnapshot).not.toHaveBeenCalled()
  })
})
