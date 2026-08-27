export interface DeviceActionCatalogRecovery {
  refresh: () => Promise<boolean>
  dispose: () => void
}

interface DeviceActionCatalogRecoveryOptions {
  load: (refresh?: boolean) => Promise<boolean>
  initialRetryDelayMs?: number
  maxRetryDelayMs?: number
}

const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000

/**
 * 在 OS 健康检查先于动作模板扫描完成时持续恢复动作目录。
 *
 * 首次读取立即进行；失败后按上限退避，成功后停止。显式刷新会取消等待并立即
 * 复读，避免设备列表已经刷新而动作入口仍永久停留在启动期错误。
 */
export function startDeviceActionCatalogRecovery(
  options: DeviceActionCatalogRecoveryOptions
): DeviceActionCatalogRecovery {
  const initialRetryDelayMs = Math.max(
    1,
    options.initialRetryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS
  )
  const maxRetryDelayMs = Math.max(
    initialRetryDelayMs,
    options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS
  )
  let retryDelayMs = initialRetryDelayMs
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null
  let inFlight: Promise<boolean> | null = null
  let disposed = false

  const clearTimer = (): void => {
    if (timer !== null) globalThis.clearTimeout(timer)
    timer = null
  }

  const scheduleRetry = (): void => {
    if (disposed || timer !== null || inFlight !== null) return
    const delay = retryDelayMs
    retryDelayMs = Math.min(retryDelayMs * 2, maxRetryDelayMs)
    timer = globalThis.setTimeout(() => {
      timer = null
      void requestLoad(false)
    }, delay)
  }

  const requestLoad = (refresh = false): Promise<boolean> => {
    if (disposed) return Promise.resolve(false)
    clearTimer()
    if (inFlight) return inFlight
    let shouldRetry = false
    inFlight = options.load(refresh)
      .then((loaded) => {
        if (disposed) return false
        if (loaded) retryDelayMs = initialRetryDelayMs
        else shouldRetry = true
        return loaded
      })
      .catch(() => {
        shouldRetry = !disposed
        return false
      })
      .finally(() => {
        inFlight = null
        if (shouldRetry) scheduleRetry()
      })
    return inFlight
  }

  // 首次读取不等待定时器；设备面板打开时应尽快进入可运行状态。
  void requestLoad(false)

  return {
    refresh: () => requestLoad(true),
    dispose: () => {
      if (disposed) return
      disposed = true
      clearTimer()
    }
  }
}
