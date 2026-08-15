import {
  EarlyExpressMiddleware,
  type BackendApplicationContribution
} from '@theia/core/lib/node'
import { ILogger } from '@theia/core/lib/common/logger'
import { Router } from '@theia/core/shared/express'
import { inject, injectable } from '@theia/core/shared/inversify'
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse
} from 'node:http'

import { WorkbenchSessionService } from './workbench-session-service'
import { DEFAULT_BACKEND_PROXY_TARGET } from './workbench-backend-proxy-config'

type Request = IncomingMessage & {
  originalUrl: string
  headers: IncomingHttpHeaders
  method: string
  body?: unknown
}
type Response = ServerResponse & {
  status(code: number): Response
  json(body: unknown): void
}

export const WORKBENCH_BACKEND_PROXY_PREFIX = '/__unilab_backend'
export const WORKBENCH_LOCAL_PROXY_PREFIX = '/__unilab_local'
export const WORKBENCH_MATERIAL_MODEL_PROXY_PREFIX = '/api/v1/material-models'
type WorkbenchProxyAuthority = 'local' | 'backend'
const REQUEST_HEADERS_TO_SKIP = new Set([
  'connection',
  'content-length',
  'host',
  'transfer-encoding'
])
const RESPONSE_HEADERS_TO_SKIP = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'transfer-encoding'
])

@injectable()
export class WorkbenchBackendProxyContribution
implements BackendApplicationContribution {
  @inject(ILogger)
  private readonly logger!: ILogger

  @inject(WorkbenchSessionService)
  private readonly sessions!: WorkbenchSessionService

  @inject(EarlyExpressMiddleware)
  private readonly earlyMiddleware!: EarlyExpressMiddleware

  private readonly configuredTarget = resolveWorkbenchBackendProxyTarget(
    process.env['UNILAB_BACKEND_PROXY_TARGET']
  )

  /**
   * 在 Theia Node 的最早中间件阶段挂载 Backend 同源代理。
   * @returns 无；代理目标逐请求取自可信 Workspace Host 快照，浏览器不能修改。
   */
  initialize(): void {
    const router = Router()
    const mountProxy = (
      prefix: string,
      authority: WorkbenchProxyAuthority
    ): void => {
      router.use(prefix, (request, response) => {
        void this.proxyRequest(
          authority,
          request as Request,
          response as Response
        ).catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          this.logger.warn(`Workbench Backend proxy failed: ${message}`)
          if (response.headersSent) {
            response.end()
            return
          }
          response.status(502).json({
            code: 502,
            error: {
              code: 'WORKBENCH_BACKEND_PROXY_UNAVAILABLE',
              msg: `Backend 连接失败：${message}`,
              retryable: true
            }
          })
        })
      })
    }
    mountProxy(WORKBENCH_LOCAL_PROXY_PREFIX, 'local')
    mountProxy(WORKBENCH_BACKEND_PROXY_PREFIX, 'backend')
    // 模型 URL 是包资产合同定义的公共绝对路径，只将这一条路径回源到
    // Workspace Backend；material-shapes 等业务接口仍由 Go Backend 提供。
    mountProxy(WORKBENCH_MATERIAL_MODEL_PROXY_PREFIX, 'local')
    // Theia 的文件下载贡献会全局安装默认 100 KiB JSON parser。工作流图可达
    // 8 MiB，因此代理必须在所有 configure() 中间件之前取得原始请求流。
    this.earlyMiddleware.handlers.push(router)
  }

  private async proxyRequest(
    authority: WorkbenchProxyAuthority,
    request: Request,
    response: Response
  ): Promise<void> {
    const snapshot = await this.sessions.getSnapshot()
    const target = resolveWorkbenchBackendProxyTargetFromSession(
      snapshot,
      this.configuredTarget,
      authority
    )
    await proxyWorkbenchBackendRequest(request, response, target)
  }
}

interface WorkbenchBackendProxySessionSnapshot {
  configuredDomainMode: 'local' | 'backend'
  configuredBackendUrl: string | null
  identity: { backendUrl: string } | null
}

/**
 * 按代理入口选择固定权威目标，切换预检不依赖当前已提交模式。
 * @param snapshot 当前 managed session，包含动态 Workspace Backend 与配置的 Go Backend。
 * @param configuredTarget 会话尚未就绪时的可信启动兜底。
 * @param authority 当前请求使用的专用代理入口。
 * @returns 已校验的 HTTP/HTTPS 根地址。
 */
export function resolveWorkbenchBackendProxyTargetFromSession(
  snapshot: WorkbenchBackendProxySessionSnapshot,
  configuredTarget: string | undefined,
  authority: WorkbenchProxyAuthority
): string {
  const liveTarget = authority === 'backend'
    ? snapshot.configuredBackendUrl ?? configuredTarget
    : snapshot.identity?.backendUrl
  if (!liveTarget) {
    throw new Error('Workspace Backend 尚未就绪')
  }
  return resolveWorkbenchBackendProxyTarget(liveTarget)
}

/**
 * 校验并规范 Theia 进程允许访问的 Backend 根地址。
 * @param configuredTarget 启动环境提供的可信配置，不接受浏览器输入。
 * @returns 去除结尾斜杠的 HTTP/HTTPS 根地址。
 * @throws 配置不是 HTTP/HTTPS URL 或包含凭证时抛出启动错误。
 */
