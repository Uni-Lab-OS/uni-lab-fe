import { readDefaultMaterialNodePresentation } from './react-flow/defaultNodePresentation'
import type { MaterialAggregate, MaterialId } from './types'

export const MATERIAL_HANDLING_DRAG_TYPE =
  'application/x-unilab-material-id'

/** 只有独立物料允许人工上下料，设备与父级托管组件保持固定。 */
export function isOperatorHandledMaterial(
  aggregate: MaterialAggregate
): boolean {
  if (aggregate.material.component?.managedByParent === true) return false
  const explicitDecision = readExplicitOperatorHandlingDecision(aggregate)
  return explicitDecision ??
    readDefaultMaterialNodePresentation(aggregate).kind === 'material'
}

/** 列表上料只接受顶层未占用物料；OS 下料后会保留位置并投影为 world。 */
export function isMaterialListHandlingDraggable(
  aggregate: MaterialAggregate
): boolean {
  return (
    aggregate.placement.kind === 'unplaced' ||
    aggregate.placement.kind === 'world'
  ) &&
    isOperatorHandledMaterial(aggregate)
}

/** 跨列表与画布只传稳定物料 ID，权威聚合始终从当前 Store 重读。 */
export function writeMaterialHandlingDragData(
  dataTransfer: Pick<DataTransfer, 'effectAllowed' | 'setData'>,
  materialId: MaterialId
): void {
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(MATERIAL_HANDLING_DRAG_TYPE, materialId)
}

export function readMaterialHandlingDragData(
  dataTransfer: Pick<DataTransfer, 'getData'>
): MaterialId | null {
  const materialId = dataTransfer.getData(MATERIAL_HANDLING_DRAG_TYPE)
  return materialId.length > 0 && materialId.trim() === materialId
    ? materialId
    : null
}

/**
 * 新版 OS 会在名称中保留来源父级（例如“烧杯堆栈2 … 烧杯”），所以明确的
 * Backend 模板类型和 renderer 必须先于名称兜底，避免把独立烧杯误判为堆栈。
 */
function readExplicitOperatorHandlingDecision(
  aggregate: MaterialAggregate
): boolean | null {
  const config = recordValue(aggregate.material.config)
  const resourceTemplate = recordValue(config.resourceTemplate)
  const resourceType = normalizedString(resourceTemplate.resourceType)
  if (
    resourceType &&
    ['device', 'equipment', 'instrument', 'control'].some((token) =>
      resourceType.includes(token)
    )
  ) return false

  const rendering = recordValue(config.rendering)
  const renderingKind = normalizedString(
    rendering.kind ?? rendering.type ?? config.category
  )
  if (!renderingKind || ['custom', 'unknown'].includes(renderingKind)) {
    return null
  }

  return readDefaultMaterialNodePresentation({
    ...aggregate,
    material: {
      ...aggregate.material,
      sourceTemplateId: '',
      code: '',
      name: ''
    }
  }).kind === 'material'
}

function recordValue(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().replaceAll('_', '-').toLowerCase()
    : null
}
