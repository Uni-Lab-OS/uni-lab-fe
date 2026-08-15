import type { MaterialAggregate, MaterialSite } from '@unilab/material'
import type {
  BenchMaterialProjection,
  BenchSiteProjection,
  BenchSnapshot,
  ReagentContainerOption,
  ReagentCreateCommand,
  ReagentHistoryProjection,
  ReagentInfoProjection,
  ReagentInfoManagement,
  ReagentInventoryProjection,
  ReagentManagement,
  ReagentUpdateCommand,
  WorkstationDataStatus
} from '@unilab/robot-workstation'
import type {
  MaterialTemplateSummary,
  ReagentInfoItem,
  ReagentInventoryItem,
  Services
} from '@unilab/services'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { WorkbenchViewMode } from './workbench-view-state'
import { useReagentInfoManagement } from './reagent-info-management'

export interface RobotWorkstationData {
  benchSnapshot?: BenchSnapshot
  benchStatus: WorkstationDataStatus
  reagentItems?: readonly ReagentInventoryProjection[]
  reagentStatus: WorkstationDataStatus
  reagentInfos?: readonly ReagentInfoProjection[]
  reagentInfoStatus: WorkstationDataStatus
  reagentInfoManagement?: ReagentInfoManagement
  reagentManagement?: ReagentManagement
  pointStatus: WorkstationDataStatus
}

const POINT_STATUS: WorkstationDataStatus = {
  phase: 'unavailable',
  message: '当前 Uni-Lab OS 与 Backend 均未公开机械臂点位目录接口。前端示例点位和本地写操作已隐藏。'
}

/**
 * 按当前 Workbench 入口读取工站所需的真实后端数据。
 * @param services 已绑定当前 OS 会话的统一服务集合。
 * @param viewMode 当前活动栏选择的主区模式。
 * @returns 实验台、试剂库存和点位能力的真实快照及显式状态。
 */
