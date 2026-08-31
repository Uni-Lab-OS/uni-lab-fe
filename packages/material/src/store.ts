import { createStore, type StoreApi } from 'zustand/vanilla'

import {
  assertCanAttach,
  buildMaterialGraphIndex,
  assertValidMaterialGraph,
  MaterialRuleError
} from './rules'
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
  MaterialMovedEvent,
  MaterialMutationResult,
  MaterialPlacement,
  MaterialStoreDependencies,
  SiteId,
  UpdateMaterialConfigCommand,
  UpdateMaterialSiteCommand
} from './types'

import type {
  MaterialStore,
  MaterialStoreState,
  PendingMaterialCommand
} from './storeTypes'

export type {
  MaterialLoadState,
  MaterialShapeLibraryState,
  MaterialStore,
  MaterialStoreState,
  PendingMaterialCommand
} from './storeTypes'

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
      shapeLibrary: [], shapeLibraryState: 'idle',

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
            error: null,
            shapeLibrary: [], shapeLibraryState: 'loading'
          })
          graphRevision = aggregates[0]?.revision ?? 0
          history.reset(authoringSnapshot(byId))
          finish(commandId)
          // 外形只影响画法，取不到也不该让整张图加载失败。
          try {
            const shapeLibrary =
              (await dependencies.graph.getShapeLibrary?.()) ?? []
            set({ shapeLibrary, shapeLibraryState: shapeLibrary.length > 0
              ? 'ready'
              : 'unavailable' })
          } catch {
            set({ shapeLibrary: [], shapeLibraryState: 'unavailable' })
          }
        } catch (error) {
          set({ loadState: 'error' })
          fail(commandId, error)
        }
      },

      applyRemoteMove: (event) => {
        const current = get().aggregatesById
        const moving = current[event.materialId]
        if (!moving) {
          throw new MaterialRuleError(
            'MATERIAL_MOVE_SOURCE_MISSING',
            `Unknown moved Material: ${event.materialId}`
          )
        }
        const targetParent = current[event.toParentId]
        if (!targetParent) {
          throw new MaterialRuleError(
            'MATERIAL_MOVE_TARGET_MISSING',
            `Unknown target Material: ${event.toParentId}`
          )
        }

        const next = Object.fromEntries(
          Object.entries(current).map(([id, aggregate]) => [
            id,
            structuredClone(aggregate)
          ])
        ) as Record<MaterialId, MaterialAggregate>
        const nextMoving = next[event.materialId]
        const nextTarget = next[event.toParentId]
        const targetSite = event.toSite
          ? nextTarget.sites.find(
              (site) =>
                site.id === event.toSite ||
                site.key === event.toSite ||
                site.name === event.toSite
            )
          : undefined
        if (event.toSite && !targetSite) {
          throw new MaterialRuleError(
            'MATERIAL_MOVE_TARGET_SITE_MISSING',
            `Target Site ${event.toSite} does not belong to ${event.toParentId}`
          )
        }

        for (const aggregate of Object.values(next)) {
          aggregate.sites = aggregate.sites.map((site) => {
            const occupiedMaterialIds = site.occupiedMaterialIds.filter(
              (materialId) => materialId !== event.materialId
            )
            return occupiedMaterialIds.length === site.occupiedMaterialIds.length
              ? site
              : withSiteOccupancy(site, occupiedMaterialIds)
          })
        }

        if (targetSite) {
          const refreshedTargetSite = nextTarget.sites.find(
            (site) => site.id === targetSite.id
          )
          if (!refreshedTargetSite) {
            throw new MaterialRuleError(
              'MATERIAL_MOVE_TARGET_SITE_MISSING',
              `Target Site ${targetSite.id} does not belong to ${event.toParentId}`
            )
          }
          nextTarget.sites = nextTarget.sites.map((site) =>
            site.id === refreshedTargetSite.id
              ? withSiteOccupancy(site, [
                  ...site.occupiedMaterialIds,
                  event.materialId
                ])
              : site
          )
          nextMoving.placement = {
            kind: 'site',
            parentId: event.toParentId,
            siteId: refreshedTargetSite.id,
            offsetPose: zeroPose()
          }
        } else {
          nextMoving.placement = {
            kind: 'parent',
            parentId: event.toParentId,
            anchor: { kind: 'root' },
            localPose: zeroPose()
          }
        }
        nextMoving.revision = event.revision ?? nextMoving.revision + 1

        assertValidMaterialGraph(next)
        set({
          aggregatesById: next,
          graphIndex: buildMaterialGraphIndex(next)
        })
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
        assertCanAttach(parent, child, siteId, get().aggregatesById)
        const command: AttachMaterialCommand = {
          parentId,
          childId,
          siteId,
          expectedParentRevision: parent.revision,
          expectedChildRevision: child.revision,
          idempotencyKey:
            dependencies.createIdempotencyKey?.() ??
            `material-attach-${Date.now()}-${childId}`
        }
        const sourceParentId =
          child.placement.kind === 'parent' ||
          child.placement.kind === 'site'
            ? child.placement.parentId
            : null
        const commandId = begin(
          'attach',
          [...new Set([
            parentId,
            childId,
            ...(sourceParentId ? [sourceParentId] : [])
          ])]
        )
        try {
          const result = await dependencies.graph.attach(command)
          applyAggregates(result.aggregates)
          finish(commandId)
          return result
        } catch (error) {
          return fail(commandId, error)
        } finally {
          get().clearDragPreview(childId)
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
          expectedChildRevision: child.revision,
          idempotencyKey:
            dependencies.createIdempotencyKey?.() ??
            `material-detach-${Date.now()}-${childId}`
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
          error: null,
          shapeLibrary: [], shapeLibraryState: 'idle'
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

/** 生成远端转运默认的零偏移位姿。 */
function zeroPose(): LabPose {
  return {
    positionMm: [0, 0, 0],
    rotationDegXYZ: [0, 0, 0]
  }
}
/** 同步库位占用及其可选的视觉状态。 */
function withSiteOccupancy(
  site: MaterialAggregate['sites'][number],
  occupiedMaterialIds: readonly MaterialId[]
): MaterialAggregate['sites'][number] {
  const occupied = occupiedMaterialIds.length > 0
  return {
    ...site,
    occupiedMaterialIds,
    visual: site.visual
      ? {
          state: occupied ? 'occupied' : 'empty',
          fillFraction: occupied ? 1 : 0
        }
      : undefined
  }
}
