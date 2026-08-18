import type { SceneGraph } from '@unilab/pascal-host'
import { describe, expect, it, vi } from 'vitest'

import {
  indexMaterialSceneObjects,
  materialIdsToSceneObjectIds
} from './materialSceneSelection'

describe('Pascal material selection index', () => {
  /**
   * 验证场景身份只索引一次，之后每次点击按选中数量查找。
   *
   * @returns 无返回值；断言万节点场景中单选只调用一次 Map.get。
   * @throws 选择热路径退回全场景扫描时由 Vitest 抛出。
   * @safety 仅构造内存场景，不加载 3D 资产或修改物料（Material）。
   */
  it('resolves a body click in O(selected ids) after one scene index pass', () => {
    const nodes = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [
      `lab-material-${i}`,
      {
        id: `lab-material-${i}`,
        type: 'lab-device',
        materialNodeId: `material-${i}`
      }
    ])) as SceneGraph['nodes']
    const index = indexMaterialSceneObjects({ nodes } as SceneGraph)
    const get = vi.spyOn(index, 'get')

    expect(materialIdsToSceneObjectIds(index, ['material-9999'])).toEqual([
      'lab-material-9999'
    ])
    expect(get).toHaveBeenCalledTimes(1)
  })

  /**
   * 验证选择投影保留调用方顺序并忽略失效身份。
   *
   * @returns 无返回值；断言返回的 Pascal 场景 ID 顺序。
   * @throws 映射丢失顺序或暴露空值时由 Vitest 抛出。
   * @safety 纯内存映射，不改变视图选中状态。
   */
  it('keeps requested order and ignores stale material ids', () => {
    const index = new Map([
      ['material-a', 'lab-a'],
      ['material-b', 'lab-b']
    ])

    expect(materialIdsToSceneObjectIds(index, [
      'material-b',
      'missing',
      'material-a'
    ])).toEqual(['lab-b', 'lab-a'])
  })
})
