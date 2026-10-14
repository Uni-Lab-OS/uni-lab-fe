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

/** 构造一条任务投影：看板与表格用例都只读身份、名字、状态和时间。 */
function makePresentation(taskUuid: string, name: string, status: string) {
  return {
    kind: 'task_runtime_presentation' as const,
    source: 'os' as const,
    taskUuid,
    workflowUuid: null,
    executionKind: 'debug',
    status,
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
    raw: { name },
  }
}

/** 看板窗口里的需关注任务。指标条、两列和导航红点只认矩阵窗口。 */
const attentionTask = makePresentation('task-1', '错误处置验收：失败后重试', 'failed')

const TASK_PAGE_SIZE = 20

/**
 * 每页只回 3 条：用例断言的是「请求按每页 20 条分页」和分页器行为，不是表格能渲染
 * 多少行；jsdom 里 20 行 antd Table 会把工站对话框用例拖到超时。
 */
const ITEMS_PER_PAGE = 3

const pageItems = (page: number) =>
  Array.from({ length: ITEMS_PER_PAGE }, (_, index) =>
    makePresentation(`task-${page}-${index + 1}`, `第 ${page} 页任务 ${index + 1}`, 'succeeded'),
  )

const listTaskPresentations = vi.fn(
  async (input?: {
    readonly view?: string
    readonly page?: number
    readonly pageSize?: number
  }) => {
    if (input?.view === 'matrix') {
      return { items: [attentionTask], total: 1, page: 1, pageSize: TASK_PAGE_SIZE, raw: {} }
    }
    const page = input?.page ?? 1
    return {
      items: pageItems(page),
      total: 40,
      page,
      pageSize: input?.pageSize ?? TASK_PAGE_SIZE,
      raw: {},
    }
  },
)

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
  listTaskPresentations.mockClear()
})

/** 取指标卡的可读文本；指标条把标题和数值放在同一个卡片容器里。 */
function metricText(label: string): string {
  return screen.getByText(label).closest('div')?.textContent ?? ''
}

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

describe('overview task pagination', () => {
  it('看板读矩阵窗口、表格读分页，指标不随当前页变化', async () => {
    render(<OverviewPage onNavigate={vi.fn()} />, { wrapper: StationProviders })
    await screen.findByText('第 1 页任务 1')

    // 看板窗口只要活动/需关注任务加最近终态，表格只要当前页。
    expect(listTaskPresentations).toHaveBeenCalledWith({
      view: 'matrix',
      page: 1,
      terminalLimit: TASK_PAGE_SIZE,
    })
    expect(listTaskPresentations).toHaveBeenCalledWith({ page: 1, pageSize: TASK_PAGE_SIZE })
    // 「全部」是后端 total（40），「异常」来自看板窗口（1）—— 当前页 20 条都是已完成。
    expect(metricText('全部')).toContain('40')
    expect(metricText('异常')).toContain('1')

    fireEvent.click(screen.getByTitle('2'))
    // 翻页只把表格打回加载态，指标条不能被一起清空。
    expect(metricText('全部')).toContain('40')
    expect(metricText('异常')).toContain('1')

    await screen.findByText('第 2 页任务 1')
    expect(listTaskPresentations).toHaveBeenCalledWith({ page: 2, pageSize: TASK_PAGE_SIZE })
    // 第 2 页同样没有异常任务，看板窗口的计数不受影响。
    expect(metricText('全部')).toContain('40')
    expect(metricText('异常')).toContain('1')
  })

  it('分页器只展示分页，不展示每页条数', async () => {
    render(<OverviewPage onNavigate={vi.fn()} />, { wrapper: StationProviders })
    await screen.findByText('第 1 页任务 1')

    const pager = document.querySelector('.ant-pagination')
    expect(pager).not.toBeNull()
    expect(pager?.querySelector('.ant-pagination-options')).toBeNull()
  })
})
