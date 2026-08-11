import {
  MaterialStoreProvider,
  MaterialWorkbench,
  createMaterialStore,
  type AttachMaterialCommand,
  type CreateMaterialInput,
  type MaterialAggregate,
  type MaterialGraphPort,
  type MaterialSite,
  type MaterialTemplateCatalogPort,
  type MaterialTemplateDetail,
  type UpdateMaterialConfigCommand
} from '@unilab/material'
import {
  ReagentWorkbench,
  isNonReagentResourceTemplate,
  type NewReagentWorkspaceInput,
  type ReagentInfoProjection,
  type ReagentWorkspaceIntegration,
  type ReagentWorkspaceSnapshot
} from '@unilab/reagent'
import {
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import './material-create-fixture.css'

declare global {
  interface Window {
    __UNILAB_MATERIAL_CREATE_COMMAND__?: CreateMaterialInput
    __UNILAB_MATERIAL_UPDATE_COMMAND__?: UpdateMaterialConfigCommand
    __UNILAB_MATERIAL_ATTACH_COMMAND__?: AttachMaterialCommand
    __UNILAB_REAGENT_CREATE_COMMAND__?: NewReagentWorkspaceInput
    __UNILAB_REAGENT_UPDATE_COMMAND__?: ReagentInfoProjection
  }
}

const initialAggregates = createFixtureGraph()
const templateCatalog = createTemplateCatalog()
const reagentIntegration = createReagentIntegration()
const materialGraph = createMaterialGraphPort(initialAggregates)
const materialStore = createMaterialStore({
  scope: { kind: 'singleton' },
  graph: materialGraph,
  requireCapability: () => undefined,
  createIdempotencyKey: () => 'material-create-e2e'
})
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false }
  }
})

/**
 * 提供物料与试剂两个同级一级模块的 E2E 验收宿主。
 * @returns 共享同一物料图 Store、但拥有独立模块入口的桌面工作台。
 */
function MaterialCreateFixture(): React.JSX.Element {
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<
    readonly string[]
  >([])
  const [activeModule, setActiveModule] = useState<'material' | 'reagent'>(
    'material'
  )

  return (
    <QueryClientProvider client={queryClient}>
      <MaterialStoreProvider store={materialStore}>
        <main className="material-create-e2e-app">
          <nav className="fixture-module-nav" aria-label="产品模块">
            <strong>UNI-LAB</strong>
            <button
              type="button"
              data-module="material"
              aria-current={activeModule === 'material' ? 'page' : undefined}
              onClick={() => {
                setSelectedMaterialIds([])
                setActiveModule('material')
              }}
            >
              <span aria-hidden="true">◇</span>
              物料
            </button>
            <button
              type="button"
              data-module="reagent"
              aria-current={activeModule === 'reagent' ? 'page' : undefined}
              onClick={() => {
                setSelectedMaterialIds([])
                setActiveModule('reagent')
              }}
            >
              <span aria-hidden="true">⚗</span>
              试剂
            </button>
          </nav>
          <section className="fixture-module-page">
            {activeModule === 'material' ? (
              <MaterialWorkbench
                catalog={templateCatalog}
                profileId="e2e-material-authoring"
                scope={{ kind: 'singleton' }}
                capabilities={{
                  readTemplates: { available: true },
                  readGraph: { available: true },
                  create: { available: true },
                  updateConfig: { available: true },
                  move: {
                    available: false,
                    reason: 'E2E 夹具使用只读位置'
                  },
                  attach: { available: true }
                }}
                selectedMaterialIds={selectedMaterialIds}
                includeTemplate={isNonReagentResourceTemplate}
                onSelectionChange={setSelectedMaterialIds}
              />
            ) : (
              <ReagentWorkbench
                catalog={templateCatalog}
                profileId="e2e-reagent"
                scope={{ kind: 'singleton' }}
                capabilities={{
                  readTemplates: { available: true },
                  readGraph: { available: true }
                }}
                integration={reagentIntegration}
                selectedMaterialIds={selectedMaterialIds}
                onSelectionChange={setSelectedMaterialIds}
              />
            )}
          </section>
        </main>
      </MaterialStoreProvider>
    </QueryClientProvider>
  )
}

/**
 * 构造可记录实例创建命令的内存物料图服务端口。
 * @param aggregates 页面初次加载的物料聚合集合。
 * @returns 支持读取、创建、实例配置与稳定库位放置的 E2E 服务端口。
 */
