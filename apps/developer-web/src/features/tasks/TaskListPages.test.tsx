import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkflowRuntimeInvalidation } from '@unilab-fe/core'
import { taskSummaryPage } from '../../../test/taskSummaryFixtures'
import { OverviewPage } from '../overview/OverviewPage'
import { TasksPage } from './TasksPage'

// 替身须引用稳定（useBackendQuery 副作用依赖 backend 与 report*）；每个用例换一个后端实例，
// 会话缓存按后端实例隔离，用例之间互不影响。
const { holder, connection } = vi.hoisted(() => ({
  connection: { readyEpoch: 0, reportSuccess: () => undefined, reportError: () => undefined },
  holder: { current: null as unknown as ReturnType<typeof makeBackend> },
}))
vi.mock('../../app/BackendProvider', () => ({
  useBackend: () => ({ backend: holder.current, ...connection }),
}))

function makeBackend(summary: boolean) {
  const listeners = new Set<(event: WorkflowRuntimeInvalidation) => void>()
  return {
    /** 模拟全局 SSE 的任务运行失效通知（只是失效，不带状态）。 */
    emit: () =>
      listeners.forEach((listener) =>
        listener({
          id: String(Math.random()),
          event: 'workflow.runtime.changed',
          workflowTaskUuid: 'task-1',
          raw: {},
        }),
      ),
    getCapabilityStatus: (capability: string) => ({
      available: summary && capability === 'workflow.taskPresentationSummary',
    }),
    core: {
      workflowRuntimeEvents: {
        subscribe: (listener: (event: WorkflowRuntimeInvalidation) => void) => {
          listeners.add(listener)
          return { dispose: () => listeners.delete(listener) }
        },
      },
      executionRead: {
        listTaskSummaries: vi.fn(async () => taskSummaryPage()),
        listTaskPresentations: vi.fn(async () => ({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          raw: {},
        })),
      },
    },
  }
}

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

beforeEach(() => {
  window.history.replaceState({}, '', '/tasks')
})
afterEach(() => {
  vi.useRealTimers()
})

describe('task list pages', () => {
  it('lists summaries when the profile declares the summary view, without the heavy default view', async () => {
    holder.current = makeBackend(true)
    render(<TasksPage />)
    expect(await screen.findByText('S01 点样与展开')).toBeInTheDocument()
    expect(screen.getByText('pTLC 点样')).toBeInTheDocument()
    expect(screen.getByText('成功 2 · 运行中 1 · 等待 2')).toBeInTheDocument()
    expect(holder.current.core.executionRead.listTaskSummaries).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
    })
    expect(holder.current.core.executionRead.listTaskPresentations).not.toHaveBeenCalled()
  })

  it('shows the cached list immediately when switching between overview and tasks', async () => {
    holder.current = makeBackend(true)
    const tasks = render(<TasksPage />)
    expect(await screen.findByText('S01 点样与展开')).toBeInTheDocument()
    tasks.unmount()

    render(<OverviewPage onNavigate={() => undefined} />)
    // 总览与任务页首页共用同一份新鲜缓存：立即显示，不重复读取。
    expect(screen.getAllByText('S01 点样与展开').length).toBeGreaterThan(0)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(holder.current.core.executionRead.listTaskSummaries).toHaveBeenCalledTimes(1)
  })

  it('keeps the default presentation view when the capability is absent', async () => {
    holder.current = makeBackend(false)
    render(<TasksPage />)
    await waitFor(() =>
      expect(holder.current.core.executionRead.listTaskPresentations).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
      }),
    )
    expect(await screen.findByText('当前后端没有任务记录')).toBeInTheDocument()
    expect(holder.current.core.executionRead.listTaskSummaries).not.toHaveBeenCalled()
  })

  it('rereads the list at most every 2 seconds during a run, but the refresh button is immediate', async () => {
    vi.useFakeTimers()
    holder.current = makeBackend(true)
    const list = holder.current.core.executionRead.listTaskSummaries
    const starts: number[] = []
    list.mockImplementation(async () => {
      starts.push(Date.now())
      return taskSummaryPage()
    })
    render(<TasksPage />)
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(list).toHaveBeenCalledTimes(1)

    // 运行中约每 250ms 一条失效通知，持续 6 秒。
    for (let index = 0; index < 24; index += 1) {
      act(() => holder.current.emit())
      await act(async () => vi.advanceTimersByTimeAsync(250))
    }
    await act(async () => vi.advanceTimersByTimeAsync(2_500))
    const gaps = starts.slice(1).map((start, index) => start - starts[index]!)
    expect(gaps.length).toBeGreaterThanOrEqual(2)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2_000)

    // 刷新按钮不受最小间隔限制。
    const before = list.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '刷新任务列表' }))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(list).toHaveBeenCalledTimes(before + 1)
  })
})
