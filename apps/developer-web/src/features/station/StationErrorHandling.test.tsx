import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  decodeStationSnapshot,
  StationErrorHandlingClient,
  TransportError,
  type WorkflowNodeJobDetail,
  type WorkflowRuntimeInvalidation,
} from '@unilab-fe/core'
import { StationErrorHandling } from './StationErrorHandling'

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

const paused = decodeStationSnapshot({
  station_id: 'local',
  mode: 'PAUSED',
  error_epoch: 1,
  station_version: 2,
  snapshot_id: 'local:2:1',
  active_session: null,
  manual_actions: [],
  control_commands: [],
  errors: [
    {
      decision_id: 'd1',
      decision_version: 1,
      source_task_uuid: 'task-1',
      source_job_uuid: 'job-1',
      stage: 'DECISION_REQUIRED',
      status: 'open',
      options: [
        { id: 'cancel_task', label: '取消当前任务' },
        { id: 'retry_current_node', label: '重试当前节点' },
        { id: 'enter_manual_handling', label: '进入手动处理' },
      ],
      meta_data: { message: 'photoscrape.candidate_status 失败' },
    },
  ],
})

const { getSnapshot, submit, listOccupancies, getNodeJobDetail, listeners, backend } = vi.hoisted(
  () => {
    const getSnapshot = vi.fn()
    const submit = vi.fn()
    const listOccupancies = vi.fn()
    const getNodeJobDetail = vi.fn()
    const listeners = new Set<(event: WorkflowRuntimeInvalidation) => void>()
    return {
      getSnapshot,
      submit,
      listOccupancies,
      getNodeJobDetail,
      listeners,
      backend: {
        getCapabilityStatus: () => ({ available: true }),
        core: {
          stationErrorHandling: {} as Record<string, unknown>,
          executionRead: { getNodeJobDetail },
          workflowRuntimeEvents: {
            subscribe: (listener: (event: WorkflowRuntimeInvalidation) => void) => {
              listeners.add(listener)
              return { dispose: () => listeners.delete(listener) }
            },
          },
        },
      },
    }
  },
)
vi.mock('../../app/BackendProvider', () => ({ useBackend: () => ({ backend, readyEpoch: 0 }) }))

/** OS 作业事实（GET /workflow-node-jobs/{job_uuid}）：默认是已失败、结果明确的出错作业。 */
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
  raw: { current_attempt: 1 },
  ...overrides,
})

const unknownResult = job({ status: 'running', uncertaintyReason: 'ptlc_action_timeout' })

const runtimeChanged = (workflowTaskUuid: string): WorkflowRuntimeInvalidation => ({
  id: `evt-${workflowTaskUuid}`,
  event: 'workflow.runtime.changed',
  workflowTaskUuid,
  raw: {},
})

const retryButton = () =>
  screen.getByRole('button', { name: /重新执行该动作/ }) as HTMLButtonElement

beforeEach(() => {
  const real = new StationErrorHandlingClient(
    { request: vi.fn() } as never,
    'local',
    '/api/v1',
    () => 'key-1',
  )
  getSnapshot.mockReset().mockResolvedValue(paused)
  submit.mockReset().mockResolvedValue({})
  listOccupancies.mockReset().mockResolvedValue([])
  getNodeJobDetail.mockReset().mockResolvedValue(job())
  listeners.clear()
  backend.core.stationErrorHandling = {
    getSnapshot,
    submit,
    listOccupancies,
    releaseOccupanciesIntent: real.releaseOccupanciesIntent.bind(real),
    decisionIntent: real.decisionIntent.bind(real),
    completeSessionIntent: real.completeSessionIntent.bind(real),
    returnToSessionIntent: real.returnToSessionIntent.bind(real),
    resumeIntent: real.resumeIntent.bind(real),
    applyCommandIntent: real.applyCommandIntent.bind(real),
  }
})

