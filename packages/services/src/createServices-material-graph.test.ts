import { describe, expect, it } from 'vitest'

import { getDefaultBackend } from './backends'
import { createServices } from './createServices'

// 框架节点模板 UUID 标识组合测试中的唯一物料来源（MaterialSource）合同。
const frameworkTemplateUuid = '21000000-0000-4000-8000-000000000001'
// 框架所有者 UUID 标识物料来源节点所属资源模板。
const frameworkOwnerUuid = '31000000-0000-4000-8000-000000000001'
// 框架句柄 UUID 标识物料来源输出的物料占位符（ResourceSlot）。
const frameworkHandleUuid = '41000000-0000-4000-8000-000000000001'
// 物料 UUID 标识由公共物料图返回的孔板实例。
const materialUuid = '52000000-0000-4000-8000-000000000001'
// 物料资源模板 UUID 标识孔板实例的来源类型。
const materialTemplateUuid = '62000000-0000-4000-8000-000000000001'
// 目录指纹冻结组合测试读取的工作流模板版本。
const fingerprint = `sha256:${'c'.repeat(64)}`
// 节点模板路径证明物料来源（MaterialSource）始终使用显式 node_type 筛选。
const materialSourceCatalogPath =
  '/api/v1/workflow-node-templates?page=1&page_size=100&node_type=material_source'

/**
 * 注册服务组合根（Composition Root）对公共物料服务（Material Service）的装配测试。
 *
 * @returns 不返回值；工作流运行时绕过公共物料服务时由 Vitest 报告失败。
 * @throws 测试注册失败时由 Vitest 报告异常。
 */
function registerCreateServicesMaterialGraphTests(): void {
  it(
    '工作流物料来源（MaterialSource）目录经组合根（Composition Root）复用公共物料服务（Material Service）读取公共物料图（MaterialGraph）',
    composesWorkflowWithPublicMaterialService
  )
}

describe(
  '服务组合根（Composition Root）的公共物料图（MaterialGraph）装配',
  registerCreateServicesMaterialGraphTests
)

/**
 * 验证组合根（Composition Root）创建的工作流运行时（Workflow Runtime）只经公共 `/materials/graph` 获取物料事实。
 *
 * @returns Promise 完成时表示目录可用、公共图只读取一次且私有库存路径从未出现。
 */
async function composesWorkflowWithPublicMaterialService(): Promise<void> {
  // 请求路径集合审计组合根（Composition Root）实际触达的公开接口边界。
  const requests: string[] = []
  // 服务集合由真实组合根创建，用于验证工作流运行时（Workflow Runtime）复用公共物料服务。
  const services = createServices({
    backend: getDefaultBackend('local-python'),
    fetcher: fixtureFetcher(serviceResponses(), requests)
  })

  try {
    const catalog = await services.workflow.getWorkflowMaterialSourceCatalog()

    expect(catalog.materials).toEqual([{
      uuid: materialUuid,
      name: 'Assay plate',
      resourceTemplateUuid: materialTemplateUuid
    }])
    expect(requests).toEqual([
      materialSourceCatalogPath,
      `/api/v1/workflow-node-templates/${frameworkTemplateUuid}`,
      '/api/v1/materials/graph',
      '/api/v1/resource-templates?page=1&page_size=100',
      '/api/v1/material-shapes'
    ])
    expect(countMatchingPath(requests, '/api/v1/materials/graph')).toBe(1)
    expect(hasPathPrefix(requests, '/api/v1/inventory/')).toBe(false)
  } finally {
    services.dispose()
  }
}

/**
 * 构造服务组合测试的公开 API 响应。
 *
 * @returns 工作流框架模板与公共物料图响应，不包含私有库存（Inventory）端点。
 */
