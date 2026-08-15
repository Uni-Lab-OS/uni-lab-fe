import { useViewer } from '@pascal-app/viewer'

export interface MaterialSceneRuntimeState {
  geometryRevision: number
  modelFailures: Record<string, string>
}

/** 读取同一 Pascal viewer 的加载状态，供附着截图等待稳定帧。 */
export function readMaterialSceneRuntimeState(): MaterialSceneRuntimeState {
  const viewer = useViewer.getState()
  return {
    geometryRevision: viewer.geometryRevision,
    modelFailures: { ...viewer.itemLoadFailures }
  }
}
