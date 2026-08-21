import type {
  MaterialAggregate,
  MaterialGraphPort,
  MaterialScope,
  MaterialSite
} from '@unilab/material'
import { describe, expect, it } from 'vitest'

import { getDefaultBackend } from './backends'
import type { HttpClient } from './http'
import { createWorkflowRuntime } from './workflow'

// 框架节点模板 UUID 标识唯一的物料来源（MaterialSource）创作节点合同。
const frameworkTemplateUuid = '21000000-0000-4000-8000-000000000001'
// 框架所有者 UUID 标识承载非动作物料来源节点的资源模板。
const frameworkOwnerUuid = '31000000-0000-4000-8000-000000000001'
// 框架句柄 UUID 标识物料来源输出的物料占位符（ResourceSlot）。
const frameworkHandleUuid = '41000000-0000-4000-8000-000000000001'
// 挂载物料 UUID 标识直接拥有候选库位（Site）的 Deck 实例。
const mountUuid = '51000000-0000-4000-8000-000000000001'
// 被占用物料 UUID 标识已放置在第二库位中的孔板实例。
const materialUuid = '52000000-0000-4000-8000-000000000001'
// 挂载资源模板 UUID 标识 Deck 的类型身份。
const mountTemplateUuid = '61000000-0000-4000-8000-000000000001'
// 样品资源模板 UUID 标识候选孔板类型。
const sampleTemplateUuid = '62000000-0000-4000-8000-000000000001'
// 第一库位 UUID 在相同 sort_order 下字典序较大。
const firstSiteUuid = '71000000-0000-4000-8000-000000000009'
// 第二库位 UUID 在相同 sort_order 下字典序较小且具有库位占用（SiteOccupancy）。
const secondSiteUuid = '71000000-0000-4000-8000-000000000001'
// 目录指纹冻结工作流模板目录的权威版本。
const fingerprint = `sha256:${'b'.repeat(64)}`
const materialSourceCatalogPath =
  '/api/v1/workflow-node-templates?page=1&page_size=100&node_type=material_source'

/** 构造 OS 发布的 MaterialSource 闭合参数与库位选择器 Schema。 */
function materialSourceSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['existing', 'create_new']
      },
      resource_template_uuid: {
        type: 'string',
        format: 'uuid'
      },
      mount: {
        type: 'object',
        properties: {
          uuid: { type: 'string', format: 'uuid' }
        },
        required: ['uuid'],
        additionalProperties: false
      },
      material_uuid: {
        type: ['string', 'null'],
        format: 'uuid'
      },
      site: {
        type: ['string', 'null'],
        format: 'uuid',
        'x-unilabos-editor-control': 'site_selector',
        'x-unilabos-site-selector': {
          version: 1,
          owner: 'mount',
          occupant: 'resource_template_uuid',
          show_occupied: true,
          allow_occupied: false
        }
      },
      slot_range: {
        type: ['array', 'null'],
        items: { type: 'string', format: 'uuid' },
        minItems: 1,
        uniqueItems: true
      },
      flow_role: {
        type: 'string',
        enum: [
          'primary_sample',
          'aliquot_sample',
          'reagent',
          'consumable'
        ]
      }
    },
    required: [
      'mode',
      'resource_template_uuid',
      'mount',
      'material_uuid',
      'site',
      'slot_range',
      'flow_role'
    ],
    additionalProperties: false
  }
}

/** 注册物料来源（MaterialSource）目录适配器测试；无参数和返回值，断言失败由 Vitest 汇报。 */
function registerWorkflowMaterialSourceCatalogTests(): void {
  it(
    '按库位（Site）sort_order 与 UUID 加载框架模板和库存事实',
    loadsMaterialSourceCatalogInPublicGraphOrder
  )
  it(
    '解析并校验 OS 发布的物料来源选择器 Schema',
    validatesPublishedMaterialSourceSchema
  )
  it(
    'OS 未发布精确物料来源框架模板时关闭失败',
    rejectsMissingExactMaterialSourceTemplate
  )
  it(
    '缺少公共物料图（MaterialGraph）端口时失败关闭且不发出私有库存请求',
    rejectsMissingPublicMaterialGraphPort
  )
}

describe(
  '工作流物料来源（MaterialSource）目录适配器',
  registerWorkflowMaterialSourceCatalogTests
)

