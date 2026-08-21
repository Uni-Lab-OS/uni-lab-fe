import { describe, expect, it } from 'vitest'

import { getDefaultBackend } from './backends'
import { createServices } from './createServices'
import {
  catalogResponses,
  defaultCatalogPath,
  nodeUuid,
  workflowCatalogPath
} from './workflow-action-catalog.fixtures'

describe('服务组合根的动作目录缓存', () => {
  it('同一 Authority 的设备与工作流调用共享一次目录加载', async () => {
    const requests: string[] = []
    const services = createServices({
      backend: getDefaultBackend('local-go'),
      fetcher: fixtureFetcher({
        ...catalogResponses(),
        '/api/v1/devices': { code: 0, data: [] }
      }, requests)
    })

    try {
      await Promise.all([
        services.laboratory.getOnlineDevices(),
        services.workflow.getWorkflowActionCatalog()
      ])
      await services.workflow.getWorkflowActionCatalog()
      await services.laboratory.getOnlineDevices()

      expect(count(requests, defaultCatalogPath)).toBe(1)
      expect(count(requests, workflowCatalogPath)).toBe(1)
      expect(count(
        requests,
        `/api/v1/workflow-node-templates/${nodeUuid}`
      )).toBe(1)
      // 设备恢复轮次只重新读取轻量 `/devices`，不重复扫描模板详情。
      expect(count(requests, '/api/v1/devices')).toBe(2)
    } finally {
      services.dispose()
    }
  })

  it('显式刷新会读取新的动作目录代际', async () => {
    const requests: string[] = []
    const services = createServices({
      backend: getDefaultBackend('local-go'),
      fetcher: fixtureFetcher(catalogResponses(), requests)
    })

    try {
      await services.workflow.getWorkflowActionCatalog()
      await services.workflow.getWorkflowActionCatalog(undefined, {
        refresh: true
      })

      expect(count(requests, defaultCatalogPath)).toBe(2)
      expect(count(requests, workflowCatalogPath)).toBe(2)
      expect(count(
        requests,
        `/api/v1/workflow-node-templates/${nodeUuid}`
      )).toBe(2)
    } finally {
      services.dispose()
    }
  })
})

function fixtureFetcher(
  responses: Record<string, unknown>,
  requests: string[]
): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const path = `${url.pathname}${url.search}`
    requests.push(path)
    if (!Object.prototype.hasOwnProperty.call(responses, path)) {
      throw new Error(`出现未声明请求路径：${path}`)
    }
    return new Response(JSON.stringify(responses[path]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }) as typeof fetch
}

function count(paths: readonly string[], target: string): number {
  return paths.filter((path) => path === target).length
}