describe('StationErrorHandling', () => {
  it('shows the paused station everywhere and opens the decision dialog for a new error', async () => {
    render(<StationErrorHandling />)
    expect(await screen.findByText('工站调度已暂停')).toBeTruthy()
    expect(await screen.findByText('photoscrape.candidate_status 失败')).toBeTruthy()
    // 只有读到 OS 作业事实（已失败、结果明确）后才放行重新执行。
    await waitFor(() => expect(retryButton().disabled).toBe(false))
    expect(getNodeJobDetail).toHaveBeenCalledWith('job-1')
    fireEvent.click(retryButton())
    fireEvent.click(await screen.findByRole('button', { name: '确认重新执行' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0]![0]).toMatchObject({
      path: '/errors/d1/decision',
      idempotencyKey: 'key-1',
      body: { action: 'retry_current_node', resume_requested: false, expected_station_version: 2 },
    })
    // 提交后重读 OS 快照，不自行推断结果。
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2))
  })

  it('keeps an ambiguous submission for resend with the same idempotency key', async () => {
    submit.mockRejectedValueOnce(
      new TransportError({ code: 'network', message: '请求已中止或超时' }),
    )
    render(<StationErrorHandling />)
    fireEvent.click(await screen.findByRole('button', { name: '进入手动处理' }))
    expect(await screen.findByText('进入手动处理：结果待确认')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认原请求结果' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls[1]![0].idempotencyKey).toBe(submit.mock.calls[0]![0].idempotencyKey)
  })

  it('renders nothing while the station runs without errors', async () => {
    getSnapshot.mockResolvedValue(
      decodeStationSnapshot({ ...paused.raw, mode: 'RUNNING', errors: [] }),
    )
    const { container } = render(<StationErrorHandling />)
    await waitFor(() => expect(getSnapshot).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('releases the failed task occupancies with a reason before deciding, and warns on cancel', async () => {
    listOccupancies.mockResolvedValue([
      {
        uuid: 'lock-1',
        lockKey: '/devices/7b07fed4-aaaa',
        state: 'running',
        occupancyKind: 'execution_lock',
        scope: 'device',
        version: 't:7',
        taskUuid: 'task-1',
        materialUuid: null,
        deviceId: null,
      },
      {
        uuid: 'lock-2',
        lockKey: '/devices/other',
        state: 'running',
        occupancyKind: 'execution_lock',
        scope: 'device',
        version: 't:8',
        taskUuid: 'task-2',
        materialUuid: null,
        deviceId: null,
      },
    ])
    render(<StationErrorHandling />)
    expect(await screen.findByText(/逻辑占用：本任务 1 个，其他任务 1 个/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /执行锁/ }))
    const release = screen.getByRole('button', { name: /释放选中的 1 个占用/ })
    expect((release as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/释放原因/), { target: { value: '板已人工取下' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /可以交给其他任务/ }))
    fireEvent.click(release)
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0]![0]).toMatchObject({
      path: '/resource-dispositions',
      body: {
        decision_id: 'd1',
        occupancy_ids: ['lock-1'],
        expected_versions: { 'lock-1': 't:7' },
        reason: '板已人工取下',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /取消当前任务/ }))
    expect(await screen.findByText(/仍持有 1 个逻辑占用/)).toBeTruthy()
  })

  it('does not re-execute an action whose OS result is unknown and points to settling it first', async () => {
    getNodeJobDetail.mockResolvedValue(unknownResult)
    render(<StationErrorHandling />)
    expect(await screen.findByText('暂不能重新执行该动作')).toBeTruthy()
    expect(
      screen.getByText(/结果未知（ptlc_action_timeout）.*“现场已核对，按已取消收尾”/),
    ).toBeTruthy()
    expect(retryButton().disabled).toBe(true)
    expect(retryButton().getAttribute('aria-describedby')).toBeTruthy()
    fireEvent.click(retryButton())
    expect(screen.queryByRole('button', { name: '确认重新执行' })).toBeNull()
    expect(submit).not.toHaveBeenCalled()
    // 取消任务与进入手动处理不受影响。
    expect(
      (screen.getByRole('button', { name: /取消当前任务/ }) as HTMLButtonElement).disabled,
    ).toBe(false)
    expect(
      (screen.getByRole('button', { name: '进入手动处理' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('keeps blocking while the settle request waits for device-side confirmation', async () => {
    getNodeJobDetail.mockResolvedValue(
      job({
        ...unknownResult,
        controlData: {
          manual_resolution: { reason: '现场未动作', status: 'pending_edge_confirmation' },
        },
      }),
    )
    render(<StationErrorHandling />)
    expect(await screen.findByText(/已请求按“已取消”收尾，等待设备侧确认/)).toBeTruthy()
    expect(retryButton().disabled).toBe(true)
  })

  it('allows re-executing once the OS has settled the unknown result, ignoring the error text', async () => {
    getSnapshot.mockResolvedValue(
      decodeStationSnapshot({
        ...paused.raw,
        errors: [
          {
            ...(paused.raw.errors as Record<string, unknown>[])[0],
            meta_data: { message: '执行结果未知：job-1' },
          },
        ],
      }),
    )
    getNodeJobDetail.mockResolvedValue(unknownResult)
    render(<StationErrorHandling />)
    expect(await screen.findByText('暂不能重新执行该动作')).toBeTruthy()
    // 在任务详情中按已取消收尾后，OS 清除不确定原因；该任务的运行通知触发重读作业事实。
    getNodeJobDetail.mockResolvedValue(job({ status: 'canceled' }))
    listeners.forEach((listener) => listener(runtimeChanged('task-1')))
    await waitFor(() => expect(retryButton().disabled).toBe(false))
    expect(screen.queryByText('暂不能重新执行该动作')).toBeNull()
    fireEvent.click(retryButton())
    fireEvent.click(await screen.findByRole('button', { name: '确认重新执行' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0]![0]).toMatchObject({
      path: '/errors/d1/decision',
      body: { action: 'retry_current_node' },
    })
  })

  it('fails closed when the OS job facts cannot be read', async () => {
    getNodeJobDetail.mockRejectedValueOnce(new Error('OS 不可达'))
    render(<StationErrorHandling />)
    expect(await screen.findByText('读取出错动作的作业状态失败，暂不能重新执行')).toBeTruthy()
    expect(screen.getByText('OS 不可达')).toBeTruthy()
    expect(retryButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await waitFor(() => expect(retryButton().disabled).toBe(false))
    expect(getNodeJobDetail).toHaveBeenCalledTimes(2)
  })
})
