import { describe, expect, it, vi } from 'vitest'

import { getDefaultBackend } from './backends'
import { resolveServerCapabilities } from './capabilities'
import { UnsupportedCapabilityError } from './errors'
import type { HttpClient } from './http'
import { createMaterialService } from './materials'

/**
 * 验证 OS 物料（Material）图只提供资源分类时，服务适配器仍保留可视化种类。
 * 参数：无，测试内部构造公开物料图响应。返回：完成异步断言的 Promise。
 * 异常：分类没有投影到 `rendering.kind` 时由 Vitest 断言失败。
 */
async function mapsMaterialCategoryToRenderingKind(): Promise<void> {
  const { http } = mockHttp({
    data: {
      nodes: [{
        material: {
          uuid: 'material-beaker',
          resource_template_uuid: 'template-beaker',
          type: 'resource',
          revision: 1,
          class: 'community.szlab.beaker',
          barcode: '',
          name: '500 mL 烧杯',
          create_time: '2026-08-06T00:00:00Z',
          update_time: '2026-08-06T00:00:00Z',
          meta_data: {},
          config: { category: 'beaker' },
          data: {}
        },
        relative_position: rawBackendPosition(
          'position-beaker',
          'material-beaker',
          [0, 0, 0],
          [86, 86, 120]
        ),
        sites: [],
        current_site_uuid: null,
        handles: [],
        resource_template: {
          uuid: 'template-beaker',
          name: 'community.szlab.beaker',
          display_name: '500 mL 烧杯',
          resource_type: 'resource'
        }
      }]
    }
  })
  const backend = getDefaultBackend('local-python')
  const service = createMaterialService(
    http,
    backend,
    resolveServerCapabilities(backend)
  )

  await expect(
    service.getGraph({ kind: 'singleton' })
  ).resolves.toEqual([
    expect.objectContaining({
      material: expect.objectContaining({
        config: expect.objectContaining({
          rendering: {
            kind: 'beaker',
            dimensionsMm: [86, 120, 86]
          }
        })
      })
    })
  ])
}

/** 验证无渲染配置的 Backend 台面仍保留左下角原点语义。 */
async function mapsDeckMaterialTypeToRenderingKind(): Promise<void> {
  const { http } = mockHttp({
    data: {
      nodes: [{
        material: {
          uuid: 'material-deck',
          resource_template_uuid: 'template-deck',
          type: 'deck',
          revision: 1,
          class: 'community.szlab.deck',
          barcode: '',
          name: 'SZLab 聚合物工作站台面',
          create_time: '2026-08-15T00:00:00Z',
          update_time: '2026-08-15T00:00:00Z',
          meta_data: { source_node_id: 'szlab_poly_deck' },
          config: { setup: false },
          data: {}
        },
        relative_position: rawBackendPosition(
          'position-deck',
          'material-deck',
          [0, 0, 20],
          [3634, 1674, 20]
        ),
        sites: [],
        current_site_uuid: null,
        handles: [],
        resource_template: {
          uuid: 'template-deck',
          name: 'community.szlab.deck',
          display_name: 'SZLab 聚合物工作站台面',
          resource_type: 'deck'
        }
      }]
    }
  })
  const backend = getDefaultBackend('local-python')
  const service = createMaterialService(
    http,
    backend,
    resolveServerCapabilities(backend)
  )

  await expect(
    service.getGraph({ kind: 'singleton' })
  ).resolves.toEqual([
    expect.objectContaining({
      material: expect.objectContaining({
        config: expect.objectContaining({
          rendering: {
            kind: 'deck',
            dimensionsMm: [3634, 20, 1674]
          }
        })
      })
    })
  ])
}

