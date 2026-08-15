import { describe, expect, it, vi } from 'vitest'

import { getDefaultBackend } from './backends'
import { resolveServerCapabilities } from './capabilities'
import type { HttpClient } from './http'
import { mapBackendMaterialGraph } from './materialBackendGraphCodec'
import { createMaterialService } from './materials'

describe('Backend 物料 2.5D 外形投影', () => {
  /** 验证服务适配器只提升冻结外形的 bundle/id，不依赖业务 config 推断身份。 */
  it('projects the frozen bundle and id into the material aggregate', () => {
    const [aggregate] = mapBackendMaterialGraph({
      nodes: [backendNode({
        shape: {
          bundle: 'szlab-poly-studio',
          id: 'capped_reagent_bottle',
          categories: ['liquid-reagent'],
          parts: [{ type: 'lathe', style: 'glass' }]
        }
      })]
    })

    expect(aggregate?.shapeIdentity).toEqual({
      bundle: 'szlab-poly-studio',
      id: 'capped_reagent_bottle'
    })
    expect(
      (aggregate?.material.config.rendering as Record<string, unknown>).kind
    ).toBe('custom')
  })

  /** 验证外形目录随物料图刷新重新请求，创建新物料后不会继续复用旧集合。 */
  it('refetches the material shape collection on every port read', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: { items: [publicShape('first')] } })
      .mockResolvedValueOnce({ data: { items: [publicShape('second')] } })
    // http 是当前 Backend 的传输替身，只验证公开端点调用次数与响应解析。
    const http: HttpClient = {
      request: async <ResponseValue>(path: string, init?: RequestInit) =>
        request(path, init) as Promise<ResponseValue>
    }
    const backend = getDefaultBackend('local-go')
    const service = createMaterialService(
      http,
      backend,
      resolveServerCapabilities(backend)
    )

    await expect(service.getShapeLibrary?.()).resolves.toMatchObject([
      { id: 'first' }
    ])
    await expect(service.getShapeLibrary?.()).resolves.toMatchObject([
      { id: 'second' }
    ])
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/v1/material-shapes',
      undefined
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/v1/material-shapes',
      undefined
    )
  })
})

/**
 * 构造 Backend 公共物料图中的最小根物料节点。
 *
 * @param options.shape 创建时冻结到相对位置的可选外形对象。
 * @returns 可直接交给物料图解码器的 wire 节点。
 */
function backendNode(options: {
  shape?: Record<string, unknown>
}): Record<string, unknown> {
  return {
    material: {
      uuid: 'material-bottle',
      resource_template_uuid: 'template-bottle',
      type: 'resource',
      revision: 1,
      class: 'community.szlab.bottle',
      barcode: '',
      name: '100 mL 试剂瓶',
      create_time: '2026-08-14T00:00:00Z',
      update_time: '2026-08-14T00:00:00Z',
      meta_data: {},
      config: {},
      data: {}
    },
    relative_position: {
      uuid: 'position-bottle',
      material_uuid: 'material-bottle',
      shape: options.shape ?? {},
      position_x: 0,
      position_y: 0,
      position_z: 0,
      width: 56,
      length: 56,
      depth: 105,
      rotation_x: 0,
      rotation_y: 0,
      rotation_z: 0
    },
    sites: [],
    current_site_uuid: null,
    handles: [],
    resource_template: {
      uuid: 'template-bottle',
      name: 'community.szlab.bottle',
      display_name: '100 mL 试剂瓶',
      resource_type: 'resource'
    }
  }
}

/**
 * 构造 `/api/v1/material-shapes` 的一条合法公共外形。
 *
 * @param id 包内稳定外形身份。
 * @returns 能被前端 Shape 解析器接受的 wire 对象。
 */
function publicShape(id: string): Record<string, unknown> {
  return {
    id,
    bundle: 'test-bundle',
    categories: [id],
    categoryTokens: [],
    priority: 0,
    units: 'mm',
    shadow: 'box',
    sort: 'center',
    parts: [
      {
        type: 'box',
        style: 'body',
        from: [0, 0, 0],
        to: [1, 1, 1]
      }
    ]
  }
}
