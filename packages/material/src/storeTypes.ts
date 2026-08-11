import type { StoreApi } from 'zustand/vanilla'

import type { MaterialShapeLibrary } from './oblique/shapeSpec'
import type {
  CreateMaterialInput,
  CreateMaterialResult,
  DeleteMaterialSubtreeResult,
  LabPose,
  MaterialAggregate,
  MaterialEdgeOperation,
  MaterialGraphIndex,
  MaterialId,
  MaterialMovedEvent,
  MaterialMutationResult,
  MaterialPlacement,
  SiteId,
  UpdateMaterialConfigCommand,
  UpdateMaterialSiteCommand
} from './types'

export type MaterialLoadState = 'idle' | 'loading' | 'ready' | 'error'

export interface PendingMaterialCommand {
  id: string
  kind:
    | 'load'
    | 'create'
    | 'update-config'
    | 'move'
    | 'attach'
    | 'detach'
    | 'update-site'
    | 'delete-subtree'
    | 'undo'
    | 'redo'
  materialIds: readonly MaterialId[]
}

export interface MaterialStoreState {
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
  graphIndex: MaterialGraphIndex
  edgeOperationsById: Readonly<Record<string, MaterialEdgeOperation>>
  pendingCommandsById: Readonly<Record<string, PendingMaterialCommand>>
  dragPreviewByMaterialId: Readonly<Record<MaterialId, LabPose>>
  creationOperationByMaterialId: Readonly<Record<MaterialId, string>>
  loadState: MaterialLoadState
  error: string | null
  /** 设备包声明的 2.5D 外形；后端不提供时为空表，视图退回实心包围盒。 */
  shapeLibrary: MaterialShapeLibrary

  loadGraph: () => Promise<void>
  /** 将一条服务端物料移动事件增量投影到当前页面，不重新读取完整物料图。 */
  applyRemoteMove: (event: MaterialMovedEvent) => void
  createMaterial: (input: CreateMaterialInput) => Promise<CreateMaterialResult>
  updateConfig: (
    materialId: MaterialId,
    patch: UpdateMaterialConfigCommand['patch']
  ) => Promise<MaterialAggregate>
  move: (
    materialId: MaterialId,
    placement: MaterialPlacement
  ) => Promise<MaterialAggregate>
  attach: (
    parentId: MaterialId,
    childId: MaterialId,
    siteId?: SiteId
  ) => Promise<MaterialMutationResult>
  detach: (childId: MaterialId) => Promise<MaterialMutationResult>
  updateSite: (
    materialId: MaterialId,
    siteId: SiteId,
    patch: UpdateMaterialSiteCommand['patch']
  ) => Promise<MaterialAggregate>
  deleteSubtree: (
    materialId: MaterialId
  ) => Promise<DeleteMaterialSubtreeResult>
  setDragPreview: (materialId: MaterialId, pose: LabPose) => void
  clearDragPreview: (materialId: MaterialId) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: () => boolean
  canRedo: () => boolean
  clearHistory: () => void
  reset: () => void
}

export type MaterialStore = StoreApi<MaterialStoreState>
