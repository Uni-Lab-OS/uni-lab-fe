import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type {
  NodeJobFeedbackPage,
  WorkflowExecutionLockFact,
  WorkflowNodeJobDetail,
  WorkflowRecoveryFact,
  WorkflowResourceWaitFact,
} from '@unilab-fe/core'
import { IssuesTab } from './TaskDetailIssuesTab'
import { LocksTab } from './TaskDetailLocksTab'
import { ObservabilityTab } from './TaskDetailObservabilityTab'
import { ResourcesTab } from './TaskDetailResourcesTab'
import { TaskExecutionTimeline, type TaskExecutionTimelineItem } from './TaskExecutionTimeline'
import type { TimelineEvent } from './taskDetailModel'

const event = (status: TimelineEvent['status']): TimelineEvent => ({
  id: 'job-1',
  time: '10:00:00',
  title: '移动',
  group: 'device',
  description: '',
  status,
  device: 'robot-1',
  duration: '1 秒',
})

const timelineItem: TaskExecutionTimelineItem = {
  id: 'job-1',
  time: '10:00:00',
  title: '移动',
  status: 'running',
  device: 'robot-1',
  duration: '执行中',
  progress: 140,
}

const lock = (overrides: Partial<WorkflowExecutionLockFact> = {}): WorkflowExecutionLockFact => ({
  lockUuid: 'lock-1',
  jobUuid: 'job-1',
  lockKey: 'robot-1',
  scope: 'device',
  claimUuid: null,
  fencingToken: null,
  state: 'reserved',
  canRelease: false,
  blockingReasons: [],
  raw: {},
  ...overrides,
})

const recovery: WorkflowRecoveryFact = {
  executionUnknown: false,
  requiresReconciliation: false,
  locks: [],
  raw: {},
}

const feedback: NodeJobFeedbackPage = {
  items: [
    {
      kind: 'node_job_feedback',
      source: 'os',
      feedbackUuid: 'feedback-1',
      jobUuid: 'job-1',
      sequence: 3,
      feedbackType: 'progress',
      data: { percent: 50 },
      observedAt: '2026-10-10T10:00:00Z',
      receivedAt: '2026-10-10T10:00:01Z',
      publishedAt: null,
      idempotencyKey: 'feedback-1',
      description: '半程',
      metadata: {},
      raw: {},
    },
  ],
  nextCursor: 3,
  hasMore: false,
  raw: {},
}

describe('developer-web task inspector components', () => {
  it('keeps timeline loading, empty, selection and progress states observable', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<TaskExecutionTimeline items={[]} loading />)
    expect(screen.getByRole('status', { name: '正在加载执行时间线' })).toBeInTheDocument()

    rerender(<TaskExecutionTimeline items={[]} empty={<span>没有节点</span>} />)
    expect(screen.getByText('没有节点')).toBeInTheDocument()

    rerender(<TaskExecutionTimeline items={[timelineItem]} onSelect={onSelect} />)
    const row = screen.getByRole('button', { name: /移动/ })
    expect(row).toHaveAttribute('data-status', 'running')
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith(timelineItem)
  })

  it.each([
    ['manual', '需要人工确认'],
    ['unknown', '结果待核对'],
    ['waiting', '等待资源'],
    ['success', '没有待处理异常'],
  ] as const)('renders the %s issue state without collapsing it into failure', (status, label) => {
    render(<IssuesTab event={event(status)} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows resource absence, explicit site facts and no-inventory diagnostics', () => {
    const waits: WorkflowResourceWaitFact[] = []
    const { rerender } = render(<ResourcesTab waits={waits} job={null} />)
    expect(screen.getByText('暂无资源等待。')).toBeInTheDocument()

    const siteJob = {
      controlData: {},
      raw: { expected_change_set: { kind: 'material_transfer', target_site_uuid: 'site-1' } },
      status: 'succeeded',
    } as unknown as WorkflowNodeJobDetail
    rerender(<ResourcesTab waits={waits} job={siteJob} />)
    expect(screen.getByText('库位图')).toBeInTheDocument()

    const noInventoryJob = {
      controlData: {},
      raw: { expected_change_set: { kind: 'no_inventory_change' } },
      status: 'succeeded',
    } as unknown as WorkflowNodeJobDetail
    rerender(<ResourcesTab waits={waits} job={noInventoryJob} />)
    expect(screen.getByText(/不产生物料库位占用/)).toBeInTheDocument()
  })

  it('keeps lock release fail-closed and preserves feedback or empty states', () => {
    const releaseable = lock({ canRelease: true })
    const { rerender } = render(<LocksTab locks={[releaseable]} recovery={recovery} />)
    expect(screen.getByText('可释放执行锁')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /人工解除整组锁/ })).toBeDisabled()

    rerender(<LocksTab locks={[]} recovery={recovery} />)
    expect(screen.getByText('暂无执行锁快照。')).toBeInTheDocument()

    rerender(<ObservabilityTab feedback={feedback} />)
    expect(screen.getByText('1 条反馈')).toBeInTheDocument()
    expect(screen.getByText('半程')).toBeInTheDocument()
    rerender(<ObservabilityTab feedback={null} />)
    expect(screen.getByText('暂无反馈事件。')).toBeInTheDocument()
  })
})