/**
 * 验证框架模板（ScaffoldTemplate）的物料来源选择器 Schema 及失败关闭边界。
 *
 * @returns Promise 完成时表示 JSON 文本被解析保留，旧 Edge 空 Schema 仍可兼容。
 * @throws 若 Schema 解析、投影或错误边界失效，则由 Vitest 断言失败。
 */
async function validatesPublishedMaterialSourceSchema(): Promise<void> {
  const fixture = responses()
  // `detailTemplate` 是服务端把 JSON Schema 持久化为文本后的 wire 记录。
  const detailTemplate = (fixture[
    `/api/v1/workflow-node-templates/${frameworkTemplateUuid}`
  ] as { data: { template: Record<string, unknown> } }).data.template
  const runtime = createWorkflowRuntime(
    fixtureHttp(fixture, []),
    getDefaultBackend('local-python'),
    { materialGraph: fixtureMaterialGraph() }
  )

  const snapshot = await runtime.getWorkflowMaterialSourceCatalog()
  expect(snapshot.template.uuid).toBe(frameworkTemplateUuid)
  expect(snapshot.template.schema).toEqual(materialSourceSchema())

  // 旧 Edge 尚未发布选择器 Schema 时保持兼容，但非空错误 Schema 仍失败关闭。
  detailTemplate.schema = null
  await expect(runtime.getWorkflowMaterialSourceCatalog()).resolves
    .toMatchObject({ template: { schema: null } })
  detailTemplate.schema = { type: 'object' }
  await expect(runtime.getWorkflowMaterialSourceCatalog()).rejects.toMatchObject({
    code: 'INVALID_WORKFLOW_MATERIAL_SOURCE_CATALOG'
  })
}

/**
 * 验证物料来源目录、公共物料图和库位（Site）业务顺序的完整投影。
 *
 * @returns Promise 完成时表示模板、物料、库位和请求路径均精确匹配。
 * @throws 任一目录合同或断言不一致时由 Vitest 汇报。
 */
async function loadsMaterialSourceCatalogInPublicGraphOrder(): Promise<void> {
    const requests: string[] = []
    const fixture = responses()
    const runtime = createWorkflowRuntime(
      fixtureHttp(fixture, requests),
      getDefaultBackend('local-python'),
      { materialGraph: fixtureMaterialGraph() }
    )

    const snapshot = await runtime.getWorkflowMaterialSourceCatalog()
    expect(snapshot).toEqual({
      authorityId: 'os-local',
      authorityKind: 'local',
      fingerprint,
      template: {
        uuid: frameworkTemplateUuid,
        resourceTemplateUuid: frameworkOwnerUuid,
        name: 'material_source',
        displayName: 'Material Source',
        actionClass: 'unilabos.workflow.authoring:material_source',
        actionType: 'material_source',
        schema: materialSourceSchema(),
        sourceHandle: {
          uuid: frameworkHandleUuid,
          workflowNodeTemplateUuid: frameworkTemplateUuid,
          handleKey: 'material',
          ioType: 'source',
          displayName: 'Material',
          valueType: 'ResourceSlot',
          required: false,
          dataSource: 'executor',
          dataKey: 'material'
        }
      },
      resourceTemplates: [
        {
          uuid: mountTemplateUuid,
          displayName: 'Deck'
        },
        {
          uuid: sampleTemplateUuid,
          displayName: 'Plate96',
          sourceUri: 'package://catalog_lab/definitions.py',
          shape: {
            id: 'plate96',
            bundle: 'test',
            displayName: undefined,
            categories: ['plate96'],
            categoryTokens: [],
            priority: 0,
            envelopeMm: [127, 85, 15],
            units: 'ratio',
            shadow: 'box',
            sort: 'center',
            parts: [{
              type: 'box',
              style: 'plate',
              from: [0, 0, 0],
              to: [1, 1, 1]
            }]
          }
        }
      ],
      materials: [
        {
          uuid: mountUuid,
          name: 'Deck A',
          resourceTemplateUuid: mountTemplateUuid
        },
        {
          uuid: materialUuid,
          name: 'Assay plate',
          resourceTemplateUuid: sampleTemplateUuid
        }
      ],
      sites: [
        {
          uuid: secondSiteUuid,
          name: 'Slot B',
          sortOrder: 0,
          mountMaterialUuid: mountUuid,
          allowedResourceTemplateUuids: [],
          occupiedMaterialUuid: materialUuid
        },
        {
          uuid: firstSiteUuid,
          name: 'Slot A',
          sortOrder: 0,
          mountMaterialUuid: mountUuid,
          allowedResourceTemplateUuids: [sampleTemplateUuid],
          occupiedMaterialUuid: null
        }
      ]
    })
    expect(snapshot.template.wireValue).toEqual(
      (fixture[
        `/api/v1/workflow-node-templates/${frameworkTemplateUuid}`
      ] as { data: { template: Record<string, unknown> } }).data.template
    )
    expect(snapshot.template.sourceHandle.wireValue).toEqual(
      (fixture[
        `/api/v1/workflow-node-templates/${frameworkTemplateUuid}`
      ] as { data: { handles: Record<string, unknown>[] } }).data.handles[0]
    )
    expect(requests).toEqual([
      materialSourceCatalogPath,
      `/api/v1/workflow-node-templates/${frameworkTemplateUuid}`,
      '/api/v1/resource-templates?page=1&page_size=100',
      '/api/v1/material-shapes',
      '/api/v1/resource-templates?page=2&page_size=1'
    ])
}