function serviceResponses(): Record<string, unknown> {
  return {
    [materialSourceCatalogPath]: {
      code: 0,
      data: {
        authority: { authority_id: 'os-local', kind: 'local' },
        catalog_fingerprint: fingerprint,
        items: [{
          uuid: frameworkTemplateUuid,
          name: 'material_source',
          display_name: 'Material Source',
          type: 'material_source',
          node_type: 'material_source',
          resource_template: {
            uuid: frameworkOwnerUuid,
            name: 'host_node',
            display_name: 'Host node'
          }
        }],
        has_more: false,
        next_cursor_uuid: null
      }
    },
    [`/api/v1/workflow-node-templates/${frameworkTemplateUuid}`]: {
      code: 0,
      data: {
        authority: { authority_id: 'os-local', kind: 'local' },
        catalog_fingerprint: fingerprint,
        template: {
          uuid: frameworkTemplateUuid,
          resource_template_uuid: frameworkOwnerUuid,
          name: 'material_source',
          display_name: 'Material Source',
          class: 'unilabos.workflow.authoring:material_source',
          type: 'material_source',
          node_type: 'material_source',
          schema: null,
          goal: {},
          goal_default: {},
          meta_data: {}
        },
        handles: [{
          uuid: frameworkHandleUuid,
          workflow_node_template_uuid: frameworkTemplateUuid,
          handle_key: 'material',
          io_type: 'source',
          display_name: 'Material',
          type: 'ResourceSlot',
          required: false,
          data_source: 'executor',
          data_key: 'material',
          meta_data: {}
        }]
      }
    },
    '/api/v1/materials/graph': {
      code: 0,
      data: {
        nodes: [{
          material: {
            uuid: materialUuid,
            resource_template_uuid: materialTemplateUuid,
            type: 'resource',
            revision: 1,
            barcode: 'plate-1',
            name: 'Assay plate',
            create_time: '2026-08-05T00:00:00Z',
            update_time: '2026-08-05T00:00:00Z',
            config: {},
            meta_data: {},
            data: {}
          },
          relative_position: null,
          sites: [],
          current_site_uuid: null,
          handles: [],
          resource_template: {
            uuid: materialTemplateUuid,
            name: 'assay_plate',
            display_name: 'Assay plate',
            resource_type: 'resource'
          }
        }]
      }
    }
  }
}

/**
 * 构造只允许读取声明路径的 Fetch 边界 fixture。
 *
 * @param responses 公开 API 相对路径到 JSON 响应的映射。
 * @param requests 接收实际请求路径的审计数组。
 * @returns 与浏览器 Fetch 兼容的测试函数。
 */
function fixtureFetcher(
  responses: Record<string, unknown>,
  requests: string[]
): typeof fetch {
  /**
   * 返回指定公开路径的 JSON 响应。
   *
   * @param input 由 HTTP 客户端生成的绝对请求地址。
   * @param _init 请求配置；本测试只审计读取路径，不改变响应。
   * @returns 成功 JSON Response。
   * @throws 请求私有或未声明路径时抛出异常。
   */
  async function fetchFixture(
    input: RequestInfo | URL,
    _init?: RequestInit
  ): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const path = `${url.pathname}${url.search}`
    requests.push(path)
    if (!Object.prototype.hasOwnProperty.call(responses, path)) {
      throw new Error(`出现未声明请求路径: ${path}`)
    }
    return new Response(JSON.stringify(responses[path]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return fetchFixture as typeof fetch
}

/**
 * 统计请求审计集合中与目标路径完全相同的次数。
 *
 * @param paths 已记录的 HTTP 相对请求路径。
 * @param target 要精确匹配的目标路径。
 * @returns 目标路径出现的次数。
 */
function countMatchingPath(paths: readonly string[], target: string): number {
  let matches = 0
  for (const path of paths) {
    if (path === target) matches += 1
  }
  return matches
}

/**
 * 判断请求审计集合是否包含指定路径前缀。
 *
 * @param paths 已记录的 HTTP 相对请求路径。
 * @param prefix 要检查的路径前缀。
 * @returns 存在匹配路径时返回 `true`，否则返回 `false`。
 */
function hasPathPrefix(paths: readonly string[], prefix: string): boolean {
  for (const path of paths) {
    if (path.startsWith(prefix)) return true
  }
  return false
}
