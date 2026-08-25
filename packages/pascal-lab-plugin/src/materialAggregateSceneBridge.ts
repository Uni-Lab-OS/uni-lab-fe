import {
  shouldRenderSiteBounds,
  type MaterialAggregate,
  type MaterialId,
  type MaterialPlacement,
  type MaterialSite
} from '@unilab/material/domain'
import type { SceneGraph } from '@unilab/pascal-host'
import {
  LabDeviceNodeSchema,
  LabMaterialTransferLayerNodeSchema,
  LabTableNodeSchema,
  isLabDeviceNode,
  isLabTableNode
} from './schema'
import type { MaterialSceneMove, MaterialSceneProjectionOptions } from './materialAggregateSceneTypes'
import { inferModelFormat } from './modelFormat'
import { projectMaterialTransferSceneLayer } from './materialTransferScene'
import { readMaterialRendering } from './materialRenderingSnapshot'
import {
  placementFromSceneNode,
  projectPlacement,
  resolveAggregateWorldPose,
  samePlacement
} from './materialPlacementProjection'
import { readRecord, sanitizeRosName, stringValue } from './materialSceneWire'
import type { Vector3Tuple } from './units'

export type {
  MaterialRenderingSnapshot,
  MaterialSceneMove,
  MaterialSceneProjectionOptions,
  MaterialTransferSceneEndpoint,
  MaterialTransferSceneRoute
} from './materialAggregateSceneTypes'
export { orthogonalTransferPath, projectMaterialTransferSceneLayer } from './materialTransferScene'
export { readMaterialRendering } from './materialRenderingSnapshot'

const SITE_ID = 'site_unilab'
const BUILDING_ID = 'building_unilab'
const LEVEL_ID = 'level_unilab'
const MATERIAL_TRANSFER_LAYER_ID = 'lab-material-transfer-layer-unilab'

/** 比较由 Backend/OS 提供的毫米坐标，容忍序列化产生的微小浮点误差。 */
function sameMillimeterTuple(
  left: readonly number[],
  right: readonly number[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) => Math.abs(value - (right[index] ?? 0)) <= 1e-6
    )
  )
}

/**
 * 解析库位（Site）辅助框代表的物料（Material）场景身份。
 *
 * Backend 已返回占用关系时直接使用权威 UUID；旧图仅有父子相对位置时，
 * 只有模板、位置、旋转和尺寸全部唯一匹配才做只读展示兼容。
 */
function resolveSiteOccupantSceneObjectId(
  owner: MaterialAggregate,
  site: MaterialSite,
  aggregates: readonly MaterialAggregate[],
  sceneObjectIdByMaterialId: Readonly<Record<MaterialId, string>>
): string | undefined {
  const declaredOccupants = site.occupiedMaterialIds
    .map((materialId) => sceneObjectIdByMaterialId[materialId])
    .filter((value): value is string => Boolean(value))
  if (declaredOccupants.length === 1) return declaredOccupants[0]
  if (declaredOccupants.length > 1 || site.anchor.kind !== 'root') {
    return undefined
  }

  const compatibleChildren = aggregates.filter((candidate) => {
    const placement = candidate.placement
    if (placement.kind === 'site') {
      return placement.parentId === owner.material.id &&
        placement.siteId === site.id
    }
    if (
      placement.kind !== 'parent' ||
      placement.parentId !== owner.material.id ||
      placement.anchor.kind !== 'root'
    ) {
      return false
    }
    if (
      site.allowedTemplateIds.length > 0 &&
      !site.allowedTemplateIds.includes(candidate.material.sourceTemplateId)
    ) {
      return false
    }
    const dimensionsMm = readMaterialRendering(candidate).dimensionsMm
    return sameMillimeterTuple(
      placement.localPose.positionMm,
      site.poseInAnchor.positionMm
    ) && sameMillimeterTuple(
      placement.localPose.rotationDegXYZ,
      site.poseInAnchor.rotationDegXYZ
    ) && sameMillimeterTuple(
      dimensionsMm,
      [site.sizeMm[0], site.sizeMm[2], site.sizeMm[1]]
    )
  })
  if (compatibleChildren.length !== 1) return undefined
  return sceneObjectIdByMaterialId[
    compatibleChildren[0]!.material.id
  ]
}

