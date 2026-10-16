import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import type { WorkflowRuntimeInvalidation } from '@unilab-fe/core'
import { useRuntimeInvalidation, type RuntimeInvalidationOptions } from './useRuntimeInvalidation'

const { backend, emit } = vi.hoisted(() => {
  const listeners = new Set<(event: WorkflowRuntimeInvalidation) => void>()
  return {
    emit: (event: Partial<WorkflowRuntimeInvalidation>) =>
      listeners.forEach((listener) =>
        listener({
          id: 'e',
          event: 'workflow.runtime.changed',
          workflowTaskUuid: 't',
          raw: {},
          ...event,
        }),
      ),
    backend: {
      core: {
        workflowRuntimeEvents: {
          subscribe: (listener: (event: WorkflowRuntimeInvalidation) => void) => {
            listeners.add(listener)
            return { dispose: () => listeners.delete(listener) }
          },
        },
      },
    },
  }
})
vi.mock('../app/BackendProvider', () => ({ useBackend: () => ({ backend }) }))

function Probe({
  onInvalidate,
  options,
}: {
  onInvalidate: () => unknown
  options?: RuntimeInvalidationOptions
}) {
  useRuntimeInvalidation(onInvalidate, options)
  return null
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useRuntimeInvalidation', () => {
  it('rereads at most once per interval while events keep arriving, and catches up on the last one', async () => {
    const reload = vi.fn()
    render(<Probe onInvalidate={reload} options={{ minIntervalMs: 2_000 }} />)
    // 5 秒内每 100ms 一条通知：期望约 3 次重读，而不是 50 次。
    for (let index = 0; index < 50; index += 1) {
      act(() => emit({}))
      await act(async () => vi.advanceTimersByTime(100))
    }
    await act(async () => vi.advanceTimersByTime(3_000))
    expect(reload.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(reload.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('never runs two rereads concurrently and rereads once more if events arrived meanwhile', async () => {
    let finish: () => void = () => undefined
    const reload = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<Probe onInvalidate={reload} options={{ minIntervalMs: 0 }} />)
    act(() => emit({}))
    await act(async () => vi.advanceTimersByTime(300))
    expect(reload).toHaveBeenCalledTimes(1)
    act(() => emit({}))
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(reload).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    await act(async () => vi.advanceTimersByTime(300))
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('filters events: task pages ignore station notifications, station handling only takes them', async () => {
    const taskReload = vi.fn()
    const stationReload = vi.fn()
    render(
      <>
        <Probe onInvalidate={taskReload} />
        <Probe
          onInvalidate={stationReload}
          options={{ accept: (event) => event.event === 'station.error_handling.changed' }}
        />
      </>,
    )
    act(() => emit({ event: 'station.error_handling.changed', workflowTaskUuid: '' }))
    await act(async () => vi.advanceTimersByTime(300))
    expect(stationReload).toHaveBeenCalledTimes(1)
    expect(taskReload).not.toHaveBeenCalled()
  })
})
