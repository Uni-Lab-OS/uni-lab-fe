import type {
  WorkbenchEndpointProbeResult,
  WorkbenchProductionConnectionConfiguration,
  WorkbenchProductionConnectionProbe
} from './index'

export interface ProductionEndpointProbeOptions {
  timeoutMs?: number
  fetcher?: typeof fetch
  now?: () => number
}

/**
 * 校验并规范化生产端点，保留部署方配置的路径。
 *
 * @param value 用户输入的端点地址。
 * @param label 错误信息中使用的领域名称。
 * @returns 去掉末尾斜杠的 HTTP(S) URL。
 * @throws 地址为空、协议不受支持或 URL 语法无效时抛出错误。
 */
export function normalizeProductionEndpoint(
  value: string,
  label: string
): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} 地址不能为空`)
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`${label} 地址不是有效 URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} 地址只支持 HTTP 或 HTTPS`)
  }
  return parsed.toString().replace(/\/$/, '')
}

/**
 * 并行检测 Backend 与调度器（Scheduler）的 HTTP 网络可达性。
 *
 * @param configuration 两个已由调用方提供的生产端点。
 * @param options 超时时间和测试替身；默认每个请求五秒超时。
 * @returns 成对可达性结果；任何 HTTP 状态都表示传输层可达。
 * @throws 仅在输入 URL 不合法时抛出；网络错误投影进单端点结果。
 * @safety 只执行无凭据 GET，不写入配置、不触发调度或发布。
 */
export async function probeProductionEndpoints(
  configuration: WorkbenchProductionConnectionConfiguration,
  options: ProductionEndpointProbeOptions = {}
): Promise<WorkbenchProductionConnectionProbe> {
  const backendUrl = normalizeProductionEndpoint(
    configuration.backendUrl,
    'Backend'
  )
  const schedulerUrl = normalizeProductionEndpoint(
    configuration.schedulerUrl,
    '调度器（Scheduler）'
  )
  const fetcher = options.fetcher ?? globalThis.fetch
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? 5_000
  const [backend, scheduler] = await Promise.all([
    probeEndpoint(backendUrl, fetcher, now, timeoutMs),
    probeEndpoint(schedulerUrl, fetcher, now, timeoutMs)
  ])
  return {
    checkedAt: new Date(now()).toISOString(),
    backend,
    scheduler
  }
}

/**
 * 读取单个端点的最小 HTTP HEAD 响应并记录耗时。
 *
 * @param url 已规范化的 HTTP(S) 地址。
 * @param fetcher Node 侧 HTTP 实现或测试替身。
 * @param now 单调计时来源。
 * @param timeoutMs 请求超时毫秒数。
 * @returns 网络结果；HTTP 4xx/5xx 仍属于可达。
 * @safety 不携带凭据、不发送正文且不解析响应正文，避免暴露生产数据。
 */
async function probeEndpoint(
  url: string,
  fetcher: typeof fetch,
  now: () => number,
  timeoutMs: number
): Promise<WorkbenchEndpointProbeResult> {
  const startedAt = now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  timeout.unref?.()
  try {
    const response = await fetcher(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal
    })
    return {
      url,
      reachable: true,
      status: response.status,
      latencyMs: Math.max(0, now() - startedAt),
      message: `网络可达（HTTP ${response.status}）`
    }
  } catch (error) {
    const aborted = controller.signal.aborted
    return {
      url,
      reachable: false,
      status: null,
      latencyMs: Math.max(0, now() - startedAt),
      message: aborted
        ? `连接超时（${timeoutMs} ms）`
        : error instanceof Error ? error.message : '网络连接失败'
    }
  } finally {
    clearTimeout(timeout)
  }
}
