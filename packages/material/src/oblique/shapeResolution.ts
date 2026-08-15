import type { MaterialShapeIdentity } from '../types'
import type {
  MaterialObliqueLevel,
  MaterialObliqueShape
} from './projectionTypes'
import {
  resolveShapePrimitives,
  resolveShapeSpec,
  resolveShapeSpecByIdentity,
  type MaterialShapeLibrary,
  type MaterialShapePrimitive,
  type MaterialShapeSpec
} from './shapeSpec'

/** 已选中的公共外形声明及其按物料尺寸展开的毫米图元。 */
export interface ResolvedMaterialObliqueShape {
  spec: MaterialShapeSpec
  shape: MaterialObliqueShape
  primitives: readonly MaterialShapePrimitive[]
}

/**
 * 先按物料冻结的复合外形身份精确选择，再按旧 category 合同兼容匹配。
 * 敞口层架只有一层位点时退回实心包围盒，避免单层「层架」遮挡内部物料。
 *
 * @param shapes `/api/v1/material-shapes` 返回并解析的公共外形目录。
 * @param shapeIdentity 物料创建时冻结的可空 `{bundle, id}` 外形身份。
 * @param kind 旧物料配置投影出的分类匹配键。
 * @param levels 当前物料的真实库位（Site）层级。
 * @param envelope 当前物料实例的毫米外包尺寸。
 * @returns 可绘制的声明与图元；没有安全匹配时返回 undefined 触发包围盒降级。
 */
export function resolveMaterialObliqueShape(
  shapes: MaterialShapeLibrary | undefined,
  shapeIdentity: MaterialShapeIdentity | undefined,
  kind: string,
  levels: readonly MaterialObliqueLevel[],
  envelope: { widthMm: number; depthMm: number; heightMm: number }
): ResolvedMaterialObliqueShape | undefined {
  const spec = shapeIdentity
    ? resolveShapeSpecByIdentity(
        shapes,
        shapeIdentity.bundle,
        shapeIdentity.id
      ) ?? resolveShapeSpec(shapes, kind)
    : resolveShapeSpec(shapes, kind)
  if (!spec) return undefined
  const primitives = resolveShapePrimitives(spec, envelope)
  if (primitives.length === 0) return undefined
  const needsRack = primitives.some(
    (primitive) => primitive.kind === 'open-rack'
  )
  if (needsRack && levels.length === 1) return undefined

  return {
    spec,
    primitives,
    shape: {
      id: spec.id,
      bundle: spec.bundle,
      primitives,
      shadow: spec.shadow
    }
  }
}
