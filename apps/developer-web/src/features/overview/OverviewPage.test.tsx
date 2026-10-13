import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { OverviewPage } from './OverviewPage'
import {
  createStationPortStub,
  createStudioBackendStub,
  makeStationReceipt,
  makeStationSnapshot,
  StationProviders,
} from '../../../test/stationHandlingStub'

// 只替换 Modal 组件本身：这里断言的是总览对 `open` 的推导（工站不再需要决策
// 就必须收起），而不是 antd 自己的离场动画 —— 动画与真实点击由 e2e 覆盖。
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  const Dialog = ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null
  return { ...actual, Modal: Object.assign(Dialog, { confirm: actual.Modal.confirm }) }
})

// 总览的任务表格用 antd 的响应式栅格读断点；jsdom 没有 matchMedia。
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const stationPort = createStationPortStub()
const listTaskPresentations = vi.fn(async () => ({
  items: [
    {
      kind: 'task_runtime_presentation' as const,
      source: 'os' as const,
      taskUuid: 'task-1',
      workflowUuid: null,
      executionKind: 'debug',
      status: 'failed',
      runMode: 'normal',
      controlStatus: 'idle',
      cleanupStatus: 'idle',
      priority: 'normal',
      description: null,
      createdAt: '2026-10-13T06:00:00Z',
      updatedAt: '2026-10-13T06:46:56Z',
      finishedAt: null,
      attentionReason: null,
      progress: null,
      jobs: [],
      raw: { name: '错误处置验收：失败后重试' },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 100,
  raw: {},
}))

const backend = createStudioBackendStub({
  core: {
    stationErrorHandling: stationPort,
    executionRead: { listTaskPresentations },
  },
})
vi.mock('../../app/backend', () => ({ createStudioBackend: () => backend }))

beforeEach(() => {
  stationPort.getSnapshot.mockReset()
  stationPort.resume.mockReset()
  stationPort.resume.mockResolvedValue(makeStationReceipt({ operation: 'resume' }))
})

describe('overview station dialog', () => {
  it('closes itself once the resumed station no longer needs a decision', async () => {
    // 工站已暂停、没有待处置错误：指标卡给出「恢复调度」入口。
    stationPort.getSnapshot.mockResolvedValue(makeStationSnapshot({ mode: 'PAUSED' }))
    stationPort.resume.mockImplementation(async () => {
      // 恢复生效只以重新读到的快照为准，不认回执。
      stationPort.getSnapshot.mockResolvedValue(makeStationSnapshot({ mode: 'RUNNING' }))
      return makeStationReceipt({ operation: 'resume' })
    })

    render(<OverviewPage onNavigate={vi.fn()} />, { wrapper: StationProviders })

    fireEvent.click(await screen.findByRole('button', { name: '恢复调度' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByLabelText('我已核对现场，确认可以恢复工站工作流调度'))
    fireEvent.click(screen.getByRole('button', { name: '恢复工站调度' }))

    await waitFor(() => expect(stationPort.resume).toHaveBeenCalledTimes(1))
    // 快照回到 RUNNING 后对话框不能再留着 —— 否则只剩一个空壳标题。
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('stays open while the station still needs a decision', async () => {
    stationPort.getSnapshot.mockResolvedValue(makeStationSnapshot({ mode: 'PAUSED' }))
    // 回执被受理但快照仍暂停：不能凭回执当成功，对话框必须留着说明原因。
    stationPort.resume.mockResolvedValue(
      makeStationReceipt({ operation: 'resume', status: 'PENDING' }),
    )

    render(<OverviewPage onNavigate={vi.fn()} />, { wrapper: StationProviders })

    fireEvent.click(await screen.findByRole('button', { name: '恢复调度' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByLabelText('我已核对现场，确认可以恢复工站工作流调度'))
    fireEvent.click(screen.getByRole('button', { name: '恢复工站调度' }))

    await waitFor(() => expect(stationPort.resume).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText(/操作已受理，但仍待应用/)).toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