/**
 * 验证 OS 忽略显式筛选并返回错误节点类型时关闭失败。
 *
 * @returns Promise 完成时表示精确框架模板错误已被观察。
 * @throws 若错误模板被接受则由 Vitest 断言失败。
 */
async function rejectsMissingExactMaterialSourceTemplate(): Promise<void> {
    const fixture = responses()
    const list = fixture[materialSourceCatalogPath] as {
      data: { items: Array<Record<string, unknown>> }
    }
    list.data.items[0].node_type = 'device'
    const runtime = createWorkflowRuntime(
      fixtureHttp(fixture, []),
      getDefaultBackend('local-python'),
      { materialGraph: fixtureMaterialGraph() }
    )

    await expect(runtime.getWorkflowMaterialSourceCatalog()).rejects.toThrow(
      '物料来源（MaterialSource）框架模板'
    )
}

/**
 * 验证公共物料图端口缺失时工作流运行时（Workflow Runtime）不会回退到私有库存（Inventory）HTTP。
 *
 * @returns Promise 完成时表示缺少依赖被失败关闭且请求路径保持在公开合同内。
 */
async function rejectsMissingPublicMaterialGraphPort(): Promise<void> {
  const requests: string[] = []
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses(), requests),
    getDefaultBackend('local-python')
  )

  await expect(runtime.getWorkflowMaterialSourceCatalog()).rejects
    .toMatchObject({ code: 'WORKFLOW_MATERIAL_GRAPH_PORT_REQUIRED' })
  expect(requests).toEqual([])
}

/** 构造物料来源目录响应；无参数，返回模板、资源模板和外形接口 fixture，不主动抛错。 */
function responses(): Record<string, unknown> {
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
          schema: JSON.stringify(materialSourceSchema()),
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
    '/api/v1/resource-templates?page=1&page_size=100': {
      code: 0,
      data: {
        items: [{
          uuid: mountTemplateUuid,
          name: 'test.Deck',
          display_name: 'Deck',
          resource_type: 'resource',
          tags: []
        }],
        has_more: true,
        page: 1,
        page_size: 1
      }
    },
    '/api/v1/resource-templates?page=2&page_size=1': {
      code: 0,
      data: {
        items: [{
          uuid: sampleTemplateUuid,
          name: 'test.Plate96',
          display_name: 'Plate96',
          resource_type: 'resource',
          source_uri: 'package://catalog_lab/definitions.py',
          tags: []
        }],
        has_more: false,
        page: 2,
        page_size: 1
      }
    },
    '/api/v1/material-shapes': {
      code: 0,
      data: {
        items: [{
          id: 'plate96',
          bundle: 'test',
          categories: ['plate96'],
          categoryTokens: [],
          priority: 0,
          envelope: [127, 85, 15],
          units: 'ratio',
          shadow: 'box',
          sort: 'center',
          parts: [{
            type: 'box',
            style: 'plate',
            from: [0, 0, 0],
            to: [1, 1, 1]
          }]
        }]
      }
    }
  }
}

