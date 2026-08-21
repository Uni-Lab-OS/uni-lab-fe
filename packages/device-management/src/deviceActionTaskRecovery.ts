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
  subscribe?: (
    listener: (event: WorkflowRuntimeInvalidationEvent) => void,
    options: WorkflowRuntimeSubscriptionOptions
  ) => WorkflowEventSubscription
  read: (task: ActiveDeviceActionTask) => Promise<boolean>
  onError?: (task: ActiveDeviceActionTask, error: unknown) => void
  environment?: DeviceActionTaskRecoveryEnvironment
  pollIntervalMs?: number
  maxBackoffMs?: number
  fallbackDelaysMs?: readonly number[]
}

interface ActiveTaskState {
  task: ActiveDeviceActionTask
  retryDelayMs: number
  fallbackDelayIndex: number
  timer: ReturnType<typeof globalThis.setTimeout> | null
  inFlight: Promise<void> | null
}

const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_MAX_BACKOFF_MS = 30_000

/** 仅允许当前前端 active 的动作节点启动任务状态补读。 */
export function shouldRecoverActiveDeviceActionTask(
  selectedActionRef: string | null,
  runningActionRef: string | null,
  taskUuid: string | null
): boolean {
  return Boolean(
    taskUuid &&
    runningActionRef &&
    selectedActionRef === runningActionRef
  )
}

/**
 * 启动设备动作任务的 REST 状态复原（Rehydrate）协调器。
 *
 * @param options 活动任务、事件订阅、权威 REST 补读与浏览器环境端口。
 * @returns 可幂等释放的协调器句柄。
 * @safety SSE 在线时仅按失效事件补读；断线时启用 REST watchdog，任务终态始终由 REST 投影判定。
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
  const fallbackDelaysMs = options.fallbackDelaysMs?.length
    ? options.fallbackDelaysMs.map((delay) => Math.max(1, delay))
    : null
  const active = new Map<string, ActiveTaskState>(
    options.tasks.map((task) => [task.taskUuid, {
      task,
      retryDelayMs: pollIntervalMs,
      fallbackDelayIndex: 0,
      timer: null,
      inFlight: null
    }])
  )
  let disposed = false
  let realtimeLive = false

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
      realtimeLive ||
      !environment.isVisible()
    ) return
    const delay = fallbackDelaysMs
      ? fallbackDelaysMs[Math.min(
          state.fallbackDelayIndex,
          fallbackDelaysMs.length - 1
        )]
      : state.retryDelayMs
    state.timer = globalThis.setTimeout(() => {
      state.timer = null
      if (fallbackDelaysMs) state.fallbackDelayIndex += 1
      requestRead(state)
    }, delay)
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
        if (!fallbackDelaysMs) state.retryDelayMs = pollIntervalMs
        if (terminal) {
          active.delete(state.task.taskUuid)
          clearTimer(state)
        }
      })
      .catch((error: unknown) => {
        if (!fallbackDelaysMs) {
          state.retryDelayMs = Math.min(
            Math.max(pollIntervalMs, state.retryDelayMs * 2),
            maxBackoffMs
          )
        }
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
  let runtimeSubscription: WorkflowEventSubscription | null = null
  if (options.subscribe) {
    try {
      runtimeSubscription = options.subscribe(
        (event) => {
          const taskUuid = runtimeEventTaskUuid(event)
          if (!taskUuid) return
          const state = active.get(taskUuid)
          if (state) requestRead(state)
        },
        {
          onOpen: () => {
            realtimeLive = true
            pausePolling()
            rehydrateAll()
          },
          onError: (error) => {
            realtimeLive = false
            const firstActiveTask = active.values().next().value?.task
            if (firstActiveTask) options.onError?.(firstActiveTask, error)
            for (const state of active.values()) {
              state.fallbackDelayIndex = 0
              state.retryDelayMs = pollIntervalMs
              schedule(state)
            }
          }
        }
      )
    } catch {
      // 当前 Backend 的事件能力可能关闭；REST watchdog 仍会继续补读。
    }
  }

  // 先建立订阅，再立即补读，关闭“首次 GET → SSE 订阅”之间的终态丢失窗口。
  rehydrateAll()

  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      runtimeSubscription?.dispose()
      removeVisibilityListener()
      removeFocusListener()
      pausePolling()
      active.clear()
    }
  }
}

/** 从新旧运行失效通知中读取工作流任务（WorkflowTask）UUID。 */
function runtimeEventTaskUuid(
  event: WorkflowRuntimeInvalidationEvent
): string | null {
  if (event.event === 'workflow.runtime.changed') {
    return event.data.workflow_task_uuid
  }
  if (event.event === 'device_action_task.changed') return event.data.task_uuid
  return null
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
