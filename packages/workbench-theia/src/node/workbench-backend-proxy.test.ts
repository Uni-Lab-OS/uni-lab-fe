import { afterEach, describe, expect, it } from 'vitest'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { json, Router } from '@theia/core/shared/express'

import {
  WORKBENCH_BACKEND_PROXY_PREFIX,
  WORKBENCH_LOCAL_PROXY_PREFIX,
  WORKBENCH_MATERIAL_MODEL_PROXY_PREFIX,
  WorkbenchBackendProxyContribution,
  resolveWorkbenchBackendProxyTarget,
  resolveWorkbenchBackendProxyTargetFromSession,
  serializeWorkbenchBackendRequestBody,
  writeWorkbenchBackendResponse,
  workbenchBackendUpstreamUrl
} from './workbench-backend-proxy'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve())
  })))
})

async function listen(server: Server): Promise<number> {
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  return address.port
}

describe('Workbench Backend same-origin proxy', () => {
  /** 证明代理只移除 Workbench 私有前缀，并完整保留公开 API 路径和查询串。 */
  it('rewrites a public Backend request without changing its contract', () => {
    expect(workbenchBackendUpstreamUrl(
      `${WORKBENCH_BACKEND_PROXY_PREFIX}/api/v1/workflows?page=2`,
      'http://127.0.0.1:8080'
    )).toBe('http://127.0.0.1:8080/api/v1/workflows?page=2')
  })

  /** 证明缺省目标是本地 Backend，且环境变量可以在启动时显式覆盖。 */
  it('resolves a configured Backend target at process startup', () => {
    expect(resolveWorkbenchBackendProxyTarget(undefined))
      .toBe('http://127.0.0.1:8080')
    expect(resolveWorkbenchBackendProxyTarget('http://localhost:9000/'))
      .toBe('http://localhost:9000')
  })

  /** 两个代理入口必须固定到各自权威，不能被当前已提交模式串线。 */
  it('resolves Local and Backend targets independently of current mode', () => {
    expect(resolveWorkbenchBackendProxyTargetFromSession({
      configuredDomainMode: 'local',
      configuredBackendUrl: null,
      identity: { backendUrl: 'http://127.0.0.1:54865' }
    }, 'http://127.0.0.1:18080', 'local'))
      .toBe('http://127.0.0.1:54865')

    expect(resolveWorkbenchBackendProxyTargetFromSession({
      configuredDomainMode: 'local',
      configuredBackendUrl: 'http://127.0.0.1:18080',
      identity: { backendUrl: 'http://127.0.0.1:62030' }
    }, 'http://127.0.0.1:8080', 'backend'))
      .toBe('http://127.0.0.1:18080')

    expect(workbenchBackendUpstreamUrl(
      `${WORKBENCH_LOCAL_PROXY_PREFIX}/api/v1/health`,
      'http://127.0.0.1:54865'
    )).toBe('http://127.0.0.1:54865/api/v1/health')
  })

  /** 公共模型路径原样转发；不借用 Backend 私有前缀改写接口权威。 */
  it('preserves the public material model asset path', () => {
    expect(workbenchBackendUpstreamUrl(
      `${WORKBENCH_MATERIAL_MODEL_PROXY_PREFIX}/szlab/device.xacro`,
      'http://127.0.0.1:54865'
    )).toBe(
      'http://127.0.0.1:54865/api/v1/material-models/szlab/device.xacro'
    )
  })

  /** 只有公共模型路径回源 Workspace；Backend 私有入口始终保持 Go Backend。 */
  it('proxies only the public model route to Workspace Backend', async () => {
    const upstream = (authority: string) => createServer((_request, response) => {
      response.setHeader('content-type', 'text/plain')
      response.end(authority)
    })
    const localPort = await listen(upstream('workspace'))
    const backendPort = await listen(upstream('go-backend'))
    const contribution = new WorkbenchBackendProxyContribution()
    const earlyMiddleware = { handlers: [] as ReturnType<typeof Router>[] }
    Object.assign(contribution, {
      configuredTarget: `http://127.0.0.1:${backendPort}`,
      earlyMiddleware,
      logger: { warn() {} },
      sessions: {
        async getSnapshot() {
          return {
            configuredDomainMode: 'backend',
            configuredBackendUrl: `http://127.0.0.1:${backendPort}`,
            identity: { backendUrl: `http://127.0.0.1:${localPort}` }
          }
        }
      }
    })
    contribution.initialize()
    const app = Router()
    earlyMiddleware.handlers.forEach(handler => app.use(handler))
    const proxyPort = await listen(createServer(app as unknown as (
      request: IncomingMessage,
      response: ServerResponse
    ) => void))

    const model = await fetch(
      `http://127.0.0.1:${proxyPort}/api/v1/material-models/szlab/device.xacro`
    )
    const shapes = await fetch(
      `http://127.0.0.1:${proxyPort}${WORKBENCH_BACKEND_PROXY_PREFIX}/api/v1/material-shapes`
    )

    expect(await model.text()).toBe('workspace')
    expect(await shapes.text()).toBe('go-backend')
  })

  /** 证明危险或含凭证的代理目标会在启动时失败关闭。 */
  it.each([
    'file:///tmp/backend.sock',
    'http://user:secret@127.0.0.1:8080',
    'not-a-url'
  ])('rejects an invalid proxy target %s', (target) => {
    expect(() => resolveWorkbenchBackendProxyTarget(target)).toThrow(
      'UNILAB_BACKEND_PROXY_TARGET'
    )
  })

  /** 证明代理写回响应时不会把 Backend 的 201 Created 降为 200 OK。 */
  it('preserves the upstream status, headers and body', async () => {
    const headers = new Map<string, string>()
    let body = ''
    let statusCode = 200
    const response = {
      setHeader(name: string, value: string | number | readonly string[]) {
        headers.set(name, String(value))
        return this
      },
      writeHead(value: number) {
        statusCode = value
        return this
      },
      write(value: string | Buffer) {
        body += Buffer.isBuffer(value) ? value.toString() : value
        return true
      },
      once() {
        return this
      },
      end(value?: string | Buffer) {
        body += Buffer.isBuffer(value) ? value.toString() : String(value ?? '')
        return this
      }
    } as unknown as Pick<
      ServerResponse,
      'setHeader' | 'writeHead' | 'write' | 'end' | 'once'
    >

    await writeWorkbenchBackendResponse(
      response,
      new Response('{"code":0}', {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    )

    expect(statusCode).toBe(201)
    expect(headers.get('content-type')).toBe('application/json')
    expect(body).toBe('{"code":0}')
  })

  /** SSE 首帧必须在上游结束前写出，避免 Authority 切换后游标无法实时推进。 */
  it('streams SSE frames without buffering the response body', async () => {
    const writes: string[] = []
    let closeStream: (() => void) | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('id: 41\n'))
        closeStream = () => controller.close()
      }
    })
    let ended = false
    const response = {
      setHeader() { return this },
      writeHead() { return this },
      write(value: Buffer) {
        writes.push(value.toString())
        return true
      },
      once() { return this },
      end() {
        ended = true
        return this
      }
    } as unknown as Pick<
      ServerResponse,
      'setHeader' | 'writeHead' | 'write' | 'end' | 'once'
    >

    const forwarding = writeWorkbenchBackendResponse(
      response,
      new Response(stream, {
        headers: { 'content-type': 'text/event-stream' }
      })
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(writes).toEqual(['id: 41\n'])
    expect(ended).toBe(false)
    closeStream?.()
    await forwarding
    expect(ended).toBe(true)
  })

  /** 证明 Theia 已解析的 JSON 会被重新编码，而不是作为空请求转发。 */
  it('serializes an Express-parsed JSON request body', () => {
    const body = serializeWorkbenchBackendRequestBody({
      workflow_uuid: 'workflow-1',
      inventory_bindings: []
    })

    expect(Buffer.from(body!).toString()).toBe(
      '{"workflow_uuid":"workflow-1","inventory_bindings":[]}'
    )
    expect(serializeWorkbenchBackendRequestBody(undefined)).toBeUndefined()
  })

  /** 大型工作流必须在 Theia 默认 100 KiB JSON parser 之前进入代理。 */
  it('registers before global JSON parsing so large workflow graphs pass', async () => {
    let upstreamBytes = 0
    const upstream = createServer((request, response) => {
      request.on('data', chunk => { upstreamBytes += Buffer.byteLength(chunk) })
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end('{"code":0}')
      })
    })
    const upstreamPort = await listen(upstream)

    const contribution = new WorkbenchBackendProxyContribution()
    const earlyMiddleware = { handlers: [] as ReturnType<typeof Router>[] }
    Object.assign(contribution, {
      configuredTarget: `http://127.0.0.1:${upstreamPort}`,
      earlyMiddleware,
      logger: { warn() {} },
      sessions: {
        async getSnapshot() {
          return {
            configuredDomainMode: 'backend',
            configuredBackendUrl: `http://127.0.0.1:${upstreamPort}`,
            identity: null
          }
        }
      }
    })
    contribution.initialize()

    const app = Router()
    earlyMiddleware.handlers.forEach(handler => app.use(handler))
    app.use(json())
    const proxyListener = app as unknown as (
      request: IncomingMessage,
      response: ServerResponse
    ) => void
    const proxyPort = await listen(createServer(proxyListener))
    const body = JSON.stringify({ graph: 'x'.repeat(256 * 1024) })

    const response = await fetch(
      `http://127.0.0.1:${proxyPort}${WORKBENCH_BACKEND_PROXY_PREFIX}/api/v1/workflows/workflow-1`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ code: 0 })
    expect(upstreamBytes).toBe(Buffer.byteLength(body))
  })
})
