import { describe, expect, it } from 'vitest'

import type { MaterialAggregate } from '../types'
import { buildMaterialObliqueScene } from './projection'
import { parseShapeLibrary } from './shapeSpec'

describe('物料 2.5D 外形身份选择', () => {
  /** 验证复合快照身份优先于旧 rendering.kind，并区分不同 bundle 的同名外形。 */
  it('selects the exact bundle and id before legacy category matching', () => {
    const shapes = parseShapeLibrary([
      shape('legacy-bundle', 'shared-shape', ['custom'], 'box'),
      shape('snapshot-bundle', 'shared-shape', ['other'], 'lathe')
    ])
    const scene = buildMaterialObliqueScene([material()], shapes)
    const object = scene.objects[0]

    expect(object).toMatchObject({
      fidelity: 'declared',
      renderStyle: 'spec',
      shape: {
        bundle: 'snapshot-bundle',
        id: 'shared-shape'
      }
    })
    expect(object?.shape?.primitives.map((part) => part.kind)).toEqual([
      'lathe'
    ])
  })
})

/** 构造无业务 category、但带冻结 2.5D 外形身份的物料聚合。 */
function material(): MaterialAggregate {
  return {
    material: {
      id: 'material-bottle',
      sourceTemplateId: 'template-bottle',
      code: '',
      name: '100 mL 试剂瓶',
      config: {
        rendering: {
          kind: 'custom',
          dimensionsMm: [56, 105, 56]
        }
      },
      createdAt: '2026-08-14T00:00:00Z',
      updatedAt: '2026-08-14T00:00:00Z'
    },
    placement: {
      kind: 'world',
      pose: {
        positionMm: [0, 0, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    },
    sites: [],
    revision: 1,
    shapeIdentity: {
      bundle: 'snapshot-bundle',
      id: 'shared-shape'
    }
  }
}

/**
 * 构造一个目录外形，测试只关心复合身份与图元类型。
 *
 * @param bundle 设备包稳定身份。
 * @param id 包内外形稳定身份。
 * @param categories 旧分类匹配集合。
 * @param primitive 用于区分命中结果的图元类型。
 * @returns 与 `/api/v1/material-shapes` 同构的外形对象。
 */
function shape(
  bundle: string,
  id: string,
  categories: readonly string[],
  primitive: 'box' | 'lathe'
): Record<string, unknown> {
  return {
    bundle,
    id,
    categories,
    categoryTokens: [],
    priority: 0,
    units: primitive === 'lathe' ? 'ratio' : 'mm',
    shadow: primitive === 'lathe' ? 'round' : 'box',
    sort: 'center',
    parts:
      primitive === 'lathe'
        ? [
            {
              type: 'lathe',
              style: 'glass',
              center: [0.5, 0.5],
              d: 0.9,
              z: [0, 1],
              rings: [
                { z: 0, r: 0.9 },
                { z: 1, r: 0.7 }
              ]
            }
          ]
        : [
            {
              type: 'box',
              style: 'body',
              from: [0, 0, 0],
              to: [1, 1, 1]
            }
          ]
  }
}