export function resolveWorkbenchBackendProxyTarget(
  configuredTarget: string | undefined
): string {
  const value = configuredTarget?.trim() || DEFAULT_BACKEND_PROXY_TARGET
  try {
    const target = new URL(value)
    if (
      !['http:', 'https:'].includes(target.protocol) ||
      target.username ||
      target.password
    ) throw new Error('unsupported target')
    return target.toString().replace(/\/$/u, '')
  } catch {
    throw new Error(
      'UNILAB_BACKEND_PROXY_TARGET 必须是无凭证的 HTTP/HTTPS 地址'
    )
  }
}

/**
 * 将 Workbench 私有代理 URL 映射为 Backend 公开 URL。
 * @param originalUrl 浏览器发送的原始路径和查询串。
 * @param target 已校验的 Backend 根地址。
 * @returns 保留公开路径与查询串的上游绝对 URL。
 */
export function workbenchBackendUpstreamUrl(
  originalUrl: string,
  target: string
): string {
  const suffix = workbenchBackendPublicPath(originalUrl)
  return new URL(suffix || '/', `${target}/`).toString()
}

function workbenchBackendPublicPath(originalUrl: string): string {
  const prefix = [
    WORKBENCH_LOCAL_PROXY_PREFIX,
    WORKBENCH_BACKEND_PROXY_PREFIX
  ].find(candidate => originalUrl.startsWith(candidate))
  return prefix ? originalUrl.slice(prefix.length) : originalUrl
}

/**
 * 转发一项浏览器请求，并把 Backend HTTP 事实原样返回给调用方。
 * @param request Express 入站请求；请求体会完整缓冲后再转发。
 * @param response Express 出站响应；状态码和安全响应头来自 Backend。
 * @param target 已校验且由进程配置固定的 Backend 根地址。
 * @returns 上游响应体完成写回后结束。
 */
async function proxyWorkbenchBackendRequest(
  request: Request,
  response: Response,
  target: string
): Promise<void> {
  const method = request.method.toUpperCase()
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : await readRequestBody(request)
  const upstream = await fetch(
    workbenchBackendUpstreamUrl(request.originalUrl, target),
    {
      method,
      headers: forwardRequestHeaders(request),
      body: body as BodyInit | undefined,
      redirect: 'manual'
    }
  )
  await writeWorkbenchBackendResponse(response, upstream)
}

/**
 * 原样提交 Backend 响应，尤其保留 201、202、204 等非 200 成功状态。
 * @param response Theia Express 暴露的原生 Node 响应。
 * @param upstream Backend Fetch 响应。
 * @returns 上游响应体写完后结束；不再交给 Express send 重新解释状态。
 */
export async function writeWorkbenchBackendResponse(
  response: Pick<
    ServerResponse,
    'setHeader' | 'writeHead' | 'write' | 'end' | 'once'
  >,
  upstream: globalThis.Response
): Promise<void> {
  upstream.headers.forEach((value, name) => {
    if (!RESPONSE_HEADERS_TO_SKIP.has(name.toLowerCase())) {
      response.setHeader(name, value)
    }
  })
  response.writeHead(upstream.status)
  if (!upstream.body) {
    response.end()
    return
  }
  const reader = upstream.body.getReader()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (!response.write(Buffer.from(chunk.value))) {
        await new Promise<void>(resolve => response.once('drain', resolve))
      }
    }
    response.end()
  } finally {
    reader.releaseLock()
  }
}

/**
 * 复制端到端请求头并排除由 Node Fetch 重新计算的逐跳字段。
 * @param request Express 入站请求。
 * @returns 可直接交给 Fetch 的请求头集合。
 */
function forwardRequestHeaders(request: Request): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (REQUEST_HEADERS_TO_SKIP.has(name.toLowerCase()) || value === undefined) {
      continue
    }
    headers.set(name, Array.isArray(value) ? value.join(', ') : String(value))
  }
  headers.set('accept-encoding', 'identity')
  return headers
}

/**
 * 读取非 GET/HEAD 请求体，保证 JSON 动作与工作流命令不被代理截断。
 * @param request Express 入站请求流。
 * @returns 原始字节；空请求体返回 undefined。
 */
async function readRequestBody(
  request: Request
): Promise<Uint8Array | undefined> {
  const parsedBody = serializeWorkbenchBackendRequestBody(request.body)
  if (parsedBody) return parsedBody
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return undefined
  return new Uint8Array(Buffer.concat(chunks))
}

/**
 * 序列化 Theia Express 已经解析的请求体，防止代理转发空 JSON。
 * @param body Express body parser 发布的值；undefined 表示仍需读取原始流。
 * @returns 可交给 Fetch 的原始字节；无法表示的值返回 undefined。
 */
export function serializeWorkbenchBackendRequestBody(
  body: unknown
): Uint8Array | undefined {
  if (body === undefined) return undefined
  if (body instanceof Uint8Array) return body
  if (typeof body === 'string') return new TextEncoder().encode(body)
  const serialized = JSON.stringify(body)
  return serialized === undefined
    ? undefined
    : new TextEncoder().encode(serialized)
}
