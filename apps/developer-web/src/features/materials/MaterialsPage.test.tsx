import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { MaterialGraph, WorkflowRuntimeInvalidation } from '@unilab-fe/core'
import { MaterialsPage } from './MaterialsPage'

// 替身须引用稳定（useBackendQuery 副作用依赖 backend 与 report*）；每个用例换一个后端实例，
// 会话缓存按后端实例隔离，用例之间互不影响。
const { holder, connection } = vi.hoisted(() => ({
  connection: { readyEpoch: 0, reportSuccess: () => undefined, reportError: () => undefined },
  holder: { current: null as unknown as ReturnType<typeof makeBackend> },
}))
vi.mock('../../app/BackendProvider', () => ({
  useBackend: () => ({ backend: holder.current, ...connection }),
}))

const EMPTY_GRAPH: MaterialGraph = { kind: 'material_graph', source: 'os', nodes: [], raw: {} }

function makeBackend() {
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
    getCapabilityStatus: () => ({ available: false }),
    core: {
      workflowRuntimeEvents: {
        subscribe: (listener: (event: WorkflowRuntimeInvalidation) => void) => {
          listeners.add(listener)
          return { dispose: () => listeners.delete(listener) }
        },
      },
      materialSite: { getGraph: vi.fn(async () => EMPTY_GRAPH) },
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
afterEach(() => {
  vi.useRealTimers()
})

describe('materials page', () => {
  it('rereads the material graph at most every 3 seconds during a run, but the refresh button is immediate', async () => {
    vi.useFakeTimers()
    holder.current = makeBackend()
    const getGraph = holder.current.core.materialSite.getGraph
    const starts: number[] = []
    getGraph.mockImplementation(async () => {
      starts.push(Date.now())
      return EMPTY_GRAPH
    })
    render(<MaterialsPage />)
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(getGraph).toHaveBeenCalledTimes(1)

    // 运行中约每 250ms 一条失效通知，持续 9 秒：板子移动、溶剂扣减都随任务执行记账。
    for (let index = 0; index < 36; index += 1) {
      act(() => holder.current.emit())
      await act(async () => vi.advanceTimersByTimeAsync(250))
    }
    await act(async () => vi.advanceTimersByTimeAsync(3_500))
    const gaps = starts.slice(1).map((start, index) => start - starts[index]!)
    expect(gaps.length).toBeGreaterThanOrEqual(2)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3_000)

    // 刷新按钮不受最小间隔限制。
    const before = getGraph.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '刷新物料图' }))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(getGraph).toHaveBeenCalledTimes(before + 1)
  })
})
