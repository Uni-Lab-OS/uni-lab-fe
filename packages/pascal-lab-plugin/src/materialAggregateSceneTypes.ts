import type { MaterialId, MaterialPlacement, Vector3Tuple as MaterialVector3Tuple } from '@unilab/material/domain'
import type { LabAttachPoint } from './schema'
import type { SceneCameraView } from './sceneCameraRequest'
import type { Vector3Tuple } from './units'

export interface MaterialSceneMove {
  materialId: MaterialId
  placement: MaterialPlacement
}

export interface MaterialSceneProjectionOptions {
  fitSceneRevision?: number
  fitSceneView?: SceneCameraView
  showSites?: boolean
  showMaterialLabels?: boolean
  showMaterialTransfers?: boolean
  materialTransferRoutes?: readonly MaterialTransferSceneRoute[]
}

export interface MaterialTransferSceneEndpoint {
  ownerMaterialId: string
  /** `null` 表示路线连接仓库本体，而不是尚未分配的具体库位（Site）。 */
  siteKey: string | null
}

export interface MaterialTransferSceneRoute {
  id: string
  workflowNodeUuid: string
  label: string
  source: MaterialTransferSceneEndpoint
  target: MaterialTransferSceneEndpoint
  executorId: string
  materialRole?: string
  materialLineageKey?: string
  accent?: string
  status:
    | 'planned'
    | 'pending'
    | 'running'
    | 'canceling'
    | 'succeeded'
    | 'failed'
    | 'canceled'
    | 'attention'
  selected?: boolean
}

export interface MaterialRenderingSnapshot {
  kind: string
  dimensionsMm: MaterialVector3Tuple
  footprintMm: readonly [number, number]
  scale: MaterialVector3Tuple
  model: {
    path: string
    format?: string
    meshDir?: string
    macro?: string
    ossDir?: string
    version?: string
    type?: string
    color?: string
    position: Vector3Tuple
    rotation: Vector3Tuple
    attachPoints: readonly LabAttachPoint[]
    instances?: {
      path: string
      format: 'xacro' | 'urdf' | 'gltf' | 'stl' | 'fbx' | 'obj'
      color?: string
      position: Vector3Tuple
      rotation: Vector3Tuple
      items: readonly {
        id: string
        position: Vector3Tuple
        rotation: Vector3Tuple
      }[]
    }
  }
}
