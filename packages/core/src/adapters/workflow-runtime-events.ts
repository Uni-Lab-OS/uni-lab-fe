import type {
  WorkflowRuntimeInvalidation,
  WorkflowRuntimeSubscription
} from '../domain/workflow-execution-read/model'
import type { WorkflowRuntimeEventsPort } from '../domain/workflow-runtime-events/port'

export interface WorkflowRuntimeEventsOptions {
  readonly baseUrl: string
  readonly getAccessToken?: () => string | null | Promise<string | null>
  readonly reconnectDelayMs?: number
}

export interface WorkflowRuntimeEvents extends WorkflowRuntimeEventsPort {
  readonly dispose: () => void
}

interface Subscriber {
  readonly listener: (event: WorkflowRuntimeInvalidation) => void
  readonly lastEventId?: string
  readonly onError?: (error: Error) => void
  readonly onOpen?: (state: { lastEventId: string; reconnected: boolean }) => void
}

interface SseFrame {
  readonly id: string
  readonly event: string
  readonly data: string
}

const DEFAULT_RECONNECT_DELAY_MS = 3_000
const MAX_SEEN_EVENT_IDS = 512

/**
 * Core-owned global runtime event connection.
 *
 * The stream only delivers invalidations. Callers must re-read the authoritative
 * task/job projection over REST after receiving an event.
 */
export function createWorkflowRuntimeEvents(
  options: WorkflowRuntimeEventsOptions
): WorkflowRuntimeEvents {
  const subscribers = new Set<Subscriber>()
  const seenEventIds = new Set<string>()
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
  const endpoint = workflowEventsUrl(options.baseUrl)
  let controller: AbortController | null = null
  let connected = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let cursor = ''
  let openedConnections = 0
  let disposed = false
  let onlineListenerInstalled = false

  const notifyError = (error: unknown): void => {
    const normalized = error instanceof Error ? error : new Error(String(error))
    for (const subscriber of [...subscribers]) subscriber.onError?.(normalized)
  }

  const scheduleReconnect = (): void => {
    if (disposed || subscribers.size === 0 || reconnectTimer !== null) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, reconnectDelayMs)
  }

  const dispatchFrame = (frame: SseFrame): void => {
    if (frame.id) cursor = frame.id
    if (frame.id && isDuplicate(frame.id, seenEventIds)) return
    const event = parseRuntimeEvent(frame)
    if (!event) return
    for (const subscriber of [...subscribers]) {
      try {
        subscriber.listener(event)
      } catch (error) {
        subscriber.onError?.(asError(error))
      }
    }
  }

  const connect = async (): Promise<void> => {
    if (disposed || subscribers.size === 0 || controller !== null) return
    const activeController = new AbortController()
    controller = activeController
    try {
      const headers = new Headers({ Accept: 'text/event-stream' })
      if (cursor) headers.set('Last-Event-ID', cursor)
      const token = await options.getAccessToken?.()
      if (token) headers.set('Authorization', token)
      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: activeController.signal,
      })
      if (!response.ok || !response.body) {
        throw new Error(`${response.status} ${response.statusText}`)
      }
      connected = true
      const openState = {
        lastEventId: cursor,
        reconnected: openedConnections > 0,
      }
      openedConnections += 1
      for (const subscriber of [...subscribers]) subscriber.onOpen?.(openState)
      await readSseStream(response.body, dispatchFrame, activeController.signal)
      if (!activeController.signal.aborted && !disposed && subscribers.size > 0) {
        notifyError(new Error('Workflow Runtime SSE 连接已断开，正在重连'))
      }
    } catch (error) {
      if (!activeController.signal.aborted && !disposed) notifyError(error)
    } finally {
      connected = false
      if (controller === activeController) controller = null
    }
    if (!activeController.signal.aborted) scheduleReconnect()
  }

  const reconnectWhenOnline = (): void => {
    if (disposed || subscribers.size === 0) return
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    controller?.abort()
    controller = null
    connected = false
    void connect()
  }

  const installOnlineListener = (): void => {
    if (onlineListenerInstalled) return
    globalThis.addEventListener?.('online', reconnectWhenOnline)
    onlineListenerInstalled = true
  }

  const stopWhenUnused = (): void => {
    if (subscribers.size > 0) return
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    controller?.abort()
    controller = null
    connected = false
    cursor = ''
    openedConnections = 0
    seenEventIds.clear()
    if (onlineListenerInstalled) {
      globalThis.removeEventListener?.('online', reconnectWhenOnline)
      onlineListenerInstalled = false
    }
  }

  return {
    subscribe(listener, subscriptionOptions = {}): WorkflowRuntimeSubscription {
      // React StrictMode 会在开发期执行一次 effect cleanup，再复用同一个
      // composition-root 实例重新挂载。dispose 只释放当前连接，不应让这个
      // 可复用的 runtime adapter 永久失效。
      disposed = false
      const subscriber: Subscriber = {
        listener,
        lastEventId: subscriptionOptions.lastEventId,
        onOpen: subscriptionOptions.onOpen,
        onError: subscriptionOptions.onError,
      }
      if (subscribers.size === 0 && subscriber.lastEventId) {
        cursor = subscriber.lastEventId
      }
      subscribers.add(subscriber)
      installOnlineListener()
      if (controller === null) void connect()
      else if (connected) subscriber.onOpen?.({ lastEventId: cursor, reconnected: false })
      return {
        dispose: () => {
          subscribers.delete(subscriber)
          stopWhenUnused()
        },
      }
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      subscribers.clear()
      stopWhenUnused()
    },
  }
}

function workflowEventsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v1/events`
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrame) => void,
  signal: AbortSignal
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      for (const value of frames) {
        const frame = parseSseFrame(value)
        if (frame) onFrame(frame)
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function parseSseFrame(value: string): SseFrame | null {
  let id = ''
  let event = 'message'
  const data: string[] = []
  for (const line of value.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    const raw = separator < 0 ? '' : line.slice(separator + 1)
    const fieldValue = raw.startsWith(' ') ? raw.slice(1) : raw
    if (field === 'id') id = fieldValue
    else if (field === 'event') event = fieldValue
    else if (field === 'data') data.push(fieldValue)
  }
  if (data.length === 0 && id === '') return null
  return { id, event, data: data.join('\n') }
}

function parseRuntimeEvent(frame: SseFrame): WorkflowRuntimeInvalidation | null {
  if (frame.event !== 'workflow.runtime.changed' && frame.event !== 'device_action_task.changed') {
    return null
  }
  try {
    const data = JSON.parse(frame.data) as Record<string, unknown>
    const key = frame.event === 'workflow.runtime.changed'
      ? 'workflow_task_uuid'
      : 'task_uuid'
    // OS 允许在失效通知中附带 dispatch_gate 等诊断字段；前端只依赖稳定的
    // Task UUID，不能因为扩展字段存在而丢弃整条刷新通知。
    if (typeof data[key] !== 'string' || data[key].trim() === '') {
      return null
    }
    return {
      id: frame.id,
      event: frame.event,
      workflowTaskUuid: data[key],
      raw: data,
    }
  } catch {
    return null
  }
}

function isDuplicate(eventId: string, seen: Set<string>): boolean {
  if (seen.has(eventId)) return true
  seen.add(eventId)
  if (seen.size > MAX_SEEN_EVENT_IDS) {
    const oldest = seen.values().next().value
    if (oldest !== undefined) seen.delete(oldest)
  }
  return false
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
