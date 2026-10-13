import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  WorkflowTaskCommandReceipt,
  WorkflowTaskExecutionLock,
  WorkflowTaskExecutionLockSnapshot,
} from '@unilab-fe/core'
import { BackendProvider } from '../../app/BackendProvider'
import { LocksTab } from './TaskDetailLocksTab'
import { createStudioBackendStub } from '../../../test/stationHandlingStub'

// 面板要连真实后端替身：缺了它 useBackendQuery 会打真网络，界面只会渲染成读取失败。
const executionRead = { getTaskExecutionLocks: vi.fn() }
const executionControl = { sendTaskCommand: vi.fn() }
const backend = createStudioBackendStub({ core: { executionRead, executionControl } })
vi.mock('../../app/backend', () => ({ createStudioBackend: () => backend }))

function makeLock(overrides: Partial<WorkflowTaskExecutionLock> = {}): WorkflowTaskExecutionLock {
  return {
    uuid: 'lock-1',
    workflowTaskUuid: 'task-1',
    workflowNodeJobUuid: 'job-1',
    lockKey: 'robot-1',
    scope: 'device',
    state: 'reserved',
    claimUuid: null,
    fencingToken: null,
    jobStatus: null,
    claimState: null,
    canRelease: false,
    releaseBlockReason: '锁仍被运行中的节点持有',
    ...overrides,
  }
}

function makeSnapshot(
  overrides: Partial<WorkflowTaskExecutionLockSnapshot> = {},
): WorkflowTaskExecutionLockSnapshot {
  return {
    kind: 'workflow_task_execution_lock_snapshot',
    source: 'os',
    workflowTaskUuid: 'task-1',
    taskStatus: 'failed',
    locks: [makeLock()],
    activeDeviceTenancyCount: 0,
    raw: {},
    ...overrides,
  }
}

function makeReceipt(
  overrides: Partial<WorkflowTaskCommandReceipt> = {},
): WorkflowTaskCommandReceipt {
  return {
    kind: 'workflow_task_command_receipt',
    commandUuid: 'command-1',
    workflowTaskUuid: 'task-1',
    type: 'unlock_resources',
    targetNodeUuid: null,
    idempotencyKey: 'idem-1',
    accepted: true,
    lifecycle: 'accepted',
    statusCode: 201,
    result: {},
    createdAt: null,
    updatedAt: null,
    raw: {},
    ...overrides,
  }
}

/** 填好说明、勾好现场确认，让「解除任务全部锁」可点。 */
function completeConfirmationForm(): void {
  fireEvent.change(screen.getByLabelText(/解锁说明/), {
    target: { value: '设备已停止，现场已核实' },
  })
  fireEvent.click(screen.getByLabelText(/我已现场确认/))
}

beforeEach(() => {
  vi.clearAllMocks()
  executionRead.getTaskExecutionLocks.mockResolvedValue(makeSnapshot())
  executionControl.sendTaskCommand.mockResolvedValue(makeReceipt())
})