/**
 * 构造测试专用公共物料图端口，并记录工作流目录使用的物料作用域。
 *
 * @param scopes 接收每次读取时的物料作用域，证明当前合同使用单例作用域。
 * @returns 只实现 getGraph 的最小公共物料图端口。
 */
function fixtureMaterialGraph(
  scopes: MaterialScope[] = []
): Pick<MaterialGraphPort, 'getGraph'> {
  /**
   * 返回测试公共物料聚合，绝不读取私有库存 DTO。
   *
   * @param scope 工作流物料来源目录请求的公共物料作用域。
   * @returns 包含挂载物料、具体物料及库位占用事实的公共聚合。
   */
  async function getGraph(
    scope: MaterialScope
  ): Promise<readonly MaterialAggregate[]> {
    scopes.push(scope)
    return [
      materialAggregate(
        materialUuid,
        sampleTemplateUuid,
        'Assay plate'
      ),
      materialAggregate(mountUuid, mountTemplateUuid, 'Deck A', [
        materialSite(
          secondSiteUuid,
          mountUuid,
          'Slot B',
          [],
          [materialUuid]
        ),
        materialSite(
          firstSiteUuid,
          mountUuid,
          'Slot A',
          [sampleTemplateUuid],
          []
        )
      ])
    ]
  }

  return { getGraph }
}

/**
 * 构造公共物料聚合（MaterialAggregate）fixture。
 *
 * @param materialId 具体物料的稳定 UUID。
 * @param sourceTemplateId 物料来源资源模板 UUID。
 * @param name 物料显示名称。
 * @param sites 该物料直接拥有的库位（Site）集合。
 * @returns 可由公共物料图端口返回的聚合对象。
 */
function materialAggregate(
  materialId: string,
  sourceTemplateId: string,
  name: string,
  sites: readonly MaterialSite[] = []
): MaterialAggregate {
  return {
    material: {
      id: materialId,
      sourceTemplateId,
      code: materialId,
      name,
      config: {},
      createdAt: '2026-08-05T00:00:00Z',
      updatedAt: '2026-08-05T00:00:00Z'
    },
    placement: { kind: 'unplaced' },
    sites,
    revision: 1
  }
}

/**
 * 构造公共库位（Site）fixture。
 *
 * @param siteId 库位稳定 UUID。
 * @param ownerMaterialId 直接拥有库位的挂载物料 UUID。
 * @param name 库位显示名称。
 * @param allowedTemplateIds 允许承载的资源模板 UUID。
 * @param occupiedMaterialIds 当前库位占用（SiteOccupancy）的物料 UUID。
 * @returns 容量为一的公共库位事实。
 */
function materialSite(
  siteId: string,
  ownerMaterialId: string,
  name: string,
  allowedTemplateIds: readonly string[],
  occupiedMaterialIds: readonly string[]
): MaterialSite {
  return {
    id: siteId,
    ownerMaterialId,
    key: siteId,
    name,
    anchor: { kind: 'root' },
    poseInAnchor: {
      positionMm: [0, 0, 0],
      rotationDegXYZ: [0, 0, 0]
    },
    sizeMm: [100, 100, 100],
    capacity: 1,
    allowedTemplateIds,
    occupiedMaterialIds,
    kind: 'site'
  }
}

/**
 * 构造只接受显式公开路径的 HTTP fixture。
 *
 * @param fixture 公开路径到响应的映射。
 * @param requests 接收实际请求路径的审计数组。
 * @throws 请求未知路径时抛出错误，防止旧合同被静默接受。
 */
function fixtureHttp(
  fixture: Record<string, unknown>,
  requests: string[]
): HttpClient {
  /**
   * 读取一条已声明的公开响应并记录路径。
   *
   * @param path 工作流服务请求的相对 API 路径。
   * @returns 对应 fixture 的结构化克隆，避免测试间共享可变状态。
   * @throws 请求未声明路径时抛出异常，从而禁止私有库存接口回退。
   */
  async function request<ResponseValue>(path: string): Promise<ResponseValue> {
    requests.push(path)
    if (!Object.prototype.hasOwnProperty.call(fixture, path)) {
      throw new Error(`出现未声明请求路径: ${path}`)
    }
    return structuredClone(fixture[path]) as ResponseValue
  }

  return { request }
}