describe('material template adapter', () => {
  it(
    'uses the material category when the rendering kind is absent',
    mapsMaterialCategoryToRenderingKind
  )

  it(
    'uses the deck material type when rendering metadata is absent',
    mapsDeckMaterialTypeToRenderingKind
  )

  it('reads the complete Edge catalog without a fake laboratory ID', async () => {
    const { http, request } = mockHttp({
      data: {
        revision: 'sha256:catalog-1',
        stale: false,
        items: [rawTemplateSummary()]
      }
    })
    const backend = getDefaultBackend('local-python')
    const capabilities = resolveServerCapabilities(backend)
    capabilities.material.readTemplates = true
    const service = createMaterialService(
      http,
      backend,
      capabilities
    )

    const result = await service.listTemplates({ kind: 'singleton' })

    expect(request).toHaveBeenCalledWith(
      '/api/v1/resource-templates',
      undefined
    )
    expect(result).toEqual({
      revision: 'sha256:catalog-1',
      stale: false,
      items: [
        {
          uuid: 'template-1',
          key: 'plate-96',
          sourceNamespace: 'unilabos',
          kind: 'resource',
          displayName: '96 孔板',
          tags: ['container'],
          categoryPath: ['plates'],
          icon: 'resource',
          description: 'Standard plate',
          status: 'ready',
          statusReason: undefined,
          contentHash: 'sha256:template-1',
          creation: {
            mode: 'resource-tree',
            available: false,
            reason: '当前 Edge 尚未开放物料创建'
          }
        }
      ]
    })
  })

  it('maps normalized geometry, layout and same-origin assets', async () => {
    const { http, request } = mockHttp({
      data: {
        ...rawTemplateSummary(),
        geometry: {
          dimensions_mm: { x: 127.1, y: 85, z: 44.2 },
          origin_mm: { x: 0, y: 0, z: 0 },
          stack_height_mm: 44.2
        },
        container_layout: {
          type: 'grid',
          container_kind: 'well',
          rows: ['A', 'B'],
          columns: 2,
          column_labels: [1, 2],
          naming: 'row-column',
          geometry: {
            dimensions_mm: { x: 8, y: 8, z: 10 },
            depth_mm: 10,
            shape: 'circle',
            max_volume_ul: 200,
            pitch_mm: { x: 9, y: -9 },
            offset_mm: { x: 10, y: 20, z: 2 },
            first_key: 'A1'
          }
        },
        compatibility: { allowed_site_types: ['deck-slot'] },
        configuration: { schema: { type: 'object' }, ui_schema: {} },
        assets: {
          preview2d:
            '/api/v1/resource-templates/template-1/assets/preview-2d'
        }
      }
    })
    const backend = getDefaultBackend('local-python')
    const capabilities = resolveServerCapabilities(backend)
    capabilities.material.readTemplates = true
    const service = createMaterialService(
      http,
      backend,
      capabilities
    )

    await expect(
      service.getTemplate({ kind: 'singleton' }, 'template-1')
    ).resolves.toMatchObject({
      uuid: 'template-1',
      geometry: {
        dimensionsMm: { x: 127.1, y: 85, z: 44.2 }
      },
      containerLayout: {
        type: 'grid',
        rows: ['A', 'B'],
        columns: 2
      },
      compatibility: { allowedSiteTypes: ['deck-slot'] },
      assets: {
        preview2d:
          'http://127.0.0.1:18003/api/v1/resource-templates/template-1/assets/preview-2d'
      }
    })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/resource-templates/template-1',
      undefined
    )
  })

  it('rejects unavailable profiles before making a request', async () => {
    const { http, request } = mockHttp(undefined)
    const backend = getDefaultBackend('cloud')
    const service = createMaterialService(
      http,
      backend,
      resolveServerCapabilities(backend)
    )

    await expect(
      service.listTemplates({ kind: 'singleton' })
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError)
    expect(request).not.toHaveBeenCalled()
  })

  it('does not manufacture laboratory scope for the singleton adapter', async () => {
    const { http, request } = mockHttp(undefined)
    const backend = getDefaultBackend('local-python')
    const capabilities = resolveServerCapabilities(backend)
    capabilities.material.readTemplates = true
    const service = createMaterialService(
      http,
      backend,
      capabilities
    )

    await expect(
      service.listTemplates({
        kind: 'laboratory',
        laboratoryId: 'lab-1'
      })
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_MATERIAL_SCOPE'
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('gates every target Material Graph operation before transport', async () => {
    const { http, request } = mockHttp(undefined)
    const backend = getDefaultBackend('cloud')
    const service = createMaterialService(
      http,
      backend,
      resolveServerCapabilities(backend)
    )

    await expect(
      service.getGraph({ kind: 'singleton' })
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError)
    await expect(
      service.move({
        materialId: 'material-1',
        expectedRevision: 1,
        idempotencyKey: 'move-material-1',
        placement: { kind: 'unplaced' }
      })
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError)
    await expect(
      service.updateSite({
        materialId: 'material-1',
        siteId: 'site-1',
        expectedRevision: 1,
        patch: { name: 'Deck' }
      })
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError)
    await expect(
      service.attach({
        parentId: 'parent-1',
        childId: 'material-1',
        siteId: 'site-1',
        expectedParentRevision: 1,
        expectedChildRevision: 1,
        idempotencyKey: 'attach-material-1'
      })
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError)
    await expect(
      service.detach({
        parentId: 'parent-1',
        childId: 'material-1',
        expectedParentRevision: 1,
        expectedChildRevision: 1,
        idempotencyKey: 'detach-material-1'
      })
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError)
    await expect(
      service.getEdgeOperations({ kind: 'singleton' })
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError)

    expect(request).not.toHaveBeenCalled()
  })

  it('maps 2D attach to the strict OS site command and applies both aggregates', async () => {
    const { http, request } = mockHttp({
      command_id: 'attach-child-1',
      status: 'completed',
      result: { aggregates: rawRelationCommandNodes(true) }
    })
    const backend = getDefaultBackend('local-python')
    const service = createMaterialService(
      http,
      backend,
      resolveServerCapabilities(backend)
    )

    const result = await service.attach({
      parentId: 'parent-1',
      childId: 'child-1',
      siteId: 'site-1',
      expectedParentRevision: 4,
      expectedChildRevision: 2,
      idempotencyKey: 'attach-child-1'
    })

    expect(result.aggregates).toHaveLength(2)
    expect(result.aggregates.find((item) => item.material.id === 'child-1')?.placement)
      .toEqual({
        kind: 'site',
        parentId: 'parent-1',
        siteId: 'site-1',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/inventory/commands',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          command_id: 'attach-child-1',
          type: 'material.move',
          actor: 'operator:material-workbench',
          expected_version: 2,
          payload: {
            edge_uuid: 'child-1',
            parent_uuid: 'parent-1',
            site_uuid: 'site-1',
            expected_parent_version: 4
          }
        })
      })
    )
  })

  it('maps 2D detach to the strict OS command', async () => {
    const { http, request } = mockHttp({
      command_id: 'detach-child-1',
      status: 'completed',
      result: { aggregates: rawRelationCommandNodes(false) }
    })
    const backend = getDefaultBackend('local-python')
    const service = createMaterialService(
      http,
      backend,
      resolveServerCapabilities(backend)
    )

    const result = await service.detach({
      parentId: 'parent-1',
      childId: 'child-1',
      expectedParentRevision: 5,
      expectedChildRevision: 3,
      idempotencyKey: 'detach-child-1'
    })

    expect(result.aggregates.find((item) => item.material.id === 'child-1')?.placement)
      .toEqual({ kind: 'unplaced' })
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      command_id: 'detach-child-1',
      type: 'material.detach',
      expected_version: 3,
      payload: {
        edge_uuid: 'child-1',
        parent_uuid: 'parent-1',
        expected_parent_version: 5
      }
    })
  })

  /** 验证 Backend 物料图使用权威修订号并保留资源模板展示摘要。 */
  it('maps the frozen Backend MaterialGraph into shared aggregates', async () => {
    const { http, request } = mockHttp({
      data: {
        nodes: [
          {
            material: {
              uuid: 'material-root',
              resource_template_uuid: 'template-device',
              revision: 11,
              type: 'device',
              class: 'liquid_handler',
              barcode: 'LH-001',
              name: 'Liquid Handler',
              create_time: '2026-07-26T00:00:00Z',
              update_time: '2026-07-26T00:00:00Z',
              meta_data: { source_node_id: 'liquid-handler' },
              config: {
                rendering: { kind: 'table' }
              },
              data: {}
            },
            resource_template: {
              uuid: 'template-device',
              name: 'community.devices.liquid_handler',
              display_name: '移液工作站',
              resource_type: 'device',
              icon: 'robot'
            },
            relative_position: rawBackendPosition(
              'position-root',
              'material-root',
              [100, 200, 0],
              [1400, 720, 180]
            ),
            sites: [
              {
                uuid: 'site-a1',
                material_uuid: 'material-root',
                name: 'A1',
                meta_data: {
                  key: 'deck-A1',
                  kind: 'deck-slot',
                  rotation_deg_xyz: [0, 0, 72]
                },
                create_time: '2026-07-26T00:00:00Z',
                update_time: '2026-07-26T00:00:00Z',
                sort_order: 0,
                allowed_resource_template_uuids: ['template-vessel'],
                occupied_material_uuid: 'material-vessel',
                position_x: 10,
                position_y: 20,
                position_z: 30,
                width: 90,
                length: 100,
                depth: 120
              }
            ],
            current_site_uuid: null,
            handles: []
          },
          {
            material: {
              uuid: 'material-vessel',
              resource_template_uuid: 'template-vessel',
              revision: 12,
              type: 'resource',
              parent_uuid: 'material-root',
              class: 'sample_vial',
              barcode: '',
              name: 'Sample vial',
              create_time: '2026-07-26T00:00:00Z',
              update_time: '2026-07-26T00:00:01Z',
              meta_data: {},
              config: { rendering: { kind: 'vial' } },
              data: {}
            },
            resource_template: {
              uuid: 'template-vessel',
              name: 'community.resources.sample_vial',
              display_name: '样品瓶',
              resource_type: 'resource'
            },
            relative_position: rawBackendPosition(
              'position-vessel',
              'material-vessel',
              [120, 100, 30],
              [80, 80, 140]
            ),
            sites: [],
            current_site_uuid: 'site-a1',
            handles: []
          }
        ]
      }
    })
    const backend = getDefaultBackend('local-go')
    const service = createMaterialService(
      http,
      backend,
      resolveServerCapabilities(backend)
    )

    await expect(
      service.getGraph({ kind: 'singleton' })
    ).resolves.toEqual([
      {
        material: {
          id: 'material-root',
          sourceTemplateId: 'template-device',
          code: 'LH-001',
          name: 'Liquid Handler',
          description: undefined,
          config: expect.objectContaining({
            sourceIdentity: 'liquid-handler',
            resourceTemplate: {
              uuid: 'template-device',
              name: 'community.devices.liquid_handler',
              displayName: '移液工作站',
              resourceType: 'device',
              icon: 'robot'
            },
            rendering: {
              kind: 'table',
              dimensionsMm: [1400, 180, 720]
            }
          }),
          createdAt: '2026-07-26T00:00:00Z',
          updatedAt: '2026-07-26T00:00:00Z'
        },
        placement: {
          kind: 'world',
          pose: {
            positionMm: [100, 200, 0],
            rotationDegXYZ: [0, 0, 0]
          }
        },
        sites: [
          expect.objectContaining({
            id: 'site-a1',
            ownerMaterialId: 'material-root',
            key: 'deck-A1',
            sortOrder: 0,
            allowedTemplateIds: ['template-vessel'],
            occupiedMaterialIds: ['material-vessel'],
            poseInAnchor: {
              positionMm: [10, 20, 30],
              rotationDegXYZ: [0, 0, 72]
            }
          })
        ],
        revision: 11
      },
      {
        material: expect.objectContaining({
          id: 'material-vessel',
          sourceTemplateId: 'template-vessel',
          code: '',
          config: expect.objectContaining({
            resourceTemplate: {
              uuid: 'template-vessel',
              name: 'community.resources.sample_vial',
              displayName: '样品瓶',
              resourceType: 'resource'
            },
            rendering: {
              kind: 'vial',
              dimensionsMm: [80, 140, 80]
            }
          })
        }),
        placement: {
          kind: 'site',
          parentId: 'material-root',
          siteId: 'site-a1',
          offsetPose: {
            positionMm: [0, 0, 0],
            rotationDegXYZ: [0, 0, 0]
          }
        },
        sites: [],
        revision: 12
      }
    ])
    expect(request).toHaveBeenCalledWith(
      '/api/v1/materials/graph',
      undefined
    )
  })

  it('loads complete material graphs larger than the legacy Edge page limit', async () => {
    const { http, request } = mockHttp({
      data: {
        nodes: Array.from(
          { length: 126 },
          (_, index) => rawMaterialGraphNode(index + 1)
        )
      }
    })
    const backend = getDefaultBackend('local-python')
    const service = createMaterialService(
      http,
      backend,
      resolveServerCapabilities(backend)
    )

    const aggregates = await service.getGraph({ kind: 'singleton' })

    expect(aggregates).toHaveLength(126)
    expect(aggregates.at(-1)?.material.code).toBe('szlab-material-126')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      '/api/v1/materials/graph',
      undefined
    )
  })

  it('maps instance.moved SSE frames to one material move notification', () => {
    const listeners = new Map<string, (event: MessageEvent<string>) => void>()
    const close = vi.fn()
    const EventSourceMock = vi.fn(function (url: string) {
      expect(url).toBe(
        'http://127.0.0.1:18003/api/v1/monitor/events?channels=material&backlog=0'
      )
      return {
        addEventListener: (
          type: string,
          listener: (event: MessageEvent<string>) => void
        ) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
        close
      }
    })
    vi.stubGlobal('EventSource', EventSourceMock)
    try {
      const backend = getDefaultBackend('local-python')
      const service = createMaterialService(
        mockHttp(undefined).http,
        backend,
        resolveServerCapabilities(backend)
      )
      const onMove = vi.fn()

      const subscription = service.subscribeMoves?.(onMove)
      listeners.get('material')?.({
        data: JSON.stringify({
          seq: 42,
          channel: 'material',
          type: 'instance.moved',
          data: {
            aggregate_id: 'material-1',
            version: 7,
            payload: {
              from_parent: 'warehouse-1',
              from_slot: 'L1B1',
              to_parent: 'station-7',
              to_slot: 'S0721'
            }
          }
        }),
        lastEventId: '42'
      } as MessageEvent<string>)

      expect(onMove).toHaveBeenCalledWith({
        id: '42',
        materialId: 'material-1',
        revision: 7,
        fromParentId: 'warehouse-1',
        fromSite: 'L1B1',
        toParentId: 'station-7',
        toSite: 'S0721'
      })
      subscription?.dispose()
      expect(close).toHaveBeenCalledTimes(1)
      expect(listeners.has('material')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('creates a Registry template instance through the unified command', async () => {
    const { http, request } = mockHttp({
      data: {
        aggregates: [
          {
            uuid: 'material-created',
            resource_template_uuid: 'template-1',
            code: 'registry-plate',
            name: 'Registry Plate',
            create_time: '2026-07-29T00:00:00Z',
            update_time: '2026-07-29T00:00:00Z',
            revision: 2,
            config: {
              placement: { kind: 'unplaced' },
              sites: []
            }
          }
        ],
        primary_material_id: 'material-created',
        creation_operation_id: 'operation-created',
        edge_sync_state: 'synced'
      }
    })
    const backend = getDefaultBackend('local-python')
    const capabilities = resolveServerCapabilities(backend)
    capabilities.material.create = true
    const service = createMaterialService(
      http,
      backend,
      capabilities
    )

    await expect(
      service.createMaterial(
        { kind: 'singleton' },
        {
          templateId: 'template-1',
          name: 'Registry Plate',
          placement: { kind: 'unplaced' },
          initialContents: []
        }
      )
    ).resolves.toMatchObject({
      primaryMaterialId: 'material-created',
      creationOperationId: 'operation-created',
      edgeSyncState: 'synced',
      aggregates: [
        {
          material: {
            id: 'material-created',
            sourceTemplateId: 'template-1',
            name: 'Registry Plate'
          },
          placement: { kind: 'unplaced' },
          revision: 2
        }
      ]
    })

    const [path, init] = request.mock.calls[0] as [
      string,
      RequestInit
    ]
    expect(path).toBe('/api/v1/materials')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      template_id: 'template-1',
      name: 'Registry Plate',
      placement: { kind: 'unplaced' },
      initial_contents: [],
      expected_revision: 0,
      idempotency_key: expect.any(String)
    })
  })

  it('sends the revisioned create compensation command', async () => {
    const { http, request } = mockHttp({ data: {} })
    const backend = getDefaultBackend('local-python')
    const capabilities = resolveServerCapabilities(backend)
    capabilities.edge.undoCreate = true
    const service = createMaterialService(
      http,
      backend,
      capabilities
    )

    await service.undoCreate({
      materialId: 'material-created',
      creationOperationId: 'operation-created',
      expectedRevision: 2,
      idempotencyKey: 'undo-created'
    })

    expect(request).toHaveBeenCalledWith(
      '/api/v1/materials/material-created/undo-create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_operation_id: 'operation-created',
          expected_revision: 2,
          idempotency_key: 'undo-created'
        })
      }
    )
  })

  it('rejects malformed OS Material placement data', async () => {
    const { http } = mockHttp({
      data: {
        nodes: [
          {
            material: {
              uuid: 'material-bad',
              resource_template_uuid: 'template-device',
              type: 'device',
              revision: 1,
              barcode: 'bad',
              name: 'Bad material',
              create_time: '2026-07-26T00:00:00Z',
              update_time: '2026-07-26T00:00:00Z',
              config: {},
              data: {},
              meta_data: {},
              class: 'bad'
            },
            relative_position: {
              ...rawBackendPosition(
                'position-bad',
                'material-bad',
                [0, 0, 0],
                [100, 100, 100]
              ),
              rotation_z: 'not-a-number'
            },
            sites: [],
            current_site_uuid: null,
            handles: [],
            resource_template: {
              uuid: 'template-device',
              name: 'device.bad',
              display_name: 'Bad device',
              resource_type: 'device'
            }
          }
        ]
      }
    })
    const backend = getDefaultBackend('local-python')
    const service = createMaterialService(
      http,
      backend,
      resolveServerCapabilities(backend)
    )

    await expect(
      service.getGraph({ kind: 'singleton' })
    ).rejects.toMatchObject({
      code: 'INVALID_MATERIAL_GRAPH_RESPONSE'
    })
  })

  it('requires the same authoritative revision and template summary for Local graphs', async () => {
    const node = rawMaterialGraphNode(1)
    const material = node.material as Record<string, unknown>
    delete material.revision
    delete node.resource_template
    const backend = getDefaultBackend('local-python')
    const service = createMaterialService(
      mockHttp({ data: { nodes: [node] } }).http,
      backend,
      resolveServerCapabilities(backend)
    )

    await expect(
      service.getGraph({ kind: 'singleton' })
    ).rejects.toMatchObject({
      code: 'INVALID_MATERIAL_GRAPH_RESPONSE'
    })
  })
})

