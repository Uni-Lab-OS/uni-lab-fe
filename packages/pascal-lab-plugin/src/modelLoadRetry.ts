/** 判断 3D 模型加载错误是否可能随 OS Backend 就绪而恢复。 */
export function isRetryableModelLoadError(message: string): boolean {
  const normalized = message.trim()
  if (!normalized) return false
  return (
    /fetch failed/i.test(normalized) ||
    /HTTP 502/i.test(normalized) ||
    /HTTP 503/i.test(normalized) ||
    /HTTP 504/i.test(normalized) ||
    /WORKBENCH_BACKEND_PROXY_UNAVAILABLE/i.test(normalized) ||
    /Failed to fetch/i.test(normalized) ||
    /网络错误/i.test(normalized)
  )
}

/** 返回下一次模型加载重试的等待毫秒数。 */
export function modelLoadRetryDelayMs(attempt: number): number {
  return Math.min(2_000 + attempt * 1_000, 10_000)
}
