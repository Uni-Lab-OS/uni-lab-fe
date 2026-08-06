import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRuntimeInvalidationEvent } from '@unilab/services'

import {
  startDeviceActionTaskRecovery,
  type DeviceActionTaskRecoveryEnvironment
} from './deviceActionTaskRecovery'

interface FakeSubscription {
  listener: (event: WorkflowRuntimeInvalidationEvent) => void
  onOpen: () => void
}

function createEnvironment(): DeviceActionTaskRecoveryEnvironment & {
  focus: () => void
  setVisible: (visible: boolean) => void
} {
  let visible = true
  const focusListeners = new Set<() => void>()
  const visibilityListeners = new Set<() => void>()
  return {
    isVisible: () => visible,
    onFocus: (listener) => {
      focusListeners.add(listener)
      return () => focusListeners.delete(listener)
    },
    onVisibilityChange: (listener) => {
      visibilityListeners.add(listener)
      return () => visibilityListeners.delete(listener)
    },
    focus: () => {
      for (const listener of focusListeners) listener()
    },
    setVisible: (next) => {
      visible = next
      for (const listener of visibilityListeners) listener()
    }
  }
}

function createSubscriptionPort(): {
  emit: FakeSubscription
  subscribe: Parameters<typeof startDeviceActionTaskRecovery>[0]['subscribe']
} {
  const emit: FakeSubscription = {
    listener: () => undefined,
    onOpen: () => undefined
  }
  return {
    emit,
    subscribe: (listener, options) => {
      emit.listener = listener
      emit.onOpen = () => options.onOpen?.({
        lastEventId: '',
        reconnected: true
      })
      return { dispose: vi.fn() }
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('device Action Task REST rehydrate recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('closes the subscribe race and treats duplicate SSE as invalidation only', async () => {
    const environment = createEnvironment()
    const subscription = createSubscriptionPort()
    let resolveRead: ((terminal: boolean) => void) | undefined
    const read = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveRead = resolve
    }))
    const recovery = startDeviceActionTaskRecovery({
      tasks: [{ taskUuid: 'task-1', actionRef: 'action-1' }],
      environment,
      subscribe: subscription.subscribe,
      read
    })

    expect(read).toHaveBeenCalledTimes(1)
    subscription.emit.listener({
      id: 'event-1',
      event: 'device_action_task.changed',
      data: { task_uuid: 'task-1' }
    })
    subscription.emit.listener({
      id: 'event-1',
      event: 'device_action_task.changed',
      data: { task_uuid: 'task-1' }
    })
    expect(read).toHaveBeenCalledTimes(1)

    resolveRead?.(true)
    await vi.runAllTimersAsync()
    expect(read).toHaveBeenCalledTimes(1)
    recovery.dispose()
  })

  it('rehydrates all active tasks when SSE opens or reconnects', async () => {
    const environment = createEnvironment()
    const subscription = createSubscriptionPort()
    const read = vi.fn(async () => false)
    const recovery = startDeviceActionTaskRecovery({
      tasks: [
        { taskUuid: 'task-1', actionRef: 'action-1' },
        { taskUuid: 'task-2', actionRef: 'action-2' }
      ],
      environment,
      subscribe: subscription.subscribe,
      read
    })
    await flushMicrotasks()
    expect(read).toHaveBeenCalledTimes(2)

    subscription.emit.onOpen()
    await flushMicrotasks()
    expect(read).toHaveBeenCalledTimes(4)
    recovery.dispose()
  })

  it('pauses polling while hidden and rehydrates on visibility or focus', async () => {
    const environment = createEnvironment()
    const subscription = createSubscriptionPort()
    const read = vi.fn(async () => false)
    const recovery = startDeviceActionTaskRecovery({
      tasks: [{ taskUuid: 'task-1', actionRef: 'action-1' }],
      environment,
      subscribe: subscription.subscribe,
      read,
      pollIntervalMs: 5_000
    })
    await flushMicrotasks()
    expect(read).toHaveBeenCalledTimes(1)

    environment.setVisible(false)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(read).toHaveBeenCalledTimes(1)

    environment.setVisible(true)
    await flushMicrotasks()
    expect(read).toHaveBeenCalledTimes(2)

    environment.focus()
    await flushMicrotasks()
    expect(read).toHaveBeenCalledTimes(3)
    recovery.dispose()
  })

  it('backs off failed REST reads and stops polling terminal tasks', async () => {
    const environment = createEnvironment()
    const subscription = createSubscriptionPort()
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const onError = vi.fn()
    const recovery = startDeviceActionTaskRecovery({
      tasks: [{ taskUuid: 'task-1', actionRef: 'action-1' }],
      environment,
      subscribe: subscription.subscribe,
      read,
      onError,
      pollIntervalMs: 1_000,
      maxBackoffMs: 4_000
    })
    await flushMicrotasks()
    expect(onError).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_999)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(read).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(read).toHaveBeenCalledTimes(3)
    recovery.dispose()
  })
})
