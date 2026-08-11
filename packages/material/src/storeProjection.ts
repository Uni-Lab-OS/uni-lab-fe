import type {
  DeleteMaterialSubtreeResult,
  LabPose,
  MaterialAggregate,
  MaterialGraphIndex,
  MaterialId
} from './types'

export const EMPTY_MATERIAL_GRAPH_INDEX: MaterialGraphIndex = {
  childrenByParentId: {},
  siteOwnerById: {}
}

/**
 * 从服务端确认结果计算删除后的物料聚合投影。
 * @param current 当前权威读投影的本地副本。
 * @param result 服务端确认删除身份及受影响聚合。
 * @returns 待校验并一次性提交的新聚合字典。
 */
export function projectMaterialDeletion(
  current: Readonly<Record<MaterialId, MaterialAggregate>>,
  result: DeleteMaterialSubtreeResult
): Record<MaterialId, MaterialAggregate> {
  const next = { ...current }
  for (const deletedMaterialId of result.deletedMaterialIds) {
    delete next[deletedMaterialId]
  }
  for (const aggregate of result.aggregates) {
    next[aggregate.material.id] = structuredClone(aggregate)
  }
  return next
}

/**
 * 将未知异常转换为物料工作台可展示的错误文本。
 * @param error 服务端口或规则校验抛出的异常。
 * @returns 保留已知异常信息的用户可见文本。
 */
export function materialOperationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Material operation failed'
}

/**
 * 生成远端转运默认的零偏移位姿。
 * @returns 使用毫米和 XYZ degree 的零位姿。
 */
export function zeroLabPose(): LabPose {
  return {
    positionMm: [0, 0, 0],
    rotationDegXYZ: [0, 0, 0]
  }
}

/**
 * 同步库位占用及其可选的视觉状态。
 * @param site 待更新的稳定库位投影。
 * @param occupiedMaterialIds 服务端事件确认的占用物料身份。
 * @returns 不修改原库位对象的新投影。
 */
export function withSiteOccupancy(
  site: MaterialAggregate['sites'][number],
  occupiedMaterialIds: readonly MaterialId[]
): MaterialAggregate['sites'][number] {
  const occupied = occupiedMaterialIds.length > 0
  return {
    ...site,
    occupiedMaterialIds,
    visual: site.visual
      ? {
          state: occupied ? 'occupied' : 'empty',
          fillFraction: occupied ? 1 : 0
        }
      : undefined
  }
}

/**
 * 从工作台状态读取一个必须存在的物料聚合。
 * @param aggregatesById 当前物料聚合字典。
 * @param materialId 待读取的稳定物料 UUID。
 * @returns 对应物料聚合；身份不存在时抛错并阻止写命令。
 */
export function requireMaterialAggregate(
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  materialId: MaterialId
): MaterialAggregate {
  const aggregate = aggregatesById[materialId]
  if (!aggregate) throw new Error(`Unknown Material: ${materialId}`)
  return aggregate
}
