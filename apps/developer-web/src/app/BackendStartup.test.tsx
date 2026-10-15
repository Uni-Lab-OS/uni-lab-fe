import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { TransportError } from '@unilab-fe/core'
import { BackendProvider } from './BackendProvider'
import { useBackendQuery } from '../hooks/useBackendQuery'
import { AsyncState } from '../components/ui/AsyncState'

const { backend, getReadiness } = vi.hoisted(() => {
  const getReadiness = vi.fn()
  return { getReadiness, backend: { dispose: () => undefined, core: { runtimeReadiness: { getReadiness } } } }
})
vi.mock('./backend', () => ({ createStudioBackend: () => backend }))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
})

afterEach(() => {
  vi.useRealTimers()
  getReadiness.mockReset()
})

// 查询会话缓存按后端实例与键共享，各用例使用独立键。
function Devices({ queryKey, loader }: { queryKey: string; loader: () => Promise<string> }) {
  const query = useBackendQuery(queryKey, loader)
  return (
    <AsyncState loading={query.loading} error={query.error} onRetry={query.reload}>
      {query.data}
    </AsyncState>
  )
}

const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0)
})

describe('backend startup', () => {
  it('shows startup progress instead of a load failure, then reloads once the OS is ready', async () => {
    vi.useFakeTimers()
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TransportError({ code: 'OS_STARTING', message: 'OS 正在启动', status: 503 }))
      .mockResolvedValueOnce('设备列表已加载')
    getReadiness
      .mockResolvedValueOnce({ status: 'starting', label: '编译工作流 37/106', progress: { done: 37, total: 106 }, elapsedS: 125 })
      .mockResolvedValueOnce({ status: 'ready' })

    render(
      <BackendProvider>
        <Devices queryKey="startup-progress" loader={loader} />
      </BackendProvider>,
    )
    await flush()
    await flush()
    expect(screen.getByText('OS 正在启动，就绪后自动加载')).toBeInTheDocument()
    expect(screen.getByText(/编译工作流 37\/106（已等待 2 分 5 秒）/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByText('数据加载失败')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    await flush()
    expect(screen.getByText('设备列表已加载')).toBeInTheDocument()
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('treats an empty proxy 500 as unreachable but keeps real server errors red', async () => {
    vi.useFakeTimers()
    getReadiness.mockRejectedValue(new TransportError({ code: 'HTTP_REQUEST_FAILED', message: 'HTTP 500', status: 500 }))
    const { unmount } = render(
      <BackendProvider>
        <Devices queryKey="startup-proxy-500" loader={() => Promise.reject(new TransportError({ code: 'HTTP_REQUEST_FAILED', message: 'HTTP 500', status: 500 }))} />
      </BackendProvider>,
    )
    await flush()
    await flush()
    expect(screen.getByText(/等待 OS 服务响应/)).toBeInTheDocument()
    unmount()

    render(
      <BackendProvider>
        <Devices
          queryKey="startup-real-500"
          loader={() =>
            Promise.reject(
              new TransportError({ code: 'WORKFLOW_ERROR', message: '编译失败', status: 500, cause: { error: { code: 'WORKFLOW_ERROR' } } }),
            )
          }
        />
      </BackendProvider>,
    )
    await flush()
    expect(screen.getByText('数据加载失败')).toBeInTheDocument()
    expect(screen.getByText('编译失败')).toBeInTheDocument()
  })

  it('reports a failed startup with the reason', async () => {
    vi.useFakeTimers()
    getReadiness.mockResolvedValue({ status: 'failed', error: 'RuntimeError: 结构审计失败' })
    render(
      <BackendProvider>
        <Devices queryKey="startup-failed" loader={() => Promise.reject(new TransportError({ code: 'OS_STARTING', message: 'x', status: 503 }))} />
      </BackendProvider>,
    )
    await flush()
    await flush()
    expect(screen.getByText('OS 启动失败')).toBeInTheDocument()
    expect(screen.getByText('RuntimeError: 结构审计失败')).toBeInTheDocument()
  })
})