describe('任务级整组解锁面板', () => {
  it('已完成的任务没有解锁入口，但必须说明原因', async () => {
    executionRead.getTaskExecutionLocks.mockResolvedValue(makeSnapshot({ taskStatus: 'succeeded' }))
    render(<LocksTab taskUuid="task-1" />, { wrapper: BackendProvider })

    // 门禁不通过时必须显示 reason，不能只把按钮禁用。
    expect(await screen.findByText(/只有异常终态/)).toBeInTheDocument()
    expect(screen.getByText(/「已完成」/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /解除任务全部锁/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/解锁说明/)).not.toBeInTheDocument()
  })

  it('没有任何可解资源时只留一句空态，不再解释门禁', async () => {
    executionRead.getTaskExecutionLocks.mockResolvedValue(
      makeSnapshot({ taskStatus: 'failed', locks: [], activeDeviceTenancyCount: 0 }),
    )
    render(<LocksTab taskUuid="task-1" />, { wrapper: BackendProvider })

    const empty = await screen.findByText('暂无执行锁。')
    // 空态必须挂在这个 tab 自己的次级说明 class 上（它是唯一带正确字号的局部覆盖），
    // 不能退回与资源空态共享的 debug-empty-state。
    expect(empty.className).toContain('debug-lock-empty-state')
    expect(screen.queryByText(/可整组解锁|当前不能整组解锁/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/解锁说明/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重新读取锁状态/ })).not.toBeInTheDocument()
  })

  it('失败且有锁时出现确认表单，只填说明不勾选则不能提交', async () => {
    render(<LocksTab taskUuid="task-1" />, { wrapper: BackendProvider })

    const textarea = await screen.findByLabelText(/解锁说明/)
    const submit = screen.getByRole('button', { name: /解除任务全部锁/ })
    expect(submit).toBeDisabled()

    fireEvent.change(textarea, { target: { value: '设备已停止，现场已核实' } })
    // 说明填了但没勾现场确认 → 仍然不能提交。
    expect(submit).toBeDisabled()

    fireEvent.click(screen.getByLabelText(/我已现场确认/))
    expect(submit).toBeEnabled()
  })

  it('提交时下发 unlock_resources 并带上物理安全确认', async () => {
    render(<LocksTab taskUuid="task-1" />, { wrapper: BackendProvider })
    await screen.findByLabelText(/解锁说明/)
    completeConfirmationForm()

    fireEvent.click(screen.getByRole('button', { name: /解除任务全部锁/ }))

    await waitFor(() => expect(executionControl.sendTaskCommand).toHaveBeenCalledTimes(1))
    const [uuid, request] = executionControl.sendTaskCommand.mock.calls[0] as [
      string,
      {
        type: string
        idempotencyKey: string
        description: string
        metadata: Record<string, unknown>
      },
    ]
    expect(uuid).toBe('task-1')
    expect(request.type).toBe('unlock_resources')
    expect(request.description).toBe('设备已停止，现场已核实')
    expect(typeof request.idempotencyKey).toBe('string')
    // OS 缺这个字段会直接 invalid_input，所以它不能是可选的。
    expect(request.metadata.confirmed_physical_safe).toBe(true)

    // 回执只是 accepted：只能说"仍在处理中"，不能出现成功文案。
    expect(await screen.findByText('解锁命令仍在处理中，尚未确认资源释放')).toBeInTheDocument()
    expect(screen.queryByText(/已释放 \d+ 把执行锁/)).not.toBeInTheDocument()
  })

  it('被拒绝时显示 OS 给出的中文原因，且不显示任何成功文案', async () => {
    executionControl.sendTaskCommand.mockResolvedValue(
      makeReceipt({
        lifecycle: 'rejected',
        result: { reason: 'task_is_not_abnormal_terminal' },
      }),
    )
    render(<LocksTab taskUuid="task-1" />, { wrapper: BackendProvider })
    await screen.findByLabelText(/解锁说明/)
    completeConfirmationForm()

    fireEvent.click(screen.getByRole('button', { name: /解除任务全部锁/ }))

    expect(await screen.findByText('任务不是异常终态，不能整组解锁')).toBeInTheDocument()
    expect(screen.queryByText(/已释放 \d+ 把执行锁/)).not.toBeInTheDocument()
    expect(screen.queryByText(/整组解锁命令已生效/)).not.toBeInTheDocument()
  })

  it('成功时按重读后的快照算释放数量，并重读任务详情', async () => {
    const onReloadTaskDetail = vi.fn().mockResolvedValue(undefined)
    executionControl.sendTaskCommand.mockResolvedValue(makeReceipt({ lifecycle: 'applied' }))
    executionRead.getTaskExecutionLocks
      .mockResolvedValueOnce(
        makeSnapshot({ locks: [makeLock(), makeLock({ uuid: 'lock-2', lockKey: 'robot-2' })] }),
      )
      // 命令生效后的重读：锁已经没了。
      .mockResolvedValue(makeSnapshot({ locks: [] }))

    render(<LocksTab taskUuid="task-1" onReloadTaskDetail={onReloadTaskDetail} />, {
      wrapper: BackendProvider,
    })
    await screen.findByLabelText(/解锁说明/)
    completeConfirmationForm()

    fireEvent.click(screen.getByRole('button', { name: /解除任务全部锁/ }))

    expect(
      await screen.findByText('已释放 2 把执行锁；锁状态以刷新后的列表为准'),
    ).toBeInTheDocument()
    // 命令回执不是终态：必须重读任务详情。
    expect(onReloadTaskDetail).toHaveBeenCalledTimes(1)
    // 锁已经没了，面板回到空态；但收尾提示不能被空态吃掉。
    expect(await screen.findByText('暂无执行锁。')).toBeInTheDocument()
  })
})