/**
 * 把权威物料（Material）聚合投影为 Pascal 所有的场景状态。
 * `material.config.rendering` 优先承载实例渲染快照；直接配置字段仅用于迁移兼容。
 */
export function materialAggregatesToSceneGraph(
  aggregates: readonly MaterialAggregate[],
  options: MaterialSceneProjectionOptions = {}
): SceneGraph {
  const effectiveAggregates = aggregates.map((aggregate) => {
    const placement = options.runtimePlacementByMaterialId?.[aggregate.material.id]
    return placement ? { ...aggregate, placement } : aggregate
  })
  const aggregatesById = Object.fromEntries(
    effectiveAggregates.map((aggregate) => [aggregate.material.id, aggregate])
  )
  const sceneObjectIdByMaterialId = Object.fromEntries(
    effectiveAggregates.map((aggregate) => [
      aggregate.material.id,
      materialSceneObjectId(aggregate)
    ])
  )
  const nodes: Record<string, unknown> = {}
  const labNodeIds: string[] = []
  const kinematicNodeIds: string[] = []
  const transferLayer = options.showMaterialTransfers === false
    ? null
    : projectMaterialTransferSceneLayer(
        aggregates,
        options.materialTransferRoutes ?? []
      )
  for (const aggregate of effectiveAggregates) {
    const id = sceneObjectIdByMaterialId[aggregate.material.id]
    const rendering = readMaterialRendering(aggregate)
    const materialConfig = readRecord(aggregate.material.config)
    const logicalMount =
      materialConfig.logical_mount === true ||
      materialConfig.logicalMount === true
    const projected = projectPlacement(
      aggregate,
      aggregatesById,
      sceneObjectIdByMaterialId
    )
    const worldPose = resolveAggregateWorldPose(
      aggregate.material.id,
      aggregatesById
    )
    const common = {
      id,
      parentId: LEVEL_ID,
      materialNodeId: aggregate.material.id,
      displayName: aggregate.material.name,
      showLabel: options.showMaterialLabels !== false,
      position: projected.position,
      rotation: projected.rotation,
      dimensions: rendering.dimensionsMm.map(
        (value) => Math.max(value / 1000, 0.01)
      ) as Vector3Tuple,
      materialKind: rendering.materialKind,
      placementRef: projected.placementRef,
      floorplanSnapshot: {
        kind: rendering.kind,
        worldPositionMm: worldPose.positionMm,
        worldRotationDegXYZ: worldPose.rotationDegXYZ,
        footprintMm: rendering.footprintMm,
        showSites: options.showSites !== false,
        sites: aggregate.sites
          .filter((site) => shouldRenderSiteBounds(aggregate, site))
          .map((site) => ({
            id: site.id,
            key: site.key,
            name: site.name,
            kind: site.kind,
            shape: site.shape,
            positionMm: site.poseInAnchor.positionMm,
            rotationDegXYZ: site.poseInAnchor.rotationDegXYZ,
            sizeMm: site.sizeMm,
            visible: site.visible !== false,
            occupied: site.occupiedMaterialIds.length > 0,
            occupantSceneObjectId: resolveSiteOccupantSceneObjectId(
              aggregate,
              site,
              effectiveAggregates,
              sceneObjectIdByMaterialId
            ),
            visualState: site.visual?.state ?? 'empty'
          }))
      }
    }

    if (rendering.kind === 'table') {
      nodes[id] = LabTableNodeSchema.parse({
        ...common,
        type: 'lab-table'
      })
    } else {
      nodes[id] = LabDeviceNodeSchema.parse({
        ...common,
        type: 'lab-device',
        renderBody: !logicalMount,
        deviceType: rendering.kind || 'custom',
        templateUuid: aggregate.material.sourceTemplateId,
        rosDeviceName: sanitizeRosName(
          stringValue(
            readRecord(aggregate.material.config).rosDeviceName,
            aggregate.material.code || aggregate.material.name
          )
        ),
        scale: rendering.scale,
        ...(rendering.kinematics
          ? { kinematics: rendering.kinematics }
          : {}),
        model: {
          path: rendering.model.path,
          format: inferModelFormat(
            rendering.model.path,
            rendering.model.format
          ),
          meshDir: rendering.model.meshDir,
          macro: rendering.model.macro,
          ossDir: rendering.model.ossDir,
          version: rendering.model.version,
          type: rendering.model.type,
          color: rendering.model.color,
          position: rendering.model.position,
          rotation: rendering.model.rotation,
          attachPoints: rendering.model.attachPoints,
          instances: rendering.model.instances
        },
        attach: projected.attach
      })
    }
    labNodeIds.push(id)
    if (rendering.kinematics) {
      kinematicNodeIds.push(id)
    }
  }

  nodes[SITE_ID] = {
    id: SITE_ID,
    type: 'site',
    object: 'node',
    name: 'Uni-Lab',
    parentId: null,
    visible: true,
    children: [BUILDING_ID],
    fitSceneRevision: options.fitSceneRevision ?? 0,
    fitSceneView: options.fitSceneView ?? 'default',
    fitSceneObjectIds:
      options.fitSceneFocus === 'kinematics' ? kinematicNodeIds : []
  }
  nodes[BUILDING_ID] = {
    id: BUILDING_ID,
    type: 'building',
    object: 'node',
    name: '实验室',
    parentId: SITE_ID,
    visible: true,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    children: [LEVEL_ID]
  }
  nodes[LEVEL_ID] = {
    id: LEVEL_ID,
    type: 'level',
    object: 'node',
    name: 'Lab floor',
    parentId: BUILDING_ID,
    visible: true,
    level: 0,
    children: labNodeIds,
    materialTransferLayer:
      transferLayer && (
        transferLayer.routes.length > 0 ||
        transferLayer.unresolvedRouteIds.length > 0
      )
        ? LabMaterialTransferLayerNodeSchema.parse({
            id: MATERIAL_TRANSFER_LAYER_ID,
            type: 'lab-material-transfer-layer',
            object: 'node',
            name: '物料转运投影',
            parentId: LEVEL_ID,
            visible: true,
            metadata: {},
            ...transferLayer
          })
        : null
  }

  return {
    nodes,
    rootNodeIds: [SITE_ID],
    installedPlugins: ['unilab.lab']
  }
}

