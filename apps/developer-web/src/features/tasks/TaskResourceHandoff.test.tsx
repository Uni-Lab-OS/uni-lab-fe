import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TransportError } from '@unilab-fe/core'
import {
  assessStoppedTaskResources,
  describeResourceRelease,
  needsResourceHandoff,
  TaskResourceHandoff,
} from './TaskResourceHandoff'

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

const { capability, listTaskExecutionLocks, unlockTaskResources, backend } = vi.hoisted(() => {
  const capability = { available: true }
  const listTaskExecutionLocks = vi.fn()
  const unlockTaskResources = vi.fn()
  return {
    capability,
    listTaskExecutionLocks,
    unlockTaskResources,
    backend: {
      getCapabilityStatus: () => capability,
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
  capability.available = true
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
  unlockTaskResources.mockReset().mockResolvedValue({
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

describe('resources after the operator stops a task', () => {
  it('derives the phase only from OS task and job facts and never offers an automatic release', () => {
    const running = { ...task, status: 'canceling', cleanupStatus: 'canceling' }
    expect(
      assessStoppedTaskResources(running, [{ status: 'cancel_requested' }, { status: 'canceled' }]),
    ).toEqual({
      phase: 'awaiting_terminal',
      inFlightJobs: 1,
      uncertainJobs: 0,
      quantityPending: false,
    })
    expect(assessStoppedTaskResources({ ...task, cleanupStatus: 'required' }, []).phase).toBe(
      'settling',
    )
    expect(assessStoppedTaskResources({ ...task, cleanupStatus: 'settled' }, []).phase).toBe(
      'released',
    )
    expect(
      assessStoppedTaskResources(task, [
        { status: 'failed', uncertaintyReason: 'ptlc_action_timeout' },
        { status: 'failed', uncertaintyReason: 'workflow_quantity_reconciliation_required' },
      ]),
    ).toEqual({ phase: 'needs_operator', inFlightJobs: 0, uncertainJobs: 2, quantityPending: true })
  })

  it('states what will be released', () => {
    expect(
      describeResourceRelease({
        taskStatus: 'canceled',
        activeDeviceTenancyCount: 1,
        locks: [{ scope: 'device' }, { scope: 'material_site' }, { scope: 'device' }] as never,
      }),
    ).toBe('3 个执行锁（设备 2、库位 1），1 个设备托管，该任务的物料预留、数量预留与调度许可')
    expect(describeResourceRelease(null)).toBe('该任务的物料预留、数量预留与调度许可')
  })

  it('shows progress and releases nothing while the OS has not confirmed the stop', () => {
    render(
      <TaskResourceHandoff
        task={{ ...task, status: 'canceling', cleanupStatus: 'canceling' }}
        jobs={[{ status: 'cancel_requested' }]}
        stopRequested
        onChanged={() => undefined}
      />,
    )
    expect(screen.getByText(/等待 OS 确认任务终态（当前：canceling）/)).toBeTruthy()
    expect(screen.getByText(/1 个设备动作仍在收尾/)).toBeTruthy()
    expect(listTaskExecutionLocks).not.toHaveBeenCalled()
    expect(unlockTaskResources).not.toHaveBeenCalled()
  })

  it('reports that the OS released everything when it settled the stop by itself', () => {
    render(
      <TaskResourceHandoff
        task={{ ...task, cleanupStatus: 'settled', attentionReason: null }}
        stopRequested
        onChanged={() => undefined}
      />,
    )
    expect(screen.getByText(/OS 已释放该任务的全部占用/)).toBeTruthy()
    expect(unlockTaskResources).not.toHaveBeenCalled()
  })

  it('prompts once with what will be released when the stopped task still holds resources', async () => {
    const onChanged = vi.fn()
    render(<TaskResourceHandoff task={task} stopRequested onChanged={onChanged} />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('任务已停止，但仍占用设备/物料')).toBeTruthy()
    expect(await within(dialog).findByText(/1 个执行锁（设备 1）/)).toBeTruthy()
    expect(unlockTaskResources).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByPlaceholderText(/已人工取下/), {
      target: { value: '板已取下' },
    })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /现场安全/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: /释放该任务的资源/ }))
    expect(
      await screen.findByText(/将整组释放：1 个执行锁（设备 1）.*释放后后续任务可以使用/),
    ).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '确认释放' }))
    await waitFor(() =>
      expect(unlockTaskResources).toHaveBeenCalledWith(
        'task-1',
        '板已取下',
        expect.stringContaining('task-1:unlock_resources:'),
      ),
    )
    expect(await screen.findByText(/OS 已释放该任务的资源占用/)).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('blocks the release while OS jobs are still in flight', async () => {
    render(
      <TaskResourceHandoff
        task={task}
        jobs={[{ status: 'running' }]}
        onChanged={() => undefined}
      />,
    )
    expect(await screen.findByText(/仍有 1 个设备动作未结束/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/已人工取下/), { target: { value: '核对' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /现场安全/ }))
    expect(
      (screen.getByRole('button', { name: /释放该任务的资源/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it("warns that releasing settles unknown results on the operator's on-site confirmation", async () => {
    render(
      <TaskResourceHandoff
        task={task}
        jobs={[{ status: 'failed', uncertaintyReason: 'ptlc_action_timeout' }]}
        onChanged={() => undefined}
      />,
    )
    expect(await screen.findByText('该任务有 1 个动作结果未知')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /结果未知的动作未执行或已安全停止/ })).toBeTruthy()
  })

  it('does not claim a release when the backend cannot unlock resources', () => {
    capability.available = false
    render(<TaskResourceHandoff task={task} stopRequested onChanged={() => undefined} />)
    expect(screen.getByText(/OS 仍保留它的设备\/物料占用（需要物料交接）/)).toBeTruthy()
    expect(screen.queryByText(/OS 已释放/)).toBeNull()
  })
})
