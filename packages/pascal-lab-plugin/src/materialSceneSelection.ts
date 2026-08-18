import type { SceneGraph } from '@unilab/pascal-host'

import { isLabDeviceNode, isLabTableNode } from './schema'

/**
 * 为 Pascal 场景构建物料（Material）到场景对象的稳定选择索引。
 *
 * @param scene 当前物料场景图；只读取设备与工作台节点。
 * @returns 以物料 ID 为键、Pascal 场景对象 ID 为值的索引。
 * @throws 不主动抛错；非物料场景节点会被忽略。
 * @safety 索引是只读投影，不修改场景或物料选中状态。
 */
export function indexMaterialSceneObjects(
  scene: Pick<SceneGraph, 'nodes'>
): Map<string, string> {
  const index = new Map<string, string>()
  for (const node of Object.values(scene.nodes)) {
    if (isLabDeviceNode(node) || isLabTableNode(node)) {
      index.set(node.materialNodeId, node.id)
    }
  }
  return index
}

/**
 * 用已构建索引把物料（Material）选择投影为 Pascal 场景选择。
 *
 * @param index 当前场景的物料到场景对象索引。
 * @param materialIds 调用方按稳定顺序提供的物料 ID。
 * @returns 保留输入顺序且已忽略失效身份的 Pascal 场景 ID。
 * @throws 不主动抛错；索引中不存在的物料按失效选择处理。
 * @safety 查找复杂度只与选中 ID 数量相关，不扫描整个 3D 场景。
 */
export function materialIdsToSceneObjectIds(
  index: ReadonlyMap<string, string>,
  materialIds: readonly string[]
): string[] {
  return materialIds.flatMap((materialId) => {
    const sceneObjectId = index.get(materialId)
    return sceneObjectId ? [sceneObjectId] : []
  })
}
