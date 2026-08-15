import {
  composePoses,
  poseToMatrix,
  transformPoint,
  type LabPose,
  type MaterialAggregate,
  type Vector3Tuple
} from '@unilab/material/domain'

import { readMaterialRendering } from './materialRenderingSnapshot'
import { resolveAggregateWorldPose } from './materialPlacementProjection'

export interface MaterialSceneSourceIdentity {
  sourceId: string
  authority: 'local' | 'backend'
  workspacePath: string
  backendUrl: string
  rendererGeneration: string
}

export interface MaterialSceneInspectionOptions {
  viewMode: '2d' | '2.5d' | '3d' | 'split'
  showSites: boolean
  showMaterialTransfers: boolean
  selectedMaterialIds?: readonly string[]
  hiddenMaterialIds?: readonly string[]
  sourceIdentity: MaterialSceneSourceIdentity
}

export interface MaterialSceneBounds {
  minimumMm: Vector3Tuple
  maximumMm: Vector3Tuple
  sizeMm: Vector3Tuple
  centerMm: Vector3Tuple
}

export interface MaterialSceneInspection {
  schemaVersion: 'unilab-material-scene/v1'
  sourceIdentity: MaterialSceneSourceIdentity
  layoutRevision: string
  templateRevision: string
  view: {
    mode: MaterialSceneInspectionOptions['viewMode']
    showSites: boolean
    showMaterialTransfers: boolean
  }
  bounds: MaterialSceneBounds | null
  counts: {
    materials: number
    visibleMaterials: number
    sites: number
    visibleSites: number
  }
  nodes: Array<{
    materialId: string
    sourceNodeId: string | null
    sceneObjectId: string
    sourceTemplateId: string
    code: string
    name: string
    kind: string
    revision: number
    placement: MaterialAggregate['placement']
    worldPose: LabPose
    dimensionsMm: Vector3Tuple
    bounds: MaterialSceneBounds
    visible: boolean
    selected: boolean
    sites: Array<{
      siteId: string
      key: string
      name: string
      kind: string
      worldPose: LabPose
      sizeMm: Vector3Tuple
      visible: boolean
      capacity: number
      allowedTemplateIds: readonly string[]
      occupiedMaterialIds: readonly string[]
    }>
  }>
}

/**
 * 从 Pascal 实际消费的 MaterialAggregate 构建 Agent 可检查的场景快照。
 * 这里不持有第二份场景，也不读取 DOM；节点身份、位置和尺寸与渲染投影同源。
 */
export function inspectMaterialAggregateScene(
  aggregates: readonly MaterialAggregate[],
  options: MaterialSceneInspectionOptions
): MaterialSceneInspection {
  const aggregatesById = Object.fromEntries(
    aggregates.map(aggregate => [aggregate.material.id, aggregate])
  )
  const selected = new Set(options.selectedMaterialIds ?? [])
  const hidden = new Set(options.hiddenMaterialIds ?? [])
  const nodes = aggregates.map(aggregate => {
    const rendering = readMaterialRendering(aggregate)
    const worldPose = resolveAggregateWorldPose(
      aggregate.material.id,
      aggregatesById
    )
    const visible = !hidden.has(aggregate.material.id)
    const sites = aggregate.sites.map(site => ({
      siteId: site.id,
      key: site.key,
      name: site.name,
      kind: site.kind ?? 'site',
      worldPose: composePoses(worldPose, site.poseInAnchor),
      sizeMm: site.sizeMm,
      visible: visible && options.showSites && site.visible !== false,
      capacity: site.capacity,
      allowedTemplateIds: [...site.allowedTemplateIds],
      occupiedMaterialIds: [...site.occupiedMaterialIds]
    }))
    return {
      materialId: aggregate.material.id,
      sourceNodeId: typeof aggregate.material.config.sourceIdentity === 'string'
        ? aggregate.material.config.sourceIdentity
        : null,
      sceneObjectId: rendering.kind === 'table'
        ? `lab-table-${aggregate.material.id}`
        : `lab-${aggregate.material.id}`,
      sourceTemplateId: aggregate.material.sourceTemplateId,
      code: aggregate.material.code,
      name: aggregate.material.name,
      kind: rendering.kind,
      revision: aggregate.revision,
      placement: aggregate.placement,
      worldPose,
      dimensionsMm: rendering.dimensionsMm,
      bounds: orientedBounds(worldPose, rendering.dimensionsMm),
      visible,
      selected: selected.has(aggregate.material.id),
      sites
    }
  })
  const visibleNodes = nodes.filter(node => node.visible)
  const bounds = unionBounds(visibleNodes.map(node => node.bounds))
  return {
    schemaVersion: 'unilab-material-scene/v1',
    sourceIdentity: options.sourceIdentity,
    layoutRevision: layoutRevision(aggregates),
    templateRevision: templateRevision(aggregates),
    view: {
      mode: options.viewMode,
      showSites: options.showSites,
      showMaterialTransfers: options.showMaterialTransfers
    },
    bounds,
    counts: {
      materials: nodes.length,
      visibleMaterials: visibleNodes.length,
      sites: nodes.reduce((count, node) => count + node.sites.length, 0),
      visibleSites: nodes.reduce(
        (count, node) => count + node.sites.filter(site => site.visible).length,
        0
      )
    },
    nodes
  }
}