export function useRobotWorkstationData(
  services: Services,
  viewMode: WorkbenchViewMode
): RobotWorkstationData {
  const [benchSnapshot, setBenchSnapshot] = useState<BenchSnapshot>()
  const [benchStatus, setBenchStatus] = useState<WorkstationDataStatus>({
    phase: 'loading',
    message: '正在读取公共物料图…'
  })
  const [benchRevision, setBenchRevision] = useState(0)
  const [reagentItems, setReagentItems] = useState<readonly ReagentInventoryProjection[]>()
  const [reagentStatus, setReagentStatus] = useState<WorkstationDataStatus>({
    phase: 'loading',
    message: '正在读取试剂库存…'
  })
  const [reagentInfos, setReagentInfos] = useState<readonly ReagentInfoProjection[]>()
  const [reagentInfoStatus, setReagentInfoStatus] = useState<WorkstationDataStatus>({
    phase: 'loading',
    message: '正在读取试剂基础信息…'
  })
  const [reagentRevision, setReagentRevision] = useState(0)
  const [reagentContainers, setReagentContainers] = useState<readonly ReagentContainerOption[]>()
  const [reagentContainerStatus, setReagentContainerStatus] = useState<WorkstationDataStatus>({
    phase: 'loading',
    message: '正在读取容器物料…'
  })
  const retryBench = useCallback(() => setBenchRevision(value => value + 1), [])
  const retryReagents = useCallback(() => setReagentRevision(value => value + 1), [])
  const reagentInfoManagement = useReagentInfoManagement(services, retryReagents)

  /** 创建真实 Backend 试剂后使列表失效，等待权威列表回读。 */
  const createReagent = useCallback(async (command: ReagentCreateCommand): Promise<void> => {
    await services.inventory.createReagent({
      ...command,
      source: 'frontend:robot-workstation',
      observedAt: new Date().toISOString()
    })
    retryReagents()
  }, [retryReagents, services.inventory])

  /** 携带当前修订更新 Backend 试剂，成功后只通过重新查询推进界面状态。 */
  const updateReagent = useCallback(async (command: ReagentUpdateCommand): Promise<void> => {
    await services.inventory.updateReagent({
      ...command,
      source: 'frontend:robot-workstation',
      observedAt: new Date().toISOString()
    })
    retryReagents()
  }, [retryReagents, services.inventory])

  /** 请求 Backend 软删除试剂；成功前不从前端列表乐观移除。 */
  const deleteReagent = useCallback(async (reagentId: string): Promise<void> => {
    await services.inventory.deleteReagent(reagentId)
    retryReagents()
  }, [retryReagents, services.inventory])

  /** 分页读取一个容器的完整试剂台账，并保持 Backend 倒序。 */
  const readReagentHistory = useCallback(async (
    materialId: string
  ): Promise<readonly ReagentHistoryProjection[]> => {
    const entries: ReagentHistoryProjection[] = []
    for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
      const page = await services.inventory.listReagentHistory(materialId, pageNumber)
      entries.push(...page.items.map(projectReagentHistoryEntry))
      if (!page.hasMore) return entries
    }
    throw new Error('试剂历史超过 100 页，请缩小查询范围后重试。')
  }, [services.inventory])

  useEffect(() => {
    if (viewMode !== 'robot-bench') return
    const controller = new AbortController()
    setBenchStatus({ phase: 'loading', message: '正在读取公共物料图…' })
    void services.materials.getGraph({ kind: 'singleton' }).then(
      aggregates => {
        if (controller.signal.aborted) return
        setBenchSnapshot(projectBenchSnapshot(aggregates))
        setBenchStatus({
          phase: 'ready',
          message: '公共物料图已同步',
          retry: retryBench
        })
      },
      error => {
        if (controller.signal.aborted) return
        setBenchSnapshot(undefined)
        setBenchStatus({
          phase: 'error',
          message: errorMessage(error, '公共物料图读取失败'),
          retry: retryBench
        })
      }
    )
    return () => controller.abort()
  }, [benchRevision, retryBench, services.materials, viewMode])

  useEffect(() => {
    if (viewMode !== 'robot-reagents') return
    const capability = services.getCapabilityStatus('inventory.readReagents')
    if (!capability.available) {
      setReagentItems(undefined)
      setReagentStatus({
        phase: 'unavailable',
        message: capability.reason ?? '当前服务端未提供试剂库存查询接口。'
      })
      return
    }
    const controller = new AbortController()
    setReagentStatus({ phase: 'loading', message: '正在读取试剂库存…' })
    void services.inventory.listReagentInventory(controller.signal).then(
      items => {
        if (controller.signal.aborted) return
        setReagentItems(items.map(projectReagentInventoryItem))
        setReagentStatus({
          phase: 'ready',
          message: '试剂库存已同步',
          retry: retryReagents
        })
      },
      error => {
        if (controller.signal.aborted) return
        setReagentItems(undefined)
        setReagentStatus({
          phase: 'error',
          message: errorMessage(error, '试剂库存读取失败'),
          retry: retryReagents
        })
      }
    )
    return () => controller.abort()
  }, [reagentRevision, retryReagents, services, viewMode])

  useEffect(() => {
    if (viewMode !== 'robot-reagents') return
    const capability = services.getCapabilityStatus('reagentInfo.read')
    if (!capability.available) {
      setReagentInfos(undefined)
      setReagentInfoStatus({
        phase: 'unavailable',
        message: capability.reason ?? '当前服务端未提供试剂基础信息目录。'
      })
      return
    }
    const controller = new AbortController()
    setReagentInfoStatus({ phase: 'loading', message: '正在读取试剂基础信息…' })
    void services.inventory.listReagentInfos(controller.signal).then(
      infos => {
        if (controller.signal.aborted) return
        setReagentInfos(infos.map(projectReagentInfoItem))
        setReagentInfoStatus({
          phase: 'ready',
          message: '试剂基础信息已同步',
          retry: retryReagents
        })
      },
      error => {
        if (controller.signal.aborted) return
        setReagentInfos(undefined)
        setReagentInfoStatus({
          phase: 'error',
          message: errorMessage(error, '试剂基础信息读取失败'),
          retry: retryReagents
        })
      }
    )
    return () => controller.abort()
  }, [reagentRevision, retryReagents, services, viewMode])

  useEffect(() => {
    if (viewMode !== 'robot-reagents') return
    const createCapability = services.getCapabilityStatus('inventory.createReagent')
    if (!createCapability.available) {
      setReagentContainers(undefined)
      setReagentContainerStatus({
        phase: 'unavailable',
        message: createCapability.reason ?? '当前服务端未开放试剂创建能力。'
      })
      return
    }
    const graphCapability = services.getCapabilityStatus('material.readGraph')
    if (!graphCapability.available) {
      setReagentContainers(undefined)
      setReagentContainerStatus({
        phase: 'unavailable',
        message: graphCapability.reason ?? '无法读取可选容器物料。'
      })
      return
    }
    const controller = new AbortController()
    setReagentContainerStatus({ phase: 'loading', message: '正在读取容器物料…' })
    void Promise.all([
      services.materials.getGraph({ kind: 'singleton' }),
      services.materials.listTemplates({ kind: 'singleton' })
    ]).then(
      ([aggregates, templates]) => {
        if (controller.signal.aborted) return
        setReagentContainers(projectReagentContainers(
          aggregates,
          templates.items
        ))
        setReagentContainerStatus({
          phase: 'ready',
          message: '容器物料已同步'
        })
      },
      error => {
        if (controller.signal.aborted) return
        setReagentContainers(undefined)
        setReagentContainerStatus({
          phase: 'error',
          message: errorMessage(error, '容器物料读取失败')
        })
      }
    )
    return () => controller.abort()
  }, [services, viewMode])

  const reagentManagement = useMemo<ReagentManagement | undefined>(() => {
    const requiredCapabilities = [
      'inventory.createReagent',
      'inventory.updateReagent',
      'inventory.deleteReagent',
      'inventory.readReagentHistory'
    ] as const
    if (requiredCapabilities.some(capability =>
      !services.getCapabilityStatus(capability).available
    )) return undefined
    return {
      ...(reagentContainers ? { containers: reagentContainers } : {}),
      containerStatus: reagentContainerStatus,
      create: createReagent,
      update: updateReagent,
      delete: deleteReagent,
      readHistory: readReagentHistory
    }
  }, [
    createReagent,
    deleteReagent,
    readReagentHistory,
    reagentContainerStatus,
    reagentContainers,
    services,
    updateReagent
  ])

  return {
    ...(benchSnapshot ? { benchSnapshot } : {}),
    benchStatus,
    ...(reagentItems ? { reagentItems } : {}),
    reagentStatus,
    ...(reagentInfos ? { reagentInfos } : {}),
    reagentInfoStatus,
    ...(reagentInfoManagement ? { reagentInfoManagement } : {}),
    ...(reagentManagement ? { reagentManagement } : {}),
    pointStatus: POINT_STATUS
  }
}

