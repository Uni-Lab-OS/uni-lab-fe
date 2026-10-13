import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StationDecisionPanel } from './StationDecisionPanel'
import { StationHandlingSection } from './StationHandlingSection'
import { StationResumeCard } from './StationResumeCard'
import {
  createStationPortStub,
  createStudioBackendStub,
  makeStationError,
  makeStationSnapshot,
  StationProviders,
} from '../../../test/stationHandlingStub'

const stationPort = createStationPortStub()
const backend = createStudioBackendStub({ core: { stationErrorHandling: stationPort } })
vi.mock('../../app/backend', () => ({ createStudioBackend: () => backend }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('station decision panel', () => {
  it('submits the node decision without bundling the station-level resume', async () => {
    const error = makeStationError()
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({ mode: 'PAUSED', errors: [error] }),
    )
    render(<StationDecisionPanel error={error} />, { wrapper: StationProviders })
    await waitFor(() => expect(screen.getByText('异常处理')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '重试节点' }))

    await waitFor(() => expect(stationPort.decide).toHaveBeenCalledTimes(1))
    // 节点决定只决定节点：恢复是工站级事实，绝不跟着这次提交一起下发。
    expect(stationPort.decide.mock.calls[0][1]).toMatchObject({
      action: 'retry_current_node',
      resumeRequested: false,
      operatorConfirmed: false,
    })
  })

  it('states the station gate as a fact, and only offers resume when nothing is left', async () => {
    const error = makeStationError()

    // 还有错误待决定：只陈述当前门禁状态，不给按钮，也不给勾选框。
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({ mode: 'PAUSED', errors: [error] }),
    )
    const blocked = render(<StationResumeCard />, { wrapper: StationProviders })
    await waitFor(() => expect(screen.getByText(/还有错误等待决定/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '恢复工站调度' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('我已核对现场，确认可以恢复工站工作流调度')).toBeNull()
    blocked.unmount()

    // 错误都处置完了：出现恢复入口，且必须先做现场确认。
    stationPort.getSnapshot.mockResolvedValue(makeStationSnapshot({ mode: 'PAUSED', errors: [] }))
    render(<StationResumeCard />, { wrapper: StationProviders })
    const resumeButton = await screen.findByRole('button', { name: '恢复工站调度' })
    expect(resumeButton).toBeDisabled()
    fireEvent.click(screen.getByLabelText('我已核对现场，确认可以恢复工站工作流调度'))
    expect(resumeButton).toBeEnabled()
    fireEvent.click(resumeButton)
    await waitFor(() => expect(stationPort.resume).toHaveBeenCalledTimes(1))
  })

  it('collapses a terminal task error to a single close action', async () => {
    const error = makeStationError()
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({ mode: 'PAUSED', errors: [error] }),
    )
    render(<StationDecisionPanel error={error} taskStatus="canceled" />, {
      wrapper: StationProviders,
    })
    await waitFor(() => expect(screen.getByText(/任务已结束/)).toBeInTheDocument())

    // 任务已取消：重试与手动处理都是死路，不能出现。
    expect(screen.queryByRole('button', { name: '重试节点' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '手动处理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消任务' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭异常事实' }))
    await waitFor(() => expect(stationPort.decide).toHaveBeenCalledTimes(1))
    // 关闭动作走 OS 的 cancel_task 语义（它同时收尾该任务剩余的错误事实）。
    expect(stationPort.decide.mock.calls[0][1]).toMatchObject({
      action: 'cancel_task',
      resumeRequested: false,
      operatorConfirmed: false,
    })
  })

  it('keeps the full decision space while the task is still running', async () => {
    const error = makeStationError()
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({ mode: 'PAUSED', errors: [error] }),
    )
    render(<StationDecisionPanel error={error} taskStatus="running" />, {
      wrapper: StationProviders,
    })
    await waitFor(() => expect(screen.getByText('异常处理')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '重试节点' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关闭异常事实' })).not.toBeInTheDocument()
  })

  it('never submits a destructive cancel without an explicit inline confirmation', async () => {
    const error = makeStationError()
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({ mode: 'PAUSED', errors: [error] }),
    )
    render(<StationDecisionPanel error={error} />, { wrapper: StationProviders })
    await waitFor(() => expect(screen.getByText('异常处理')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '取消任务' }))
    expect(stationPort.decide).not.toHaveBeenCalled()
    expect(screen.getByText(/无法撤销/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认取消任务' }))
    await waitFor(() => expect(stationPort.decide).toHaveBeenCalledTimes(1))
    expect(stationPort.decide.mock.calls[0][1]).toMatchObject({
      action: 'cancel_task',
      resumeRequested: false,
      operatorConfirmed: false,
    })
  })

  it('stays read-only while the decision is being applied', async () => {
    const error = makeStationError({ stage: 'APPLYING' })
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({ mode: 'PAUSED', errors: [error] }),
    )
    render(<StationDecisionPanel error={error} />, { wrapper: StationProviders })
    await waitFor(() => expect(screen.getByText('已受理，正在应用')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '重试节点' })).not.toBeInTheDocument()
    expect(stationPort.decide).not.toHaveBeenCalled()
  })

  it('offers the OS-declared manual handling option and never invents one', async () => {
    const error = makeStationError()
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({ mode: 'PAUSED', errors: [error] }),
    )
    render(<StationDecisionPanel error={error} />, { wrapper: StationProviders })
    await waitFor(() => expect(screen.getByText('异常处理')).toBeInTheDocument())

    // 文案来自 OS 的 options，不是前端自己起的名字。
    fireEvent.click(screen.getByRole('button', { name: '手动处理' }))
    await waitFor(() => expect(stationPort.decide).toHaveBeenCalledTimes(1))
    expect(stationPort.decide.mock.calls[0][1]).toMatchObject({
      action: 'enter_manual_handling',
      // 进入手动处理时不能顺带恢复调度，工站必须保持暂停。
      resumeRequested: false,
      operatorConfirmed: false,
    })
  })

  it('hides the manual entry when the OS does not declare it', async () => {
    const error = makeStationError({ options: [{ id: 'cancel_task', label: '取消当前任务' }] })
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({ mode: 'PAUSED', errors: [error] }),
    )
    render(<StationDecisionPanel error={error} />, { wrapper: StationProviders })
    await waitFor(() => expect(screen.getByText('异常处理')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: '手动处理' })).not.toBeInTheDocument()
  })

  it('returns to the same session instead of a doomed second enter', async () => {
    const error = makeStationError({ sessionId: 'session-1' })
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({
        mode: 'PAUSED',
        errors: [error],
        activeSessionId: 'session-1',
        activeSession: {
          kind: 'station_handling_session',
          source: 'os',
          sessionId: 'session-1',
          decisionId: error.decisionId,
          stage: 'MANUAL_HANDLING',
          version: 3,
          summary: '',
          raw: {},
        },
      }),
    )
    render(<StationDecisionPanel error={error} />, { wrapper: StationProviders })
    await waitFor(() => expect(screen.getByText('异常处理')).toBeInTheDocument())

    // 会话已存在时 OS 会拒绝 enter，界面只能提供「返回手动处理」。
    expect(screen.queryByRole('button', { name: '手动处理' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回手动处理' }))
    await waitFor(() => expect(stationPort.returnSession).toHaveBeenCalledTimes(1))
    expect(stationPort.returnSession.mock.calls[0][0]).toBe('session-1')
    expect(stationPort.returnSession.mock.calls[0][1]).toMatchObject({ expectedSessionVersion: 3 })
  })

  it('opens the manual handling dialog for the active session and completes it', async () => {
    const error = makeStationError({ stage: 'MANUAL_HANDLING', sessionId: 'session-1' })
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({
        mode: 'PAUSED',
        errors: [error],
        activeSessionId: 'session-1',
        activeSession: {
          kind: 'station_handling_session',
          source: 'os',
          sessionId: 'session-1',
          decisionId: error.decisionId,
          stage: 'MANUAL_HANDLING',
          version: 2,
          summary: '',
          raw: {},
        },
      }),
    )
    render(<StationDecisionPanel error={error} />, { wrapper: StationProviders })

    await waitFor(() => expect(screen.getByText('人工处置中')).toBeInTheDocument())
    // 会话身份必须显示出来，便于和 OS 控制台上的同一条会话对齐。
    expect(screen.getByText(/处置会话 session-/)).toBeInTheDocument()
    // 进入人工处置后弹窗自动打开：点了「手动处理」不该什么都不发生。
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText('处理操作')).toBeInTheDocument()

    // 处理说明必填：没填之前不能提交。
    // antd 默认给两个汉字的按钮插一个空格（应用没关 autoInsertSpace），所以按渲染结果匹配。
    const submit = screen.getByRole('button', { name: /提\s*交/ })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('做了什么、现场现在什么状态'), {
      target: { value: '夹爪内无残留，注粉瓶已放回 L2C2。' },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /提\s*交/ })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))
    await waitFor(() => expect(stationPort.completeSession).toHaveBeenCalledTimes(1))
    expect(stationPort.completeSession.mock.calls[0][0]).toBe('session-1')
    expect(stationPort.completeSession.mock.calls[0][1]).toMatchObject({
      expectedSessionVersion: 2,
      summary: '夹爪内无残留，注粉瓶已放回 L2C2。',
    })
  })

  it('refuses to open the dialog when the active session belongs to another error', async () => {
    const error = makeStationError({ stage: 'MANUAL_HANDLING', sessionId: 'session-9' })
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({
        mode: 'PAUSED',
        errors: [error],
        activeSessionId: 'session-9',
        activeSession: {
          kind: 'station_handling_session',
          source: 'os',
          sessionId: 'session-9',
          decisionId: 'decision-other',
          stage: 'MANUAL_HANDLING',
          version: 3,
          summary: '',
          raw: {},
        },
      }),
    )
    render(<StationDecisionPanel error={error} />, { wrapper: StationProviders })

    await waitFor(() => expect(screen.getByText(/会话与这条错误对不上/)).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(stationPort.completeSession).not.toHaveBeenCalled()
  })

  it('blocks a decision when another error holds the single station session', async () => {
    const error = makeStationError()
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({
        mode: 'PAUSED',
        errors: [error],
        activeSessionId: 'session-9',
        activeSession: {
          kind: 'station_handling_session',
          source: 'os',
          sessionId: 'session-9',
          decisionId: 'decision-9',
          stage: 'MANUAL_HANDLING',
          version: 1,
          summary: '',
          raw: {},
        },
      }),
    )
    render(<StationDecisionPanel error={error} />, { wrapper: StationProviders })
    await waitFor(() => expect(screen.getByText('暂时不能处置这条错误')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '重试节点' })).not.toBeInTheDocument()
  })
})

