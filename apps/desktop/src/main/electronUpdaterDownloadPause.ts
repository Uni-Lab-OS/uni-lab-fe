interface PausableUpdaterResponse {
  pause(): void
  resume(): void
  once(event: string, listener: () => void): unknown
}

interface ElectronUpdaterHttpExecutor {
  createRequest(
    options: unknown,
    listener: (response: PausableUpdaterResponse) => void
  ): unknown
}

interface ElectronUpdaterWithHttpExecutor {
  httpExecutor?: ElectronUpdaterHttpExecutor
}

export interface ElectronUpdaterDownloadPauseController {
  pause(): boolean
  resume(): boolean
  dispose(): void
}

/**
 * 在 electron-updater 的 Electron 下载响应上实现真正的流控暂停。
 *
 * electron-updater 6.8.9 的公开 CancellationToken 会清空 pending 临时文件，
 * 因而只能取消、不能暂停。这里绑定其 ElectronHttpExecutor 响应流，调用
 * Readable.pause()/resume() 保留同一临时文件、摘要校验器和下载 Promise。
 * apps/desktop 将依赖固定为 6.8.9，并由契约测试保护这个窄内部 seam。
 */
export function bindElectronUpdaterDownloadPause(
  updater: ElectronUpdaterWithHttpExecutor
): ElectronUpdaterDownloadPauseController {
  const executor = updater.httpExecutor
  if (!executor || typeof executor.createRequest !== 'function') {
    return unsupportedController
  }

  const responses = new Set<PausableUpdaterResponse>()
  const originalCreateRequest = executor.createRequest
  let paused = false
  let disposed = false

  const wrappedCreateRequest: ElectronUpdaterHttpExecutor['createRequest'] =
    function wrappedRequest(options, listener) {
      return originalCreateRequest.call(executor, options, (response) => {
        if (isPausableResponse(response)) {
          responses.add(response)
          const release = (): void => {
            responses.delete(response)
          }
          response.once('end', release)
          response.once('error', release)
          response.once('aborted', release)
          if (paused) response.pause()
        }
        listener(response)
      })
    }

  executor.createRequest = wrappedCreateRequest

  return {
    pause(): boolean {
      if (disposed) return false
      paused = true
      for (const response of responses) response.pause()
      return true
    },
    resume(): boolean {
      if (disposed) return false
      paused = false
      for (const response of responses) response.resume()
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (paused) {
        for (const response of responses) response.resume()
      }
      responses.clear()
      if (executor.createRequest === wrappedCreateRequest) {
        executor.createRequest = originalCreateRequest
      }
    }
  }
}

const unsupportedController: ElectronUpdaterDownloadPauseController = {
  pause: () => false,
  resume: () => false,
  dispose: () => undefined
}

function isPausableResponse(
  response: PausableUpdaterResponse
): response is PausableUpdaterResponse {
  return typeof response?.pause === 'function'
    && typeof response.resume === 'function'
    && typeof response.once === 'function'
}
