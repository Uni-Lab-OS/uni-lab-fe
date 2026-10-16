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

const { getSnapshot, submit, backend } = vi.hoisted(() => {
  const getSnapshot = vi.fn()
  const submit = vi.fn()
  return {
    getSnapshot,
    submit,
    backend: {
      getCapabilityStatus: () => ({ available: true }),
      core: { stationErrorHandling: {} as Record<string, unknown> },
    },
  }
})
vi.mock('../../app/BackendProvider', () => ({ useBackend: () => ({ backend, readyEpoch: 0 }) }))

beforeEach(() => {
  const real = new StationErrorHandlingClient({ request: vi.fn() } as never, 'local', '/api/v1', () => 'key-1')
  getSnapshot.mockReset().mockResolvedValue(paused)
  submit.mockReset().mockResolvedValue({})
  backend.core.stationErrorHandling = {
    getSnapshot,
    submit,
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
    fireEvent.click(screen.getByRole('button', { name: /重试当前节点/ }))
    fireEvent.click(await screen.findByRole('button', { name: '确认重试' }))
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
    submit.mockRejectedValueOnce(new TransportError({ code: 'network', message: '请求已中止或超时' }))
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
})