function rawBackendPosition(
  uuid: string,
  materialUuid: string,
  position: readonly [number, number, number],
  dimensions: readonly [number, number, number]
): Record<string, unknown> {
  return {
    uuid,
    material_uuid: materialUuid,
    create_time: '2026-07-26T00:00:00Z',
    update_time: '2026-07-26T00:00:00Z',
    meta_data: {},
    position_x: position[0],
    position_y: position[1],
    position_z: position[2],
    width: dimensions[0],
    length: dimensions[1],
    depth: dimensions[2],
    scale_x: 1,
    scale_y: 1,
    scale_z: 1,
    rotation_x: 0,
    rotation_y: 0,
    rotation_z: 0
  }
}

function rawTemplateSummary(): Record<string, unknown> {
  return {
    uuid: 'template-1',
    key: 'plate-96',
    source_namespace: 'unilabos',
    kind: 'resource',
    display_name: '96 孔板',
    description: 'Standard plate',
    category_path: ['plates'],
    tags: ['container'],
    icon: 'resource',
    status: 'ready',
    content_hash: 'sha256:template-1',
    creation: {
      mode: 'resource-tree',
      available: false,
      reason: '当前 Edge 尚未开放物料创建'
    }
  }
}

function rawMaterialGraphNode(index: number): Record<string, unknown> {
  const materialId = `szlab-material-${index}`
  return {
    material: {
      uuid: materialId,
      resource_template_uuid: 'template-device',
      type: 'device',
      barcode: materialId,
      name: `SZLab Material ${index}`,
      create_time: '2026-07-31T00:00:00Z',
      update_time: '2026-07-31T00:00:00Z',
      revision: index,
      meta_data: {},
      config: {},
      data: {}
    },
    sites: [],
    current_site_uuid: null,
    handles: [],
    resource_template: {
      uuid: 'template-device',
      name: 'device.template',
      display_name: 'Device template',
      resource_type: 'device'
    }
  }
}

