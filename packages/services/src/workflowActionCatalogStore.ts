import type { WorkflowExecutableCatalogSnapshot } from './workflowActionCatalogTypes'

export type WorkflowActionCatalogReader = (
  signal?: AbortSignal
) => Promise<WorkflowExecutableCatalogSnapshot>

export interface WorkflowActionCatalogStore {
  read: WorkflowActionCatalogReader
  refresh: WorkflowActionCatalogReader
  invalidate: () => void
  dispose: () => void
}

/**
 * 为单个服务 Authority 创建动作目录单飞缓存。
 *
 * 并发调用共享同一请求；成功快照保留到目录失效事件或服务释放。调用方取消只
 * 终止自己的等待，不会中断其他共享调用；释放服务时才取消底层请求。
 */
export function createWorkflowActionCatalogStore(
  load: WorkflowActionCatalogReader
): WorkflowActionCatalogStore {
  let snapshot: WorkflowExecutableCatalogSnapshot | null = null
  let inFlight: Promise<WorkflowExecutableCatalogSnapshot> | null = null
  let loadController: AbortController | null = null
  let generation = 0
  let disposed = false

  const read: WorkflowActionCatalogReader = (signal) => {
    if (disposed) {
      return Promise.reject(new Error('动作目录缓存已释放'))
    }
    if (snapshot) return waitForSharedResult(Promise.resolve(snapshot), signal)
    if (!inFlight) {
      const controller = new AbortController()
      const loadGeneration = generation
      loadController = controller
      const request = load(controller.signal)
        .then((loaded) => {
          if (
            !disposed &&
            loadController === controller &&
            generation === loadGeneration
          ) snapshot = loaded
          return loaded
        })
        .finally(() => {
          if (inFlight === request) inFlight = null
          if (loadController === controller) loadController = null
        })
      inFlight = request
    }
    return waitForSharedResult(inFlight, signal)
  }

  const invalidate = (): void => {
    generation += 1
    snapshot = null
  }

  const refresh: WorkflowActionCatalogReader = (signal) => {
    if (inFlight) return waitForSharedResult(inFlight, signal)
    invalidate()
    return read(signal)
  }

  return {
    read,
    refresh,
    invalidate,
    dispose: () => {
      if (disposed) return
      disposed = true
      generation += 1
      snapshot = null
      loadController?.abort()
      loadController = null
      inFlight = null
    }
  }
}

/** 让单个调用方可取消等待，同时保留 Authority 内共享的底层目录请求。 */
function waitForSharedResult<Value>(
  shared: Promise<Value>,
  signal?: AbortSignal
): Promise<Value> {
  if (!signal) return shared
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<Value>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup()
      reject(abortReason(signal))
    }
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    void shared.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      }
    )
  })
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('请求已取消', 'AbortError')
}
