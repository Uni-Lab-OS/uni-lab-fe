import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { decodeStationSnapshot, StationErrorHandlingClient, TransportError } from '@unilab-fe/core'
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

const { getSnapshot, submit, listOccupancies, backend } = vi.hoisted(() => {
  const getSnapshot = vi.fn()
  const submit = vi.fn()
  const listOccupancies = vi.fn()
  return {
    getSnapshot,
    submit,
    listOccupancies,
    backend: {
      getCapabilityStatus: () => ({ available: true }),
      core: { stationErrorHandling: {} as Record<string, unknown> },
    },
  }
})
vi.mock('../../app/BackendProvider', () => ({ useBackend: () => ({ backend, readyEpoch: 0 }) }))

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
    fireEvent.click(screen.getByRole('button', { name: /重新执行该动作/ }))
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

  it('warns before retrying a node whose device result is unknown', async () => {
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
    render(<StationErrorHandling />)
    expect(await screen.findByText('该节点的设备动作结果未知')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /重新执行该动作/ }))
    expect(await screen.findByText(/确认已核对现场并完成收尾/)).toBeTruthy()
  })
})
