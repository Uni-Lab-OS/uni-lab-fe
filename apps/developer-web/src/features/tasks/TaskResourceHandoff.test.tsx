import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TransportError } from '@unilab-fe/core'
import { needsResourceHandoff, TaskResourceHandoff } from './TaskResourceHandoff'

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

const { listTaskExecutionLocks, unlockTaskResources, backend } = vi.hoisted(() => {
  const listTaskExecutionLocks = vi.fn()
  const unlockTaskResources = vi.fn()
  return {
    listTaskExecutionLocks,
    unlockTaskResources,
    backend: {
      getCapabilityStatus: () => ({ available: true }),
      core: { executionRecovery: { listTaskExecutionLocks, unlockTaskResources } },
    },
  }
})
vi.mock('../../app/BackendProvider', () => ({ useBackend: () => ({ backend }) }))

const task = {
  taskUuid: 'task-1',
  status: 'canceled',
  cleanupStatus: 'requires_attention',
  attentionReason: 'resource_handoff_required',
  updatedAt: 't1',
}

beforeEach(() => {
  listTaskExecutionLocks.mockReset().mockResolvedValue({
    taskStatus: 'canceled',
    activeDeviceTenancyCount: 0,
    locks: [
      {
        uuid: 'l1',
        lockKey: '/devices/abc',
        scope: 'device',
        state: 'running',
        jobUuid: 'j1',
        jobStatus: 'failed',
        canRelease: false,
        releaseBlockReason: 'x',
      },
    ],
  })
  unlockTaskResources
    .mockReset()
    .mockResolvedValue({
      kind: 'task_resource_unlock',
      commandUuid: 'c1',
      status: 'succeeded',
      rejectReason: null,
      result: {},
    })
})

const fill = () => {
  fireEvent.change(screen.getByPlaceholderText(/已人工取下/), { target: { value: '板已取下' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /现场安全/ }))
  fireEvent.click(screen.getByRole('button', { name: /释放该任务的资源/ }))
}

describe('TaskResourceHandoff', () => {
  it('only appears for abnormal terminal tasks that the OS marked for attention', () => {
    expect(needsResourceHandoff(task)).toBe(true)
    expect(needsResourceHandoff({ ...task, status: 'running' })).toBe(false)
    expect(needsResourceHandoff({ ...task, cleanupStatus: 'completed' })).toBe(false)
  })

  it('lists the held locks and releases them after reason and confirmation, then rereads the task', async () => {
    const onChanged = vi.fn()
    render(<TaskResourceHandoff task={task} onChanged={onChanged} />)
    expect(await screen.findByText('/devices/abc')).toBeTruthy()
    fill()
    fireEvent.click(await screen.findByRole('button', { name: '确认释放' }))
    await waitFor(() =>
      expect(unlockTaskResources).toHaveBeenCalledWith(
        'task-1',
        '板已取下',
        expect.stringContaining('task-1:unlock_resources:'),
      ),
    )
    expect(await screen.findByText(/OS 已释放/)).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows an OS rejection and resends an ambiguous attempt with the same key', async () => {
    unlockTaskResources
      .mockRejectedValueOnce(new TransportError({ code: 'network', message: 'timeout', status: 0 }))
      .mockResolvedValueOnce({
        kind: 'task_resource_unlock',
        commandUuid: 'c1',
        status: 'rejected',
        rejectReason: '任务仍有已派发或运行中的作业',
        result: {},
      })
    render(<TaskResourceHandoff task={task} onChanged={() => undefined} />)
    await screen.findByText('/devices/abc')
    fill()
    fireEvent.click(await screen.findByRole('button', { name: '确认释放' }))
    expect(await screen.findByText(/结果不明确/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /释放该任务的资源/ }))
    fireEvent.click(await screen.findByRole('button', { name: '确认释放' }))
    expect(await screen.findByText(/OS 拒绝释放：任务仍有已派发或运行中的作业/)).toBeTruthy()
    expect(unlockTaskResources.mock.calls[1]![2]).toBe(unlockTaskResources.mock.calls[0]![2])
  })
})
