import { createStore, type StoreApi } from 'zustand/vanilla'

import { buildMaterialGraphIndex, assertValidMaterialGraph } from './rules'
import {
  authoringSnapshot,
  createMaterialHistory,
  emptyAuthoringSnapshot
} from './undo'
import type { MaterialShapeLibrary } from './oblique/shapeSpec'
import type {
  AttachMaterialCommand,
  CreateMaterialInput,
  CreateMaterialResult,
  DetachMaterialCommand,
  LabPose,
  MaterialAggregate,
  MaterialEdgeOperation,
  MaterialGraphIndex,
  MaterialId,
  MaterialMutationResult,
  MaterialPlacement,
  MaterialStoreDependencies,
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

const EMPTY_INDEX: MaterialGraphIndex = {
  childrenByParentId: {},
  siteOwnerById: {}
}

export function createMaterialStore(
  dependencies: MaterialStoreDependencies
): MaterialStore {
  const history = createMaterialHistory()
  let commandSequence = 0
  let graphRevision = 0

  const nextCommandId = (kind: PendingMaterialCommand['kind']): string => {
    commandSequence += 1
    return `${kind}-${commandSequence}`
  }

  const store = createStore<MaterialStoreState>((set, get) => {
    const begin = (
      kind: PendingMaterialCommand['kind'],
      materialIds: readonly MaterialId[]
    ): string => {
      const id = nextCommandId(kind)
      set((state) => ({
        pendingCommandsById: {
          ...state.pendingCommandsById,
          [id]: { id, kind, materialIds }
        },
        error: null
      }))
      return id
    }

    const finish = (id: string): void => {
      set((state) => {
        const next = { ...state.pendingCommandsById }
        delete next[id]
        return { pendingCommandsById: next }
      })
    }

    const fail = (id: string, error: unknown): never => {
      finish(id)
      set({ error: errorMessage(error) })
      throw error
    }

    const applyAggregates = (
      aggregates: readonly MaterialAggregate[],
      recordHistory = true
    ): void => {
      const next = { ...get().aggregatesById }
      for (const aggregate of aggregates) {
        next[aggregate.material.id] = structuredClone(aggregate)
      }
      assertValidMaterialGraph(next)
      set({
        aggregatesById: next,
        graphIndex: buildMaterialGraphIndex(next)
      })
      if (recordHistory) history.record(authoringSnapshot(next))
    }

    return {
      aggregatesById: {},
      graphIndex: EMPTY_INDEX,
      edgeOperationsById: {},
      pendingCommandsById: {},
      dragPreviewByMaterialId: {},
      creationOperationByMaterialId: {},
      loadState: 'idle',
      error: null,
      shapeLibrary: [],

      loadGraph: async () => {
        if (
          get().loadState === 'loading' ||
          get().loadState === 'ready'
        ) {
          return
        }
        dependencies.requireCapability('material.readGraph')
        const commandId = begin('load', [])
        set({ loadState: 'loading' })
        try {
          const aggregates = await dependencies.graph.getGraph(
            dependencies.scope
          )
          const byId = Object.fromEntries(
            aggregates.map((aggregate) => [
              aggregate.material.id,
              structuredClone(aggregate)
            ])
          )
          assertValidMaterialGraph(byId)
          set({
            aggregatesById: byId,
            graphIndex: buildMaterialGraphIndex(byId),
            loadState: 'ready',
            error: null
          })
          graphRevision = aggregates[0]?.revision ?? 0
          history.reset(authoringSnapshot(byId))
          finish(commandId)
          // 外形只影响画法，取不到也不该让整张图加载失败。
          try {
            const shapeLibrary =
              (await dependencies.graph.getShapeLibrary?.()) ?? []
            if (shapeLibrary.length > 0) set({ shapeLibrary })
          } catch {
            set({ shapeLibrary: [] })
          }
        } catch (error) {
          set({ loadState: 'error' })
          fail(commandId, error)
        }
      },

      createMaterial: async (input) => {
        dependencies.requireCapability('material.create')
        const commandId = begin('create', [])
        try {
          const result = await dependencies.graph.createMaterial(
            dependencies.scope,
            {
              ...input,
              expectedRevision: graphRevision
            }
          )
          const primary = result.aggregates.find(
            (aggregate) =>
              aggregate.material.id === result.primaryMaterialId
          )
          if (!primary) {
            throw new Error(
              `Create result is missing primary Material ${result.primaryMaterialId}`
            )
          }
          applyAggregates(result.aggregates)
          graphRevision = primary.revision
          set((state) => ({
            creationOperationByMaterialId: {
              ...state.creationOperationByMaterialId,
              [primary.material.id]: result.creationOperationId
            }
          }))
          finish(commandId)
          return result
        } catch (error) {
          return fail(commandId, error)
        }
      },

      updateConfig: async (materialId, patch) => {
        dependencies.requireCapability('material.updateConfig')
        const aggregate = requireAggregate(get(), materialId)
        const commandId = begin('update-config', [materialId])
        try {
          const result = await dependencies.graph.updateConfig({
            materialId,
            expectedRevision: aggregate.revision,
            patch
          })
          applyAggregates([result])
          finish(commandId)
          return result
        } catch (error) {
          return fail(commandId, error)
        }
      },

      move: async (materialId, placement) => {
        dependencies.requireCapability('material.move')
        const aggregate = requireAggregate(get(), materialId)
        const commandId = begin('move', [materialId])
        try {
          const result = await dependencies.graph.move({
            materialId,
            expectedRevision: aggregate.revision,
            idempotencyKey:
              dependencies.createIdempotencyKey?.() ??
              `material-${Date.now()}-${commandId}`,
            placement
          })
          applyAggregates([result])
          finish(commandId)
          return result
        } catch (error) {
          return fail(commandId, error)
        } finally {
          get().clearDragPreview(materialId)
        }
      },

      attach: async (parentId, childId, siteId) => {
        dependencies.requireCapability('material.attach')
        const parent = requireAggregate(get(), parentId)
        const child = requireAggregate(get(), childId)
        const command: AttachMaterialCommand = {
          parentId,
          childId,
          siteId,
          expectedParentRevision: parent.revision,
          expectedChildRevision: child.revision
        }
        const commandId = begin('attach', [parentId, childId])
        try {
          const result = await dependencies.graph.attach(command)
          applyAggregates(result.aggregates)
          finish(commandId)
          return result
        } catch (error) {
          return fail(commandId, error)
        }
      },

      detach: async (childId) => {
        dependencies.requireCapability('material.detach')
        const child = requireAggregate(get(), childId)
        const parentId =
          child.placement.kind === 'parent' ||
          child.placement.kind === 'site'
            ? child.placement.parentId
            : null
        if (!parentId) {
          throw new Error(`Material ${childId} is not attached`)
        }
        const parent = requireAggregate(get(), parentId)
        const command: DetachMaterialCommand = {
          parentId,
          childId,
          expectedParentRevision: parent.revision,
          expectedChildRevision: child.revision
        }
        const commandId = begin('detach', [parentId, childId])
        try {
          const result = await dependencies.graph.detach(command)
          applyAggregates(result.aggregates)
          finish(commandId)
          return result
        } catch (error) {
          return fail(commandId, error)
        }
      },

      updateSite: async (materialId, siteId, patch) => {
        dependencies.requireCapability('material.updateSite')
        const aggregate = requireAggregate(get(), materialId)
        const commandId = begin('update-site', [materialId])
        try {
          const result = await dependencies.graph.updateSite({
            materialId,
            siteId,
            expectedRevision: aggregate.revision,
            patch
          })
          applyAggregates([result])
          finish(commandId)
          return result
        } catch (error) {
          return fail(commandId, error)
        }
      },

      setDragPreview: (materialId, pose) => {
        set((state) => ({
          dragPreviewByMaterialId: {
            ...state.dragPreviewByMaterialId,
            [materialId]: structuredClone(pose)
          }
        }))
      },

      clearDragPreview: (materialId) => {
        set((state) => {
          const next = { ...state.dragPreviewByMaterialId }
          delete next[materialId]
          return { dragPreviewByMaterialId: next }
        })
      },

      undo: async () => {
        dependencies.requireCapability('material.persistentUndo')
        throw new Error(
          'Persistent undo command synthesis is disabled until the Server contract is available'
        )
      },

      redo: async () => {
        dependencies.requireCapability('material.persistentUndo')
        throw new Error(
          'Persistent redo command synthesis is disabled until the Server contract is available'
        )
      },

      canUndo: () => history.canUndo(),
      canRedo: () => history.canRedo(),
      clearHistory: () => history.clear(),

      reset: () => {
        graphRevision = 0
        set({
          aggregatesById: {},
          graphIndex: EMPTY_INDEX,
          edgeOperationsById: {},
          pendingCommandsById: {},
          dragPreviewByMaterialId: {},
          creationOperationByMaterialId: {},
          loadState: 'idle',
          error: null
        })
        history.reset(emptyAuthoringSnapshot())
      }
    }
  })

  return store
}

function requireAggregate(
  state: MaterialStoreState,
  materialId: MaterialId
): MaterialAggregate {
  const aggregate = state.aggregatesById[materialId]
  if (!aggregate) throw new Error(`Unknown Material: ${materialId}`)
  return aggregate
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Material operation failed'
}
