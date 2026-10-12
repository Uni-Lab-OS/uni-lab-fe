import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { BackendProvider, useBackend } from './BackendProvider'
import { createRuntimeEventsStub } from '../../test/runtimeEventsStub'

const runtimeEvents = createRuntimeEventsStub()
const backendDispose = vi.hoisted(() => vi.fn())
vi.mock('./backend', () => ({
  createStudioBackend: () => ({
    dispose: backendDispose,
    core: { workflowRuntimeEvents: runtimeEvents.port },
  }),
}))

function RevisionProbe() {
  const { runtimeRevision } = useBackend()
  return <span data-testid="revision">{runtimeRevision}</span>
}

const renderProvider = () =>
  render(
    <BackendProvider>
      <RevisionProbe />
    </BackendProvider>,
  )

describe('BackendProvider runtime invalidation', () => {
  it('subscribes to the global runtime stream and releases it on unmount', () => {
    const before = runtimeEvents.subscriptionCount
    const view = renderProvider()
    expect(runtimeEvents.subscriptionCount).toBe(before + 1)
    expect(runtimeEvents.listenerCount).toBe(1)

    view.unmount()
    expect(runtimeEvents.listenerCount).toBe(0)
  })

  it('bumps the revision and coalesces a burst into one window', () => {
    renderProvider()
    expect(screen.getByTestId('revision')).toHaveTextContent('0')

    act(() => {
      for (let index = 0; index < 6; index += 1) runtimeEvents.emit(`task-${index}`)
    })
    // 前沿立即生效，其余事件折叠进同一个节流窗口，不会逐条递增。
    expect(screen.getByTestId('revision')).toHaveTextContent('1')
  })
})