function createMaterialGraphPort(
  aggregates: readonly MaterialAggregate[]
): MaterialGraphPort {
  const aggregatesById = new Map(
    aggregates.map((aggregate) => [
      aggregate.material.id,
      structuredClone(aggregate)
    ])
  )
  const unsupported = async (): Promise<never> => {
    throw new Error('Unexpected MaterialGraphPort command in E2E fixture')
  }

  /**
   * 模拟服务端确认物料实例创建，并保留提交命令供 E2E 断言。
   * @param _scope E2E 使用的单例物料范围。
   * @param input 页面提交的物料实例创建命令。
   * @returns 包含新物料聚合与创建操作身份的确认结果。
   */
  const createMaterial: MaterialGraphPort['createMaterial'] = async (
    _scope,
    input
  ) => {
    window.__UNILAB_MATERIAL_CREATE_COMMAND__ = structuredClone(input)
    const created = materialAggregate({
      id: 'run-plate-01',
      code: 'RUN_PLATE_01',
      name: input.name,
      templateId: input.templateId,
      placement: structuredClone(input.placement),
      config: {
        ...plateRendering(),
        ...structuredClone(input.config ?? {})
      },
      sites: plateSites('run-plate-01')
    })
    aggregatesById.set(created.material.id, structuredClone(created))
    return {
      aggregates: [created],
      primaryMaterialId: created.material.id,
      creationOperationId: 'create-run-plate-01',
      edgeSyncState: 'not-required' as const
    }
  }

  /**
   * 模拟服务端以修订版本保护当前实例的名称、说明和配置写入。
   * @param command 属性抽屉提交的最小实例配置补丁。
   * @returns 服务端确认后的新物料聚合。
   */
  const updateConfig: MaterialGraphPort['updateConfig'] = async (command) => {
    window.__UNILAB_MATERIAL_UPDATE_COMMAND__ = structuredClone(command)
    const current = aggregatesById.get(command.materialId)
    if (!current) throw new Error(`Unknown Material ${command.materialId}`)
    if (current.revision !== command.expectedRevision) {
      throw new Error('Material revision conflict')
    }
    const updated: MaterialAggregate = {
      ...structuredClone(current),
      material: {
        ...structuredClone(current.material),
        ...(command.patch.name !== undefined
          ? { name: command.patch.name }
          : {}),
        ...(command.patch.description !== undefined
          ? { description: command.patch.description }
          : {}),
        ...(command.patch.config !== undefined
          ? { config: structuredClone(command.patch.config) }
          : {}),
        updatedAt: '2026-08-09T00:00:00.000Z'
      },
      revision: current.revision + 1
    }
    aggregatesById.set(updated.material.id, structuredClone(updated))
    return updated
  }

  /**
   * 模拟物料权威把未放置实例原子写入一个空的稳定库位。
   * @param command 用户确认的父物料、子物料和库位身份。
   * @returns 同时更新父库位占用与子物料位置的聚合集合。
   */
  const attach: MaterialGraphPort['attach'] = async (command) => {
    window.__UNILAB_MATERIAL_ATTACH_COMMAND__ = structuredClone(command)
    const parent = aggregatesById.get(command.parentId)
    const child = aggregatesById.get(command.childId)
    if (!parent || !child) throw new Error('Unknown placement Material')
    if (
      parent.revision !== command.expectedParentRevision ||
      child.revision !== command.expectedChildRevision
    ) {
      throw new Error('Material revision conflict')
    }
    const target = parent.sites.find((site) => site.id === command.siteId)
    if (!target) throw new Error(`Unknown Site ${command.siteId}`)
    if (target.occupiedMaterialIds.length) {
      throw new Error(`Site ${command.siteId} is already occupied`)
    }
    const updatedParent: MaterialAggregate = {
      ...structuredClone(parent),
      sites: parent.sites.map((site) => site.id === command.siteId
        ? { ...structuredClone(site), occupiedMaterialIds: [child.material.id] }
        : structuredClone(site)),
      revision: parent.revision + 1
    }
    const updatedChild: MaterialAggregate = {
      ...structuredClone(child),
      placement: {
        kind: 'site',
        parentId: parent.material.id,
        siteId: target.id,
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      revision: child.revision + 1
    }
    aggregatesById.set(parent.material.id, structuredClone(updatedParent))
    aggregatesById.set(child.material.id, structuredClone(updatedChild))
    return { aggregates: [updatedParent, updatedChild] }
  }

  return {
    getGraph: async () => structuredClone([...aggregatesById.values()]),
    createMaterial,
    undoCreate: unsupported,
    updateConfig,
    move: unsupported,
    attach,
    detach: unsupported,
    updateSite: unsupported,
    getEdgeOperations: async () => []
  }
}

function createTemplateCatalog(): MaterialTemplateCatalogPort {
  const templates: MaterialTemplateDetail[] = [
    template({
      uuid: 'template-host',
      key: 'host_node',
      displayName: '通用控制节点',
      tags: ['控制节点'],
      kind: 'device',
      description: '实验室控制节点'
    }),
    template({
      uuid: 'template-prcxi',
      key: 'liquid_handler.prcxi',
      displayName: 'PRCXI 移液工作站',
      tags: ['移液工作站'],
      kind: 'device',
      description: '自动化移液工作站'
    }),
    template({
      uuid: 'template-96-well-plate',
      key: 'plate-96',
      displayName: '96 孔板',
      tags: ['孔板', '耗材'],
      categoryPath: ['耗材', '微孔板'],
      kind: 'resource',
      description: '标准 8 × 12 孔位布局，用于样品与试剂承载。',
      compatibility: {
        allowedSiteTypes: ['deck-slot', 'storage-rack']
      },
      configuration: {
        schema: {
          type: 'object',
          properties: {
            batch: { type: 'string', title: '批次号' },
            expiresAt: { type: 'string', format: 'date', title: '有效期' }
          }
        },
        uiSchema: {}
      },
      containerLayout: {
        type: 'grid',
        containerKind: 'well',
        rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
        columns: 12,
        columnLabels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        naming: 'row-column',
        geometry: {
          dimensionsMm: { x: 8, y: 8, z: 10 },
          depthMm: 10,
          shape: 'circle',
          pitchMm: { x: 9, y: -9 },
          offsetMm: { x: 10, y: 70, z: 2 },
          firstKey: 'A1'
        }
      }
    }),
    template({
      uuid: 'template-tip-rack',
      key: 'tip-rack-96',
      displayName: '移液枪头盒',
      tags: ['枪头', '耗材'],
      categoryPath: ['耗材', '移液耗材'],
      kind: 'resource',
      description: '96 位移液枪头盒，支持台面位与存储架库位。'
    }),
    template({
      uuid: 'template-reagent-bottle',
      key: 'reagent-bottle',
      displayName: '试剂瓶',
      tags: ['试剂', '容器'],
      categoryPath: ['试剂', '试剂容器'],
      catalogSection: 'reagent',
      kind: 'resource',
      description: '用于存储具有专属试剂信息和数量库存的具体瓶装试剂。'
    }),
    template({
      uuid: 'template-cold-storage',
      key: 'cold-storage',
      displayName: '试剂冷藏柜',
      tags: ['存储设备'],
      categoryPath: ['设备', '存储'],
      kind: 'device',
      description: '提供稳定 Site 的 2–8 °C 试剂冷藏设备。'
    })
  ]

  return {
    listTemplates: async () => ({
      revision: 'fixture-catalog-1',
      stale: false,
      items: structuredClone(templates)
    }),
    getTemplate: async (_scope, templateId) => {
      const template = templates.find(
        (candidate) => candidate.uuid === templateId
      )
      if (!template) throw new Error(`Unknown template ${templateId}`)
      return structuredClone(template)
    }
  }
}

function template(
  input: Pick<
    MaterialTemplateDetail,
    'uuid' | 'key' | 'displayName' | 'kind' | 'tags' | 'description'
  > &
    Partial<MaterialTemplateDetail>
): MaterialTemplateDetail {
  return {
    sourceNamespace: 'e2e',
    categoryPath: [input.kind === 'device' ? 'devices' : 'resources'],
    status: 'ready',
    contentHash: `hash-${input.uuid}`,
    creation: {
      mode:
        input.kind === 'device' ? 'dynamic-device' : 'resource-tree',
      available: true
    },
    compatibility: {},
    configuration: { schema: {}, uiSchema: {} },
    assets: {},
    ...input
  }
}

function createFixtureGraph(): readonly MaterialAggregate[] {
  const host = materialAggregate({
    id: 'host-node',
    code: 'host_node',
    name: 'host_node',
    templateId: 'template-host',
    config: {
      presentation: { category: 'control-node' },
      resourceType: 'device'
    },
    placement: {
      kind: 'world',
      pose: {
        positionMm: [-360, 180, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    }
  })
  const device = materialAggregate({
    id: 'prcxi',
    code: 'PRCXI',
    name: 'PRCXI',
    templateId: 'template-prcxi',
    config: {
      resourceConfig: { type: 'liquid-handler-device' }
    },
    placement: {
      kind: 'world',
      pose: {
        positionMm: [0, 0, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    }
  })
  const deck = materialAggregate({
    id: 'prcxi-deck',
    code: 'PRCXI_Deck',
    name: 'PRCXI_Deck',
    templateId: 'template-deck',
    placement: {
      kind: 'parent',
      parentId: 'prcxi',
      anchor: { kind: 'root' },
      localPose: {
        positionMm: [0, -420, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    },
    config: {
      rendering: {
        kind: 'deck',
        dimensionsMm: [470, 40, 370],
        footprintMm: [470, 370]
      }
    },
    sites: deckSites()
  })
  const plate = materialAggregate({
    id: 'pcr-plate',
    code: 'PCR_PLATE',
    name: 'PCR Plate',
    templateId: 'template-96-well-plate',
    placement: {
      kind: 'site',
      parentId: 'prcxi-deck',
      siteId: 'deck-T1',
      offsetPose: {
        positionMm: [0, 0, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    },
    config: plateRendering(),
    sites: plateSites('pcr-plate')
  })
  const plateTwo = materialAggregate({
    id: 'pcr-plate-002',
    code: 'PCR_PLATE_002',
    name: 'PCR Plate 002',
    templateId: 'template-96-well-plate',
    placement: { kind: 'unplaced' },
    config: plateRendering('B-20260808'),
    sites: plateSites('pcr-plate-002')
  })
  const plateThree = materialAggregate({
    id: 'pcr-plate-003',
    code: 'PCR_PLATE_003',
    name: 'PCR Plate 003',
    templateId: 'template-96-well-plate',
    placement: {
      kind: 'world',
      pose: {
        positionMm: [620, 120, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    },
    config: plateRendering('B-20260718'),
    sites: plateSites('pcr-plate-003')
  })
  const tipRack = materialAggregate({
    id: 'tip-rack-001',
    code: 'TIP_RACK_001',
    name: 'Tip Rack 001',
    templateId: 'template-tip-rack',
    placement: {
      kind: 'site',
      parentId: 'prcxi-deck',
      siteId: 'deck-T2',
      offsetPose: {
        positionMm: [0, 0, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    },
    config: { batch: 'TIP-20260807' },
    sites: tipRackSites('tip-rack-001')
  })
  const coldStorage = materialAggregate({
    id: 'cold-storage-01',
    code: 'COLD_STORAGE_01',
    name: '试剂冷藏柜 01',
    templateId: 'template-cold-storage',
    placement: {
      kind: 'world',
      pose: {
        positionMm: [900, -120, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    },
    sites: coldStorageSites()
  })
  const pbsOne = reagentBottleAggregate({
    id: 'reagent-pbs-001',
    code: 'REAG-PBS-001',
    name: 'PBS 500 mL #01',
    batch: 'PBS-20260718',
    siteId: 'cold-A1'
  })
  const pbsTwo = reagentBottleAggregate({
    id: 'reagent-pbs-002',
    code: 'REAG-PBS-002',
    name: 'PBS 500 mL #02',
    batch: 'PBS-20260718',
    siteId: 'cold-A2'
  })
  const trypsin = reagentBottleAggregate({
    id: 'reagent-trypsin-001',
    code: 'REAG-TRY-001',
    name: 'Trypsin-EDTA 100 mL #01',
    batch: 'TRY-20260801',
    siteId: 'cold-B1'
  })
  const dmso = reagentBottleAggregate({
    id: 'reagent-dmso-001',
    code: 'REAG-DMSO-001',
    name: 'DMSO 100 mL #01',
    batch: 'DMSO-20260612',
    placement: { kind: 'unplaced' }
  })
  coldStorage.sites = coldStorage.sites.map((site) => {
    const occupied = [pbsOne, pbsTwo, trypsin].find((candidate) => (
      candidate.placement.kind === 'site' && candidate.placement.siteId === site.id
    ))
    return occupied
      ? { ...site, occupiedMaterialIds: [occupied.material.id] }
      : site
  })
  deck.sites = deck.sites.map((site) =>
    site.id === 'deck-T1'
      ? { ...site, occupiedMaterialIds: [plate.material.id] }
      : site.id === 'deck-T2'
        ? { ...site, occupiedMaterialIds: [tipRack.material.id] }
        : site
  )
  return [
    host,
    device,
    deck,
    plate,
    plateTwo,
    plateThree,
    tipRack,
    coldStorage,
    pbsOne,
    pbsTwo,
    trypsin,
    dmso
  ]
}

/** 构造一个绑定到稳定库位或保持未放置状态的试剂瓶 Material 聚合。 */
function reagentBottleAggregate({
  id,
  code,
  name,
  batch,
  siteId,
  placement
}: {
  id: string
  code: string
  name: string
  batch: string
  siteId?: string
  placement?: MaterialAggregate['placement']
}): MaterialAggregate {
  return materialAggregate({
    id,
    code,
    name,
    templateId: 'template-reagent-bottle',
    config: { batch },
    placement: placement ?? (siteId
      ? {
          kind: 'site',
          parentId: 'cold-storage-01',
          siteId,
          offsetPose: {
            positionMm: [0, 0, 0],
            rotationDegXYZ: [0, 0, 0]
          }
        }
      : { kind: 'unplaced' })
  })
}

/** 构造试剂冷藏柜中的稳定物理库位集合。 */
function coldStorageSites(): readonly MaterialSite[] {
  return ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'].map((key, index) => ({
    id: `cold-${key}`,
    ownerMaterialId: 'cold-storage-01',
    key,
    name: `${key} 层架位`,
    sortOrder: index,
    anchor: { kind: 'root' as const },
    poseInAnchor: {
      positionMm: [80 + (index % 3) * 110, 300 - Math.floor(index / 3) * 120, 0] as const,
      rotationDegXYZ: [0, 0, 0] as const
    },
    sizeMm: [90, 90, 160] as const,
    capacity: 1,
    allowedTemplateIds: ['template-reagent-bottle'],
    occupiedMaterialIds: [],
    kind: 'site' as const,
    shape: 'rectangle' as const,
    visible: true
  }))
}

/**
 * 构造试剂信息、数量库存、履历和工作流绑定计划的专属 E2E 投影。
 * @returns 仅用于验收前端交互的能力完整试剂集成边界。
 */
function createReagentIntegration(): ReagentWorkspaceIntegration {
  const snapshot: ReagentWorkspaceSnapshot = {
    revision: 'reagent-fixture-1',
    reagentInfos: [
      {
        id: 'reagent-info-pbs',
        name: '磷酸盐缓冲液（PBS）',
        aliases: ['PBS', 'Phosphate-buffered saline'],
        physicalState: '液体',
        molecularFormula: '—',
        manufacturer: 'Gibco',
        catalogNumber: '10010-023',
        defaultStorageCondition: '2–8 °C 冷藏',
        hazardLabels: [],
        customFields: [
          { key: 'buffer_ph', label: '缓冲液 pH', value: '7.4' },
          { key: 'sterility', label: '无菌等级', value: '无菌过滤' }
        ],
        description: '无菌、pH 7.4，用于细胞培养清洗和缓冲。'
      },
      {
        id: 'reagent-info-trypsin',
        name: 'Trypsin-EDTA（0.25%）',
        aliases: ['胰蛋白酶-EDTA'],
        physicalState: '液体',
        manufacturer: 'Gibco',
        catalogNumber: '25200-056',
        defaultStorageCondition: '−20 °C 冷冻',
        hazardLabels: ['刺激性'],
        description: '用于贴壁细胞消化；解冻后按实验规范控制反复冻融。'
      },
      {
        id: 'reagent-info-dmso',
        name: '二甲基亚砜（DMSO）',
        aliases: ['DMSO'],
        physicalState: '液体',
        cas: '67-68-5',
        molecularFormula: 'C₂H₆OS',
        molecularWeight: 78.13,
        manufacturer: 'Sigma-Aldrich',
        catalogNumber: 'D2650',
        defaultStorageCondition: '15–25 °C 室温避光',
        hazardLabels: ['刺激性'],
        description: '吸湿性溶剂；开启后需记录时间并避免污染。'
      }
    ],
    lots: [
      { id: 'lot-pbs-20260718', reagentInfoId: 'reagent-info-pbs', code: 'PBS-20260718', supplierLot: '2437821', receivedAt: '2026-07-18', expiresAt: '2027-05-31', qualityState: 'released' },
      { id: 'lot-try-20260801', reagentInfoId: 'reagent-info-trypsin', code: 'TRY-20260801', supplierLot: '2541107', receivedAt: '2026-08-01', expiresAt: '2027-02-28', qualityState: 'pending' },
      { id: 'lot-dmso-20260612', reagentInfoId: 'reagent-info-dmso', code: 'DMSO-20260612', supplierLot: 'MKCL8321', receivedAt: '2026-06-12', expiresAt: '2028-06-30', qualityState: 'released' }
    ],
    containers: [
      { materialId: 'reagent-pbs-001', reagentInfoId: 'reagent-info-pbs', lotId: 'lot-pbs-20260718', quantity: { value: 420, unit: 'mL' }, initialQuantity: { value: 500, unit: 'mL' }, storageCondition: '2–8 °C 冷藏', openedAt: '2026-08-02', expiresAt: '2027-05-31', state: 'opened' },
      { materialId: 'reagent-pbs-002', reagentInfoId: 'reagent-info-pbs', lotId: 'lot-pbs-20260718', quantity: { value: 500, unit: 'mL' }, initialQuantity: { value: 500, unit: 'mL' }, storageCondition: '2–8 °C 冷藏', expiresAt: '2027-05-31', state: 'sealed' },
      { materialId: 'reagent-trypsin-001', reagentInfoId: 'reagent-info-trypsin', lotId: 'lot-try-20260801', quantity: { value: 68, unit: 'mL' }, initialQuantity: { value: 100, unit: 'mL' }, concentration: { value: 0.25, unit: '%' }, storageCondition: '−20 °C 冷冻', openedAt: '2026-08-07', expiresAt: '2027-02-28', state: 'opened' },
      { materialId: 'reagent-dmso-001', reagentInfoId: 'reagent-info-dmso', lotId: 'lot-dmso-20260612', quantity: { value: 8, unit: 'mL' }, initialQuantity: { value: 100, unit: 'mL' }, concentration: { value: 100, unit: '%' }, storageCondition: '15–25 °C 室温避光', openedAt: '2026-07-01', expiresAt: '2028-06-30', state: 'opened' }
    ],
    history: [
      { id: 'history-01', materialId: 'reagent-pbs-001', materialName: 'PBS 500 mL #01', reagentInfoId: 'reagent-info-pbs', lotId: 'lot-pbs-20260718', occurredAt: '2026-08-09T10:42:00+08:00', eventType: 'consumed', quantityDelta: { value: -30, unit: 'mL' }, operator: '自动化工作站', workflowName: '细胞换液流程 / RUN-240809-06', detail: '工作流节点“PBS 清洗”完成后，由执行结果确认实际消耗。' },
      { id: 'history-02', materialId: 'reagent-trypsin-001', materialName: 'Trypsin-EDTA 100 mL #01', reagentInfoId: 'reagent-info-trypsin', lotId: 'lot-try-20260801', occurredAt: '2026-08-08T16:18:00+08:00', eventType: 'transferred', operator: '李媛', detail: '从暂存架转移到试剂冷藏柜 01 / B1 层架位。' },
      { id: 'history-03', materialId: 'reagent-pbs-002', materialName: 'PBS 500 mL #02', reagentInfoId: 'reagent-info-pbs', lotId: 'lot-pbs-20260718', occurredAt: '2026-08-08T09:05:00+08:00', eventType: 'received', quantityDelta: { value: 500, unit: 'mL' }, operator: '王磊', detail: '到货验收完成，批次 PBS-20260718 质检放行。' },
      { id: 'history-04', materialId: 'reagent-pbs-001', materialName: 'PBS 500 mL #01', reagentInfoId: 'reagent-info-pbs', lotId: 'lot-pbs-20260718', occurredAt: '2026-08-02T14:26:00+08:00', eventType: 'opened', operator: '陈晨', detail: '首次开启容器并记录开封时间。' },
      { id: 'history-05', materialId: 'reagent-dmso-001', materialName: 'DMSO 100 mL #01', reagentInfoId: 'reagent-info-dmso', lotId: 'lot-dmso-20260612', occurredAt: '2026-08-01T11:32:00+08:00', eventType: 'adjusted', quantityDelta: { value: -2, unit: 'mL' }, operator: '张琪', detail: '人工复核后修正蒸发和移液误差，保留调整原因。' }
    ]
  }

  /**
   * 接收 E2E 结构化创建输入并保存供浏览器断言。
   * @param input 页面提交的试剂、批次与首个容器草稿。
   * @returns 记录完成后结束；视觉验收不改变夹具物料图。
   */
  const onCreate = async (input: NewReagentWorkspaceInput): Promise<void> => {
    window.__UNILAB_REAGENT_CREATE_COMMAND__ = structuredClone(input)
  }
  /**
   * 接收 E2E 结构化信息更新并保存供浏览器断言。
   * @param input 页面提交的完整试剂信息投影。
   * @returns 记录完成后结束；视觉验收不改变夹具投影。
   */
  const onUpdateInfo = async (input: ReagentInfoProjection): Promise<void> => {
    window.__UNILAB_REAGENT_UPDATE_COMMAND__ = structuredClone(input)
  }
  return {
    snapshot,
    capabilities: {
      readCatalog: { available: true },
      create: { available: true },
      updateInfo: { available: true },
      readInventory: { available: true },
      readHistory: { available: true }
    },
    onCreate,
    onUpdateInfo
  }
}

function materialAggregate({
  id,
  code,
  name,
  templateId,
  placement,
  config = {},
  sites = []
}: {
  id: string
  code: string
  name: string
  templateId: string
  placement: MaterialAggregate['placement']
  config?: Record<string, unknown>
  sites?: readonly MaterialSite[]
}): MaterialAggregate {
  return {
    material: {
      id,
      sourceTemplateId: templateId,
      code,
      name,
      config,
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z'
    },
    placement,
    sites,
    revision: 1
  }
}

function deckSites(): readonly MaterialSite[] {
  return Array.from({ length: 16 }, (_, index) => {
    const column = index % 4
    const row = Math.floor(index / 4)
    const key = `T${index + 1}`
    return {
      id: `deck-${key}`,
      ownerMaterialId: 'prcxi-deck',
      key,
      name: key,
      anchor: { kind: 'root' as const },
      poseInAnchor: {
        positionMm: [
          12 + column * 114,
          370 - 12 - 78 - row * 88,
          0
        ] as const,
        rotationDegXYZ: [0, 0, 0] as const
      },
      sizeMm: [104, 78, 20] as const,
      capacity: 1,
      allowedTemplateIds: [],
      occupiedMaterialIds: [],
      kind: 'deck-slot' as const,
      shape: 'rectangle' as const,
      visible: true
    }
  })
}

function plateSites(ownerMaterialId: string): readonly MaterialSite[] {
  return Array.from({ length: 96 }, (_, index) => {
    const column = index % 12
    const row = Math.floor(index / 12)
    const key = `${String.fromCharCode(65 + row)}${column + 1}`
    return {
      id: `${ownerMaterialId}-${key}`,
      ownerMaterialId,
      key,
      name: key,
      anchor: { kind: 'root' as const },
      poseInAnchor: {
        positionMm: [14.4 + column * 9, 11.2 + row * 9, 0] as const,
        rotationDegXYZ: [0, 0, 0] as const
      },
      sizeMm: [6.9, 6.9, 10] as const,
      capacity: 1,
      allowedTemplateIds: [],
      occupiedMaterialIds: [],
      kind: 'well' as const,
      shape: 'circle' as const,
      visible: true,
      visual: {
        state: 'empty' as const,
        fillFraction: 0
      }
    }
  })
}

/** 构造只用于展示枪头盒内部结构的兼容点位。 */
function tipRackSites(ownerMaterialId: string): readonly MaterialSite[] {
  return plateSites(ownerMaterialId).map((site) => ({
    ...site,
    kind: 'tip-spot' as const,
    visual: {
      state: 'tip-present' as const,
      fillFraction: 1
    }
  }))
}

/**
 * 构造孔板夹具的用户批次与结构化渲染配置。
 * @returns 供表单化编辑和画布投影共同读取的单一配置对象。
 */
function plateRendering(batch = 'B-20260808'): Record<string, unknown> {
  return {
    batch,
    rendering: {
      kind: 'plate',
      dimensionsMm: [127.8, 14.4, 85.5],
      footprintMm: [127.8, 85.5]
    }
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')
createRoot(root).render(<MaterialCreateFixture />)
