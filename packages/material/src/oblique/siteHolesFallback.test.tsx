import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { MaterialAggregate, MaterialSite } from '../types'
import { materialAggregate } from '../testFixtures'
import { MaterialObliqueCanvas } from './MaterialObliqueCanvas'
import {
  parseShapeLibrary,
  resolveShapePrimitives,
  type MaterialShapeLibrary,
  type MaterialShapeSpec
} from './shapeSpec'

describe('site-holes fallback', () => {
  /**
   * 证明同一份模板兜底网格能按实例外包方向展开，且不会改变 24 个内部标记的数量。
   */
  it('matches the canonical envelope and its swapped orientation', () => {
    const spec = tipBoxShapeSpec()
    const canonical = siteHolesPrimitive(
      resolveShapePrimitives(spec, {
        widthMm: 86,
        depthMm: 128,
        heightMm: 136
      })
    )
    const swapped = siteHolesPrimitive(
      resolveShapePrimitives(spec, {
        widthMm: 128,
        depthMm: 86,
        heightMm: 136
      })
    )

    expect(canonical.fallbackMarkers).toHaveLength(24)
    expect(canonical.fallbackMarkers?.[0]?.xMm).toBeCloseTo(8.85)
    expect(canonical.fallbackMarkers?.[0]?.yMm).toBeCloseTo(14.05)
    expect(canonical.fallbackMarkers?.[0]?.widthMm).toBeCloseTo(14.7)
    expect(canonical.fallbackMarkers?.[0]?.depthMm).toBeCloseTo(14.7)
    expect(canonical.fallbackMarkers?.[0]?.zMm).toBeCloseTo(113)
    expect(canonical.fallbackMarkers?.[23]?.xMm).toBeCloseTo(62.85)
    expect(canonical.fallbackMarkers?.[23]?.yMm).toBeCloseTo(104.05)
    expect(swapped.fallbackMarkers).toHaveLength(24)
    expect(swapped.fallbackMarkers?.[0]?.xMm).toBeCloseTo(14.05)
    expect(swapped.fallbackMarkers?.[0]?.yMm).toBeCloseTo(8.85)
    expect(swapped.fallbackMarkers?.[0]?.widthMm).toBeCloseTo(14.7)
    expect(swapped.fallbackMarkers?.[0]?.depthMm).toBeCloseTo(14.7)
    expect(swapped.fallbackMarkers?.[0]?.zMm).toBeCloseTo(113)
    expect(swapped.fallbackMarkers?.[23]?.xMm).toBeCloseTo(104.05)
    expect(swapped.fallbackMarkers?.[23]?.yMm).toBeCloseTo(62.85)
  })

  /** 标准外包与实例比例无关时应失败关闭，避免把内部点阵画到错误设备上。 */
  it('fails closed when the instance envelope cannot match safely', () => {
    const primitive = siteHolesPrimitive(
      resolveShapePrimitives(tipBoxShapeSpec(), {
        widthMm: 100,
        depthMm: 100,
        heightMm: 136
      })
    )

    expect(primitive.fallbackMarkers).toBeUndefined()
  })

  /**
   * 证明 Backend 无内部库位（Site）时显示声明式标记，而直连 OS 有真实点位时
   * 只显示权威点位并抑制兜底，避免重复或伪造库位身份。
   */
  it('uses fallback only when the authoritative site collection is empty', () => {
    const shapes = tipBoxShapeLibrary()
    const backendMarkup = renderToStaticMarkup(
      <MaterialObliqueCanvas
        aggregates={[tipBoxAggregate('backend-tip-box')]}
        shapes={shapes}
      />
    )
    const osMarkup = renderToStaticMarkup(
      <MaterialObliqueCanvas
        aggregates={[
          tipBoxAggregate('os-tip-box', [
            tipSpot('os-tip-box', 'TIP01', [8.85, 14.05, 113]),
            tipSpot('os-tip-box', 'TIP02', [26.85, 14.05, 113])
          ])
        ]}
        shapes={shapes}
      />
    )

    expect(markerCount(backendMarkup)).toBe(24)
    expect(backendMarkup).not.toContain('data-site-id=')
    expect(backendMarkup).not.toContain('data-site-key=')
    expect(markerCount(osMarkup)).toBe(0)
    expect(osMarkup).toContain('data-site-key="TIP01"')
    expect(osMarkup).toContain('data-site-key="TIP02"')
  })
})

/** 返回经过公共 wire 解析的 TIP 盒外形目录。 */
function tipBoxShapeLibrary(): MaterialShapeLibrary {
  return parseShapeLibrary([
    {
      id: 'tip_box',
      bundle: 'szlab-poly-studio',
      categories: ['tip_box'],
      categoryTokens: [],
      priority: 0,
      envelope: [86, 128, 136],
      units: 'ratio',
      shadow: 'box',
      sort: 'center',
      parts: [
        {
          type: 'sites',
          generator: 'site-holes',
          fallback: {
            type: 'grid',
            units: 'mm',
            orientation: 'match-envelope',
            count: [4, 6],
            pitch: [18, 18],
            part: {
              type: 'rect',
              style: 'hole',
              from: [8.85, 14.05],
              to: [23.55, 28.75],
              z: 113
            }
          }
        }
      ]
    }
  ])
}

/** 返回测试使用的唯一 TIP 盒外形，目录解析失败时立即暴露合同错误。 */
function tipBoxShapeSpec(): MaterialShapeSpec {
  const spec = tipBoxShapeLibrary()[0]
  if (!spec) throw new Error('TIP 盒测试外形未通过公共 wire 解析')
  return spec
}

/**
 * 从求解结果中读取 site-holes 图元。
 * @param primitives 已按物料实例尺寸展开的图元。
 * @returns 携带可选内部标记的 site-holes 图元。
 */
function siteHolesPrimitive(
  primitives: ReturnType<typeof resolveShapePrimitives>
): Extract<(typeof primitives)[number], { kind: 'site-holes' }> {
  const primitive = primitives.find((entry) => entry.kind === 'site-holes')
  if (!primitive || primitive.kind !== 'site-holes') {
    throw new Error('TIP 盒外形缺少 site-holes 图元')
  }
  return primitive
}

/** 创建 Backend 或 OS 投影使用的 TIP 盒物料聚合。 */
function tipBoxAggregate(
  id: string,
  sites: readonly MaterialSite[] = []
): MaterialAggregate {
  return materialAggregate(id, {
    sites,
    config: {
      rendering: {
        kind: 'tip_box',
        dimensionsMm: [86, 136, 128]
      }
    }
  })
}

/** 创建一个仅供直连 OS 权威投影使用的内部枪头点位。 */
function tipSpot(
  ownerMaterialId: string,
  key: string,
  positionMm: readonly [number, number, number]
): MaterialSite {
  return {
    id: `${ownerMaterialId}-${key}`,
    ownerMaterialId,
    key,
    name: key,
    anchor: { kind: 'root' },
    poseInAnchor: {
      positionMm,
      rotationDegXYZ: [0, 0, 0]
    },
    sizeMm: [14.7, 14.7, 23],
    capacity: 1,
    allowedTemplateIds: [],
    occupiedMaterialIds: [],
    kind: 'tip-spot',
    shape: 'rectangle',
    visible: true
  }
}

/** 统计不携带库位（Site）身份的声明式内部标记数量。 */
function markerCount(markup: string): number {
  return markup.match(/data-oblique-internal-marker/g)?.length ?? 0
}