/**
 * 将公共物料图投影为实验台只读视图。
 * @param aggregates 后端返回的物料聚合根与库位占用事实。
 * @returns 不含前端模拟历史的库位、已放置物料与空历史集合。
 */
export function projectBenchSnapshot(
  aggregates: readonly MaterialAggregate[]
): BenchSnapshot {
  const aggregateById = new Map(aggregates.map(aggregate => [
    aggregate.material.id,
    aggregate
  ]))
  const siteById = new Map<string, {
    site: MaterialSite
    owner: MaterialAggregate
  }>()
  const sites = aggregates.flatMap(owner => owner.sites.map(site => {
    siteById.set(site.id, { site, owner })
    return projectBenchSite(site, owner, aggregateById)
  }))
  const materials = aggregates.flatMap(aggregate => {
    if (aggregate.placement.kind !== 'site') return []
    const placementSite = siteById.get(aggregate.placement.siteId)
    if (!placementSite) return []
    return [projectBenchMaterial(aggregate, placementSite.site)]
  })
  return {
    sites: sites.sort(compareById),
    materials: materials.sort(compareById),
    history: []
  }
}

/**
 * 投影一个真实库位及其逻辑占用关系。
 * @param site 公共物料图中的库位。
 * @param owner 声明该库位的物料聚合。
 * @param aggregateById 用于解析占用物料显示名的只读索引。
 * @returns 实验台库位行；坐标和尺寸均使用后端毫米值。
 */
function projectBenchSite(
  site: MaterialSite,
  owner: MaterialAggregate,
  aggregateById: ReadonlyMap<string, MaterialAggregate>
): BenchSiteProjection {
  const occupantNames = site.occupiedMaterialIds.map(id =>
    aggregateById.get(id)?.material.name ?? id
  )
  const occupantTemplates = site.occupiedMaterialIds.map(id =>
    aggregateById.get(id)?.material.sourceTemplateId
  ).filter((value): value is string => Boolean(value))
  const [x, y, z] = site.poseInAnchor.positionMm
  return {
    id: site.id,
    name: site.name,
    device: owner.material.name,
    position: `${formatMillimeter(x)}, ${formatMillimeter(y)}, ${formatMillimeter(z)}`,
    materialType: [...new Set(occupantTemplates.length
      ? occupantTemplates
      : site.allowedTemplateIds)].join('、') || '未限制',
    materialName: occupantNames.join('、') || null,
    workflowLabel: null,
    status: site.occupiedMaterialIds.length > 0 ? 'occupied' : 'empty',
    x,
    y,
    width: site.sizeMm[0]
  }
}

