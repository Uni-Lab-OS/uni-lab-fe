import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TaskRuntimePresentation } from '@unilab-fe/core'
import { TasksPage } from './TasksPage'
import { BackendProvider } from '../../app/BackendProvider'
import { createStudioBackendStub } from '../../../test/stationHandlingStub'

/** 构造一页任务投影。列表只读名字/状态/进度/时间，其余字段给最小值即可。 */
function makeTask(taskUuid: string, name: string): TaskRuntimePresentation {
  return {
    kind: 'task_runtime_presentation',
    source: 'os',
    taskUuid,
    workflowUuid: null,
    executionKind: 'workflow',
    status: 'succeeded',
    runMode: 'normal',
    controlStatus: 'idle',
    cleanupStatus: 'settled',
    priority: null,
    description: null,
    createdAt: '2026-10-14T02:46:22Z',
    updatedAt: '2026-10-14T02:46:22Z',
    finishedAt: null,
    attentionReason: null,
    progress: null,
    jobs: [],
    raw: { name },
  }
}

const pageItems = (page: number) =>
  Array.from({ length: 20 }, (_, index) =>
    makeTask(`task-${page}-${index + 1}`, `第 ${page} 页任务 ${index + 1}`),
  )

const listTaskPresentations = vi.fn(
  async (input?: { readonly page?: number; readonly pageSize?: number }) => ({
    items: pageItems(input?.page ?? 1),
    total: 40,
    page: input?.page ?? 1,
    pageSize: input?.pageSize ?? 20,
    raw: {},
  }),
)

const backend = createStudioBackendStub({
  core: { executionRead: { listTaskPresentations } },
})
vi.mock('../../app/backend', () => ({ createStudioBackend: () => backend }))

const SEARCH_PLACEHOLDER = '搜索名称、工作流或任务编号'

beforeEach(() => {
  listTaskPresentations.mockClear()
})

describe('任务列表分页', () => {
  it('按页向后端取数，切到第 2 页请求 page=2', async () => {
    render(<TasksPage />, { wrapper: BackendProvider })
    await screen.findByText('第 1 页任务 1')
    expect(listTaskPresentations).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 })
    // 一次只取一页，不再把 200 条全拉回来在本地切片。
    expect(listTaskPresentations).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTitle('2'))
    await screen.findByText('第 2 页任务 1')
    expect(listTaskPresentations).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 })
  })

  it('关键字只过滤当前页，不产生新的分页请求', async () => {
    render(<TasksPage />, { wrapper: BackendProvider })
    await screen.findByText('第 1 页任务 1')

    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: '第 1 页任务 7' },
    })

    await waitFor(() => expect(screen.queryByText('第 1 页任务 1')).not.toBeInTheDocument())
    expect(screen.getByText('第 1 页任务 7')).toBeInTheDocument()
    // 展示接口没有 keyword 参数：过滤只作用于已取回的当前页，不重发请求。
    expect(listTaskPresentations).toHaveBeenCalledTimes(1)
  })

  it('筛选把当前页筛空时保留分页器，而不是整块空态', async () => {
    render(<TasksPage />, { wrapper: BackendProvider })
    await screen.findByText('第 1 页任务 1')

    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: '不存在的任务' },
    })

    await screen.findByText('当前页没有匹配的任务')
    // 空态不能吃掉分页器，否则当前页没有匹配项就翻不到下一页。
    expect(screen.getByTitle('2')).toBeInTheDocument()
  })
})
