import { describe, expect, it, vi } from 'vitest'

import {
  normalizeProductionEndpoint,
  probeProductionEndpoints
} from './production-connection'

describe('production connection probe', () => {
  it('normalizes HTTP endpoints and rejects unsupported protocols', () => {
    expect(normalizeProductionEndpoint(
      ' https://backend.example.com/ ',
      'Backend'
    )).toBe('https://backend.example.com')
    expect(() => normalizeProductionEndpoint(
      'opc.tcp://scheduler.example.com',
      '调度器（Scheduler）'
    )).toThrow('只支持 HTTP 或 HTTPS')
  })

  /**
   * 验证连接检测把收到的 HTTP 错误响应识别为网络可达。
   *
   * @returns 无返回值；通过两个端点结果断言传输层语义。
   * @safety 使用 fetch 测试替身，不访问任何真实生产服务。
   */
  it('treats any received HTTP response as reachable transport', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      return new Response(null, {
        status: url.includes('backend') ? 404 : 503
      })
    }) as unknown as typeof fetch

    const result = await probeProductionEndpoints({
      backendUrl: 'https://backend.example.com',
      schedulerUrl: 'https://scheduler.example.com'
    }, { fetcher, now: () => 42 })

    expect(result.backend).toMatchObject({
      reachable: true,
      status: 404,
      message: '网络可达（HTTP 404）'
    })
    expect(result.scheduler).toMatchObject({
      reachable: true,
      status: 503,
      message: '网络可达（HTTP 503）'
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledWith(
      'https://backend.example.com',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' })
    )
    expect(result.checkedAt).toBe(new Date(42).toISOString())
  })

  /**
   * 验证网络异常保留在对应端点结果中，不掩盖另一个端点的成功事实。
   *
   * @returns 无返回值；断言成对探测不会因单点失败整体拒绝。
   * @safety 使用本地测试替身，不发送网络请求。
   */
  it('keeps backend and scheduler reachability independent', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('scheduler')) throw new Error('ECONNREFUSED')
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const result = await probeProductionEndpoints({
      backendUrl: 'https://backend.example.com',
      schedulerUrl: 'https://scheduler.example.com'
    }, { fetcher, now: () => 10 })

    expect(result.backend.reachable).toBe(true)
    expect(result.scheduler).toMatchObject({
      reachable: false,
      status: null,
      message: 'ECONNREFUSED'
    })
  })
})
