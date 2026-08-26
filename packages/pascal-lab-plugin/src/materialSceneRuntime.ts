import { sceneRegistry } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type Object3D, Quaternion, Vector3 } from 'three'

export const MATERIAL_SCENE_INSPECTION_REQUEST =
  'unilab:material-scene-runtime-inspection-request'
export const MATERIAL_SCENE_INSPECTION_RESPONSE =
  'unilab:material-scene-runtime-inspection-response'

export interface MaterialSceneRuntimeState {
  geometryRevision: number
  modelFailures: Record<string, string>
}

export interface MaterialSceneRuntimeNodeState {
  nodeId: string
  parentName: string | null
  meshCount: number
  geometryTypes: string[]
  worldPositionM: [number, number, number]
  worldOrientationXyzw: [number, number, number, number]
}

/** 读取同一 Pascal viewer 的加载状态，供附着截图等待稳定帧。 */
export function readMaterialSceneRuntimeState(): MaterialSceneRuntimeState {
  const viewer = useViewer.getState()
  return {
    geometryRevision: viewer.geometryRevision,
    modelFailures: { ...viewer.itemLoadFailures }
  }
}

/** 从 Pascal 唯一 Three scene 读取一个节点的真实世界变换，不创建第二份场景。 */
export function inspectMaterialSceneObject(
  nodeId: string,
  object: Object3D
): MaterialSceneRuntimeNodeState {
  object.updateWorldMatrix(true, true)
  const position = object.getWorldPosition(new Vector3())
  const orientation = object.getWorldQuaternion(new Quaternion())
  const geometryTypes = new Set<string>()
  let meshCount = 0
  object.traverse(candidate => {
    const mesh = candidate as Object3D & {
      isMesh?: boolean
      geometry?: { type?: string }
    }
    if (mesh.isMesh !== true) return
    meshCount += 1
    geometryTypes.add(mesh.geometry?.type || 'UnknownGeometry')
  })
  return {
    nodeId,
    parentName: object.parent?.name || null,
    meshCount,
    geometryTypes: [...geometryTypes].sort(),
    worldPositionM: [position.x, position.y, position.z],
    worldOrientationXyzw: [
      orientation.x,
      orientation.y,
      orientation.z,
      orientation.w
    ]
  }
}

/**
 * 安装只读浏览器验收接缝。请求方只提供场景节点 ID，响应直接来自 Pascal 的
 * ``sceneRegistry``，因此可证明关节帧和附着重挂后的真实 Three 世界坐标。
 */
export function installMaterialSceneRuntimeInspection(): () => void {
  if (typeof window === 'undefined') return () => undefined
  if (
    new URLSearchParams(window.location.search).get(
      'unilabSceneInspection'
    ) !== '1'
  ) {
    return () => undefined
  }
  const inspect = (rawEvent: Event): void => {
    const detail = (rawEvent as CustomEvent<{
      requestId?: unknown
      nodeIds?: unknown
    }>).detail
    if (
      typeof detail?.requestId !== 'string' ||
      detail.requestId.length === 0 ||
      !Array.isArray(detail.nodeIds) ||
      detail.nodeIds.some(value => typeof value !== 'string')
    ) return
    const nodes = Object.fromEntries(detail.nodeIds.flatMap(nodeId => {
      const object = sceneRegistry.nodes.get(nodeId)
      return object ? [[nodeId, inspectMaterialSceneObject(nodeId, object)]] : []
    }))
    window.dispatchEvent(new CustomEvent(MATERIAL_SCENE_INSPECTION_RESPONSE, {
      detail: { requestId: detail.requestId, nodes }
    }))
  }
  window.addEventListener(MATERIAL_SCENE_INSPECTION_REQUEST, inspect)
  return () => window.removeEventListener(MATERIAL_SCENE_INSPECTION_REQUEST, inspect)
}