/** 计算旋转后包围盒，避免 Agent 以未旋转尺寸误判设备遮挡。 */
function orientedBounds(
  pose: LabPose,
  dimensions: Vector3Tuple
): MaterialSceneBounds {
  const half = dimensions.map(value => value / 2) as unknown as Vector3Tuple
  const matrix = poseToMatrix(pose)
  const points: Vector3Tuple[] = []
  for (const x of [-half[0], half[0]]) {
    for (const y of [-half[1], half[1]]) {
      for (const z of [-half[2], half[2]]) {
        points.push(transformPoint(matrix, [x, y, z]))
      }
    }
  }
  return boundsFromPoints(points)
}

function boundsFromPoints(points: readonly Vector3Tuple[]): MaterialSceneBounds {
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  for (const point of points) {
    for (let index = 0; index < 3; index += 1) {
      minimum[index] = Math.min(minimum[index], point[index])
      maximum[index] = Math.max(maximum[index], point[index])
    }
  }
  return finishBounds(minimum, maximum)
}

function unionBounds(
  bounds: readonly MaterialSceneBounds[]
): MaterialSceneBounds | null {
  if (bounds.length === 0) return null
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  for (const item of bounds) {
    for (let index = 0; index < 3; index += 1) {
      minimum[index] = Math.min(minimum[index], item.minimumMm[index])
      maximum[index] = Math.max(maximum[index], item.maximumMm[index])
    }
  }
  return finishBounds(minimum, maximum)
}

function finishBounds(
  minimum: number[],
  maximum: number[]
): MaterialSceneBounds {
  const minimumMm = minimum as unknown as Vector3Tuple
  const maximumMm = maximum as unknown as Vector3Tuple
  return {
    minimumMm,
    maximumMm,
    sizeMm: minimum.map((value, index) => maximum[index] - value) as unknown as Vector3Tuple,
    centerMm: minimum.map((value, index) => (maximum[index] + value) / 2) as unknown as Vector3Tuple
  }
}

/** 小型确定性摘要，避免浏览器端引入 Node crypto 或伪造服务 revision。 */
function layoutRevision(aggregates: readonly MaterialAggregate[]): string {
  const source = aggregates
    .map(aggregate => `${aggregate.material.id}:${aggregate.revision}:${JSON.stringify(aggregate.placement)}`)
    .sort()
    .join('|')
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function templateRevision(aggregates: readonly MaterialAggregate[]): string {
  const source = aggregates
    .map(aggregate => `${aggregate.material.sourceTemplateId}:${JSON.stringify(
      aggregate.material.config.rendering ?? null
    )}`)
    .sort()
    .join('|')
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
