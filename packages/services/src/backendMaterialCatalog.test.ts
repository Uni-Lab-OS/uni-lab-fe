import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from './http'
import {
  loadBackendMaterialTemplateCatalog,
  loadBackendMaterialTemplateDetail
} from './backendMaterialCatalog'

describe('Backend 资源模板目录 adapter', () => {
  /** 验证 Backend 页码目录会完整遍历，并保持物料创建能力关闭。 */
  it('沿页码读取完整目录并保持物料创建关闭', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{
            uuid: 'template-device',
            name: 'community.devices.pump',
            display_name: 'Pump',
            resource_type: 'device',
            tags: ['liquid']
          }],
          has_more: true,
          page: 1,
          page_size: 100
        }
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{
            uuid: 'template-plate',
            name: 'community.resources.plate',
            display_name: '96 孔板',
            resource_type: 'resource',
            tags: ['plate']
          }],
          has_more: false,
          page: 2,
          page_size: 100
        }
      })

    await expect(
      loadBackendMaterialTemplateCatalog(mockHttp(request))
    ).resolves.toMatchObject({
      revision: expect.stringMatching(/^backend:/),
      stale: false,
      items: [
        {
          uuid: 'template-device',
          kind: 'device',
          sourceNamespace: 'backend',
          creation: { available: false }
        },
        {
          uuid: 'template-plate',
          kind: 'resource',
          creation: { available: false }
        }
      ]
    })
    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/v1/resource-templates?page=1&page_size=100',
      undefined
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/v1/resource-templates?page=2&page_size=100',
      undefined
    )
  })

  it('把 Backend config_schema 与 ui_overlay 映射为只读配置详情', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        uuid: 'template-device',
        name: 'community.devices.pump',
        display_name: 'Pump',
        resource_type: 'device',
        tags: [],
        description: '注射泵',
        config_schema: { type: 'object' },
        ui_overlay: { speed: { widget: 'number' } },
        handles: []
      }
    })

    await expect(
      loadBackendMaterialTemplateDetail(
        mockHttp(request),
        'template-device'
      )
    ).resolves.toMatchObject({
      uuid: 'template-device',
      description: '注射泵',
      configuration: {
        schema: { type: 'object' },
        uiSchema: { speed: { widget: 'number' } }
      },
      compatibility: {},
      assets: {}
    })
  })

  /** 验证 Backend 返回错误页码时关闭失败，避免重复读取同一页。 */
  it('拒绝没有推进的 Backend 页码', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        items: [],
        has_more: true,
        page: 2,
        page_size: 100
      }
    })

    await expect(
      loadBackendMaterialTemplateCatalog(mockHttp(request))
    ).rejects.toMatchObject({
      code: 'INVALID_BACKEND_RESOURCE_TEMPLATE'
    })
  })
})

/**
 * 创建只实现 request 的 HTTP 测试替身。
 *
 * @param request Vitest 请求桩。
 * @returns 满足 adapter 所需边界的 HttpClient。
 */
function mockHttp(request: ReturnType<typeof vi.fn>): HttpClient {
  return {
    request
  }
}