describe('station handling section', () => {
  const stationError = makeStationError({ sourceTaskUuid: 'task-1' })
  const otherError = makeStationError({
    decisionId: 'decision-2',
    sourceTaskUuid: 'task-2',
    sourceJobUuid: 'job-2',
    message: '夹爪未到位',
  })

  it('lists errors across tasks so a single task page never hides the rest', async () => {
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({ mode: 'PAUSED', errors: [stationError, otherError] }),
    )
    const onOpenTask = vi.fn()
    render(
      <StationHandlingSection
        taskNames={
          new Map([
            ['task-1', '错误处置验收'],
            ['task-2', 'S08 开关盖联调'],
          ])
        }
        onOpenTask={onOpenTask}
      />,
      { wrapper: StationProviders },
    )

    await waitFor(() => expect(screen.getByText('工站调度已暂停')).toBeInTheDocument())
    expect(screen.getByText(/错误处置验收/)).toBeInTheDocument()
    expect(screen.getByText(/S08 开关盖联调/)).toBeInTheDocument()
    expect(screen.queryByText('其他任务')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /夹爪未到位/ }))
    expect(onOpenTask).toHaveBeenCalledWith('task-2')
  })

  it('stays invisible while the station is healthy', async () => {
    stationPort.getSnapshot.mockResolvedValue(makeStationSnapshot({ mode: 'RUNNING' }))
    const { container } = render(
      <StationHandlingSection taskNames={new Map()} onOpenTask={vi.fn()} />,
      { wrapper: StationProviders },
    )
    await waitFor(() => expect(stationPort.getSnapshot).toHaveBeenCalled())
    // 异常处置不该在总览上常年占一块「工站运行中」的噪音。
    expect(container).toBeEmptyDOMElement()
  })

  it('falls back to a locatable short id when the task is not in the projection', async () => {
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({
        mode: 'PAUSED',
        errors: [makeStationError({ sourceTaskUuid: 'abcdef12-3456' })],
      }),
    )
    render(<StationHandlingSection taskNames={new Map()} onOpenTask={vi.fn()} />, {
      wrapper: StationProviders,
    })
    await waitFor(() => expect(screen.getByText(/任务 abcdef12/)).toBeInTheDocument())
    expect(screen.queryByText(/其他任务/)).not.toBeInTheDocument()
  })

  it('requires the field confirmation before resuming the station', async () => {
    stationPort.getSnapshot.mockResolvedValue(makeStationSnapshot({ mode: 'PAUSED' }))
    stationPort.resume.mockResolvedValue({ ...makeStationReceiptResume() })
    render(<StationHandlingSection taskNames={new Map()} onOpenTask={vi.fn()} />, {
      wrapper: StationProviders,
    })

    const resumeButton = await screen.findByRole('button', { name: '恢复工站调度' })
    expect(resumeButton).toBeDisabled()
    fireEvent.click(screen.getByLabelText('我已核对现场，确认可以恢复工站工作流调度'))
    expect(resumeButton).toBeEnabled()

    fireEvent.click(resumeButton)
    await waitFor(() => expect(stationPort.resume).toHaveBeenCalledTimes(1))
    expect(stationPort.resume.mock.calls[0][0]).toMatchObject({ operatorConfirmed: true })
  })

  it('does not offer resume while errors or unapplied commands remain', async () => {
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({
        mode: 'PAUSED',
        controlCommands: [
          {
            commandUuid: 'cmd-1',
            operation: 'retry_current_node',
            status: 'PENDING',
            needsApply: true,
          },
        ],
      }),
    )
    render(
      <StationHandlingSection taskNames={new Map([['task-1', '任务一']])} onOpenTask={vi.fn()} />,
      {
        wrapper: StationProviders,
      },
    )

    await waitFor(() => expect(screen.getByText(/操作已受理，尚未生效/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '恢复工站调度' })).not.toBeInTheDocument()
    // 已受理未生效的命令必须能在本前端继续应用，而不是把用户赶去 OS 控制台。
    const applyButton = screen.getByRole('button', { name: '继续应用' })
    expect(applyButton).toBeInTheDocument()
    fireEvent.click(applyButton)
    await waitFor(() => expect(stationPort.applyControlCommand).toHaveBeenCalledWith('cmd-1'))
  })
})

function makeStationReceiptResume() {
  return {
    kind: 'station_command_receipt' as const,
    source: 'os' as const,
    commandUuid: 'command-1',
    operation: 'resume',
    status: 'APPLIED' as const,
    snapshot: null,
    applicationError: null,
    dispatchError: null,
    raw: {},
  }
}