function rawRelationCommandNodes(attached: boolean): Record<string, unknown>[] {
  const parent = rawMaterialGraphNode(1)
  const parentMaterial = parent.material as Record<string, unknown>
  parentMaterial.uuid = 'parent-1'
  parentMaterial.name = 'Parent'
  parentMaterial.revision = attached ? 5 : 6
  parent.sites = [{
    uuid: 'site-1',
    material_uuid: 'parent-1',
    name: 'A1',
    meta_data: { key: 'A1', kind: 'deck-slot' },
    sort_order: 0,
    allowed_resource_template_uuids: ['template-device'],
    occupied_material_uuid: attached ? 'child-1' : null,
    position_x: 0,
    position_y: 0,
    position_z: 0,
    width: 100,
    length: 80,
    depth: 10
  }]

  const child = rawMaterialGraphNode(2)
  const childMaterial = child.material as Record<string, unknown>
  childMaterial.uuid = 'child-1'
  childMaterial.name = 'Child'
  childMaterial.revision = attached ? 3 : 4
  childMaterial.parent_uuid = attached ? 'parent-1' : null
  child.current_site_uuid = attached ? 'site-1' : null
  return [parent, child]
}

function mockHttp(response: unknown): {
  http: HttpClient
  request: ReturnType<typeof vi.fn>
} {
  const request = vi.fn().mockResolvedValue(response)
  return {
    http: {
      request: async <ResponseValue>(
        path: string,
        init?: RequestInit
      ): Promise<ResponseValue> =>
        request(path, init) as Promise<ResponseValue>
    },
    request
  }
}
