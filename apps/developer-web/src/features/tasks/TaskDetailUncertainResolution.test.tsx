import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkflowDebugTimelineItem, WorkflowNodeJobDetail } from '@unilab-fe/core'
import { UncertainJobResolution } from './TaskDetailUncertainResolution'
import { toTimelineEvent } from './taskDetailModel'

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

const { capability, backend } = vi.hoisted(() => {
  const capability = { available: true, reason: undefined as string | undefined }
  return { capability, backend: { getCapabilityStatus: () => capability } }
})
vi.mock('../../app/BackendProvider', () => ({ useBackend: () => ({ backend }) }))

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
  topologicalIndex: 0,
  executorKind: 'device_action',
  executionPolicy: {},
  executionTimeoutSeconds: null,
  status: 'running',
  attempt: 1,
  param: {},
  feedbackData: {},
  returnInfo: {},
  controlData: {},
  errorInfo: [],
  uncertaintyReason: 'ptlc_action_timeout',
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

beforeEach(() => {
  capability.available = true
  capability.reason = undefined
})

describe('UncertainJobResolution', () => {
  it('requires an on-site conclusion and confirmation before requesting a canceled resolution', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined)
    render(<UncertainJobResolution job={job()} onResolve={onResolve} />)
    expect(screen.getByText('设备动作结果未知，需现场核对')).toBeTruthy()
    const submit = screen.getByRole('button', { name: /按已取消收尾/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '现场确认夹爪未动作' } })
    fireEvent.click(screen.getByRole('button', { name: /按已取消收尾/ }))
    fireEvent.click(await screen.findByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('job-1', '现场确认夹爪未动作'))
  })

  it('shows the OS refusal instead of hiding it', async () => {
    const onResolve = vi.fn().mockRejectedValue(new Error('作业不是等待物理对账的运行中或失败作业'))
    render(<UncertainJobResolution job={job()} onResolve={onResolve} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '核对' } })
    fireEvent.click(screen.getByRole('button', { name: /按已取消收尾/ }))
    fireEvent.click(await screen.findByRole('button', { name: '确认提交' }))
    expect(await screen.findByText('作业不是等待物理对账的运行中或失败作业')).toBeTruthy()
  })

  it('shows a pending request and hides the form once the OS recorded it', () => {
    render(
      <UncertainJobResolution
        job={job({
          controlData: {
            manual_resolution: { reason: '已核对', status: 'pending_edge_confirmation' },
          },
        })}
        onResolve={vi.fn()}
      />,
    )
    expect(screen.getByText('已请求按“已取消”收尾，等待设备侧确认')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('stays hidden for certain jobs and refuses when the capability is not declared', () => {
    const { container } = render(
      <UncertainJobResolution job={job({ uncertaintyReason: null })} onResolve={vi.fn()} />,
    )
    expect(container.textContent).toBe('')
    capability.available = false
    capability.reason = 'Uni-Lab OS 尚未声明 workflow.resolveUncertain 能力'
    render(<UncertainJobResolution job={job()} onResolve={vi.fn()} />)
    expect(screen.getByText('当前后端未声明结果未知处置能力')).toBeTruthy()
  })
})

describe('timeline uncertainty', () => {
  const item: WorkflowDebugTimelineItem = {
    jobUuid: 'job-1',
    workflowNodeUuid: 'node-1',
    nodeLabel: '收集-夹紧',
    status: 'running',
    attempt: 1,
    topologicalIndex: 0,
    executorKind: 'device_action',
    startedAt: null,
    finishedAt: null,
    waitReason: {},
    errorInfo: [],
    uncertaintyReason: 'ptlc_action_timeout',
  }

  it('shows an OS-uncertain running job as unknown rather than running', () => {
    expect(toTimelineEvent(item)).toMatchObject({
      status: 'unknown',
      description: expect.stringContaining('结果未知'),
    })
    expect(toTimelineEvent({ ...item, uncertaintyReason: null }).status).toBe('running')
  })
})
