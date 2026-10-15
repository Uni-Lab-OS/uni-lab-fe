import { describe, expect, it } from 'vitest'
import { TransportError } from '../../transport/request'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'
import { RuntimeReadinessClient, decodeRuntimeReadiness, isBackendUnavailableError } from './readiness'

describe('runtime readiness', () => {
  it('decodes device package startup progress', () => {
    expect(
      decodeRuntimeReadiness({
        status: 'starting',
        phase: 'compiling',
        label: '编译工作流 37/106',
        progress: { done: 37, total: 106 },
        elapsed_s: 412.5,
      }),
    ).toEqual({
      status: 'starting',
      phase: 'compiling',
      label: '编译工作流 37/106',
      progress: { done: 37, total: 106 },
      elapsedS: 412.5,
    })
    expect(decodeRuntimeReadiness({ status: 'ready', phase: 'ready', workflowRuntime: 'ready' }).status).toBe('ready')
    expect(decodeRuntimeReadiness({ status: 'failed', error: 'audit failed' })).toMatchObject({ status: 'failed', error: 'audit failed' })
    expect(decodeRuntimeReadiness('weird').status).toBe('unknown')
  })

  it('classifies starting and unreachable backends apart from business failures', () => {
    const error = (options: ConstructorParameters<typeof TransportError>[0]) => new TransportError(options)
    expect(isBackendUnavailableError(error({ code: 'OS_STARTING', message: 'OS 正在启动', status: 503 }))).toBe(true)
    expect(isBackendUnavailableError(error({ code: 'HTTP_REQUEST_FAILED', message: 'HTTP 500', status: 500 }))).toBe(true)
    expect(isBackendUnavailableError(error({ code: 'HTTP_REQUEST_FAILED', message: 'HTTP 502', status: 502 }))).toBe(true)
    expect(isBackendUnavailableError(error({ code: 'HTTP_REQUEST_FAILED', message: 'Failed to fetch' }))).toBe(true)
    expect(
      isBackendUnavailableError(
        error({ code: 'WORKFLOW_ERROR', message: '编译失败', status: 500, cause: { error: { code: 'WORKFLOW_ERROR' } } }),
      ),
    ).toBe(false)
    expect(isBackendUnavailableError(error({ code: 'HTTP_REQUEST_ABORTED', message: '请求已中止或超时' }))).toBe(false)
    expect(isBackendUnavailableError(error({ code: 'NOT_FOUND', message: 'missing', status: 404 }))).toBe(false)
    expect(isBackendUnavailableError(new Error('plain'))).toBe(false)
  })

  it('reads progress from the readiness route and from 503 bodies', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        throw new TransportError({
          code: 'OS_STARTING',
          message: 'OS 正在启动',
          status: 503,
          cause: { readiness: { status: 'starting', label: '发布工作流 3/10', progress: { done: 3, total: 10 } } },
        })
      },
    }
    const readiness = await new RuntimeReadinessClient(transport).getReadiness()
    expect(requests[0]?.url).toBe('/api/v1/readiness')
    expect(readiness).toMatchObject({ status: 'starting', label: '发布工作流 3/10', progress: { done: 3, total: 10 } })
  })
})