/**
 * 投影一个后端确认放置在库位内的物料。
 * @param aggregate 被放置物料的聚合记录。
 * @param site 物料 placement 指向的真实库位。
 * @returns 物料清单行；占用关系不一致时保持状态不明。
 */
function projectBenchMaterial(
  aggregate: MaterialAggregate,
  site: MaterialSite
): BenchMaterialProjection {
  const occupancyConfirmed = site.occupiedMaterialIds.includes(aggregate.material.id)
  return {
    id: aggregate.material.id,
    name: aggregate.material.name,
    template: aggregate.material.sourceTemplateId,
    location: site.name,
    status: occupancyConfirmed ? 'idle' : 'unknown',
    workflowLabel: null,
    siteId: site.id
  }
}

/**
 * 复制统一库存端口提供的真实字段，不补齐服务端未返回的数量。
 * @param item 统一库存只读端口的条目。
 * @returns 机械臂工作站试剂模块可直接展示的同语义投影。
 */
function projectReagentInventoryItem(
  item: ReagentInventoryItem
): ReagentInventoryProjection {
  return { ...item }
}

/**
 * 复制试剂基础信息端口的权威字段，不从库存实例反推目录项。
 * @param item Backend 试剂基础信息目录项。
 * @returns 试剂管理界面可直接展示的同语义投影。
 */
function projectReagentInfoItem(item: ReagentInfoItem): ReagentInfoProjection {
  return { ...item }
}

/**
 * 将公共物料图中的物料身份投影为试剂创建表单可选容器。
 * @param aggregates Backend 权威物料聚合。
 * @param templates Backend 权威资源模板目录，用 container 标签限定候选。
 * @returns 按名称和 UUID 排序的容器物料候选；内容是否为空仍由 Backend 校验。
 */
export function projectReagentContainers(
  aggregates: readonly MaterialAggregate[],
  templates: readonly Pick<MaterialTemplateSummary, 'uuid' | 'tags'>[]
): readonly ReagentContainerOption[] {
  const containerTemplateIds = new Set(templates.flatMap(template =>
    template.tags.some(tag => tag.trim().toLocaleLowerCase('en-US') === 'container')
      ? [template.uuid]
      : []
  ))
  return aggregates.filter(aggregate =>
    containerTemplateIds.has(aggregate.material.sourceTemplateId)
  ).map(aggregate => ({
    id: aggregate.material.id,
    name: aggregate.material.name,
    ...(aggregate.material.code ? { barcode: aggregate.material.code } : {}),
    templateId: aggregate.material.sourceTemplateId
  })).sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
  )
}

/**
 * 移除服务层历史中的重复主体身份，只保留试剂页需要的审计字段。
 * @param entry 已由 Services 严格解码的 Backend 台账事件。
 * @returns 试剂工作站历史投影。
 */
function projectReagentHistoryEntry(
  entry: Awaited<ReturnType<Services['inventory']['listReagentHistory']>>['items'][number]
): ReagentHistoryProjection {
  return {
    id: entry.id,
    eventType: entry.eventType,
    operatorType: entry.operatorType,
    ...(entry.quantityDelta == null ? {} : { quantityDelta: entry.quantityDelta }),
    ...(entry.quantityUnit ? { quantityUnit: entry.quantityUnit } : {}),
    ...(entry.revision == null ? {} : { revision: entry.revision }),
    ...(entry.workflowTaskId ? { workflowTaskId: entry.workflowTaskId } : {}),
    ...(entry.workflowNodeJobId ? { workflowNodeJobId: entry.workflowNodeJobId } : {}),
    ...(entry.traceId ? { traceId: entry.traceId } : {}),
    recordedAt: entry.recordedAt
  }
}

/** 按稳定身份排序实验台投影行。 */
function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id)
}

/** 将毫米坐标格式化为紧凑且带单位的文本。 */
function formatMillimeter(value: number): string {
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} mm`
}

/** 将未知异常转换为用户可恢复的中文接口错误。 */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