/**
 * 将工作流（Workflow）路线的稳定物料（Material）与库位（Site）身份解析为
 * Pascal 世界坐标。
 *
 * @param aggregates 操作系统（OS）物料图提供的权威只读聚合。
 * @param routes 已发布标准转运工作流派生的逻辑路线。
 * @returns 可渲染路线与失败关闭的未解析路线身份；不修改物料位置。
 */

export function sceneGraphToMaterialMoves(
  scene: SceneGraph,
  aggregates: readonly MaterialAggregate[],
  runtimePlacementByMaterialId: Readonly<Record<MaterialId, MaterialPlacement>> = {}
): MaterialSceneMove[] {
  const aggregatesById = Object.fromEntries(
    aggregates.map((aggregate) => [aggregate.material.id, aggregate])
  )
  const moves: MaterialSceneMove[] = []

  for (const value of Object.values(scene.nodes)) {
    if (!isLabDeviceNode(value) && !isLabTableNode(value)) continue
    const aggregate = aggregatesById[value.materialNodeId]
    if (!aggregate) continue
    if (runtimePlacementByMaterialId[aggregate.material.id]) continue

    const placement = placementFromSceneNode(
      value.position,
      value.rotation,
      aggregate,
      aggregatesById
    )
    if (!samePlacement(placement, aggregate.placement)) {
      moves.push({
        materialId: aggregate.material.id,
        placement
      })
    }
  }

  return moves
}

export function materialSceneObjectId(
  aggregate: MaterialAggregate
): string {
  return readMaterialRendering(aggregate).kind === 'table'
    ? `lab-table-${aggregate.material.id}`
    : `lab-${aggregate.material.id}`
}
