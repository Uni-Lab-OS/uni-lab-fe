import type {
  WorkflowEventSubscription,
  WorkflowRuntimeInvalidationEvent,
  WorkflowRuntimeSubscriptionOptions
} from '@unilab/services'

export interface ActiveDeviceActionTask {
  taskUuid: string
  actionRef: string
}

export interface DeviceActionTaskRecoveryEnvironment {
  isVisible: () => boolean
  onFocus: (listener: () => void) => () => void
  onVisibilityChange: (listener: () => void) => () => void
}

interface DeviceActionTaskRecoveryOptions {
  tasks: ActiveDeviceActionTask[]
  subscribe: (
    listener: (event: WorkflowRuntimeInvalidationEvent) => void,
    options: WorkflowRuntimeSubscriptionOptions
  ) => WorkflowEventSubscription
  read: (task: ActiveDeviceActionTask) => Promise<boolean>
  onError?: (task: ActiveDeviceActionTask, error: unknown) => void
  environment?: DeviceActionTaskRecoveryEnvironment
  pollIntervalMs?: number
  maxBackoffMs?: number
}

interface ActiveTaskState {
  task: ActiveDeviceActionTask
  retryDelayMs: number
  timer: ReturnType<typeof globalThis.setTimeout> | null
  inFlight: Promise<void> | null
}

const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_MAX_BACKOFF_MS = 30_000

/**
 * 启动设备动作任务的 REST 状态复原（Rehydrate）协调器。
 *
 * @param options 活动任务、事件订阅、权威 REST 补读与浏览器环境端口。
 * @returns 可幂等释放的协调器句柄。
 * @safety SSE 仅触发失效补读；任务终态始终由 REST 投影判定。
 */
export function startDeviceActionTaskRecovery(
  options: DeviceActionTaskRecoveryOptions
): WorkflowEventSubscription {
  const environment = options.environment ?? createBrowserRecoveryEnvironment()
  const pollIntervalMs = Math.max(
    1,
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  )
  const maxBackoffMs = Math.max(
    pollIntervalMs,
    options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
  )
  const active = new Map<string, ActiveTaskState>(
    options.tasks.map((task) => [task.taskUuid, {
      task,
      retryDelayMs: pollIntervalMs,
      timer: null,
      inFlight: null
    }])
  )
  let disposed = false

  const clearTimer = (state: ActiveTaskState): void => {
    if (state.timer !== null) globalThis.clearTimeout(state.timer)
    state.timer = null
  }

  const schedule = (state: ActiveTaskState): void => {
    if (
      disposed ||
      state.timer !== null ||
      state.inFlight !== null ||
      !active.has(state.task.taskUuid) ||
      !environment.isVisible()
    ) return
    state.timer = globalThis.setTimeout(() => {
      state.timer = null
      requestRead(state)
    }, state.retryDelayMs)
  }

  const requestRead = (state: ActiveTaskState): void => {
    if (
      disposed ||
      state.inFlight !== null ||
      !active.has(state.task.taskUuid)
    ) return
    clearTimer(state)
    state.inFlight = options.read(state.task)
      .then((terminal) => {
        state.retryDelayMs = pollIntervalMs
        if (terminal) {
          active.delete(state.task.taskUuid)
          clearTimer(state)
        }
      })
      .catch((error: unknown) => {
        state.retryDelayMs = Math.min(
          Math.max(pollIntervalMs, state.retryDelayMs * 2),
          maxBackoffMs
        )
        options.onError?.(state.task, error)
      })
      .finally(() => {
        state.inFlight = null
        schedule(state)
      })
  }

  const rehydrateAll = (): void => {
    if (disposed || !environment.isVisible()) return
    for (const state of active.values()) requestRead(state)
  }

  const pausePolling = (): void => {
    for (const state of active.values()) clearTimer(state)
  }

  const removeVisibilityListener = environment.onVisibilityChange(() => {
    if (environment.isVisible()) rehydrateAll()
    else pausePolling()
  })
  const removeFocusListener = environment.onFocus(rehydrateAll)
  const runtimeSubscription = options.subscribe(
    (event) => {
      if (event.event !== 'device_action_task.changed') return
      const state = active.get(event.data.task_uuid)
      if (state) requestRead(state)
    },
    {
      onOpen: rehydrateAll
    }
  )

  // 先建立订阅，再立即补读，关闭“首次 GET → SSE 订阅”之间的终态丢失窗口。
  rehydrateAll()

  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      runtimeSubscription.dispose()
      removeVisibilityListener()
      removeFocusListener()
      pausePolling()
      active.clear()
    }
  }
}

/** 创建浏览器页面可见性与焦点恢复端口。 */
function createBrowserRecoveryEnvironment(): DeviceActionTaskRecoveryEnvironment {
  return {
    isVisible: () =>
      typeof document === 'undefined' || document.visibilityState !== 'hidden',
    onFocus: (listener) => {
      if (typeof window === 'undefined') return () => undefined
      window.addEventListener('focus', listener)
      return () => window.removeEventListener('focus', listener)
    },
    onVisibilityChange: (listener) => {
      if (typeof document === 'undefined') return () => undefined
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    }
  }
}
