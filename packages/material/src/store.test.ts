import { describe, expect, it, vi } from 'vitest'

import { createMaterialStore } from './store'
import {
  materialAggregate,
  materialGraphPort
} from './testFixtures'
import type { MaterialCapability } from './types'

describe('material store', () => {
  it('loads authoritative aggregates and derives graph indexes', async () => {
    const parent = materialAggregate('parent')
    const child = materialAggregate('child', {
      placement: {
        kind: 'parent',
        parentId: 'parent',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [10, 20, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({
        getGraph: async () => [parent, child]
      }),
      requireCapability: allowCapabilities('material.readGraph')
    })

    await store.getState().loadGraph()

    expect(store.getState()).toMatchObject({
      loadState: 'ready',
      graphIndex: {
        childrenByParentId: { parent: ['child'] }
      }
    })
    expect(Object.keys(store.getState().aggregatesById)).toEqual([
      'parent',
      'child'
    ])
    expect(store.getState().canUndo()).toBe(false)
  })

  it('does not add drag previews to zundo history', async () => {
    const initial = materialAggregate('robot')
    const moved = materialAggregate('robot', {
      revision: 2,
      placement: {
        kind: 'world',
        pose: {
          positionMm: [100, 200, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const move = vi.fn(async () => moved)
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({
        getGraph: async () => [initial],
        move
      }),
      requireCapability: allowCapabilities(
        'material.readGraph',
        'material.move'
      ),
      createIdempotencyKey: () => 'move-robot-1'
    })
    await store.getState().loadGraph()

    store.getState().setDragPreview('robot', {
      positionMm: [50, 60, 0],
      rotationDegXYZ: [0, 0, 0]
    })
    expect(store.getState().canUndo()).toBe(false)

    await store.getState().move('robot', moved.placement)
    expect(move).toHaveBeenCalledWith({
      materialId: 'robot',
      expectedRevision: 1,
      idempotencyKey: 'move-robot-1',
      placement: moved.placement
    })
    expect(store.getState().canUndo()).toBe(true)
    expect(store.getState().dragPreviewByMaterialId.robot).toBeUndefined()
    expect(store.getState().aggregatesById.robot.revision).toBe(2)
  })

  it('applies a composite create result as one authoritative subtree', async () => {
    const plate = materialAggregate('plate')
    const well = materialAggregate('well-a1', {
      component: {
        kind: 'well',
        key: 'A1',
        managedByParent: true
      },
      placement: {
        kind: 'parent',
        parentId: 'plate',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [10, 10, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const createMaterial = vi.fn(async () => ({
      aggregates: [plate, well],
      primaryMaterialId: 'plate',
      creationOperationId: 'create-plate-1',
      edgeSyncState: 'not-required' as const
    }))
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({ createMaterial }),
      requireCapability: allowCapabilities('material.create')
    })
    const input = {
      templateId: 'template-plate',
      name: 'Plate',
      placement: { kind: 'unplaced' as const },
      initialContents: []
    }

    await store.getState().createMaterial(input)

    expect(createMaterial).toHaveBeenCalledWith(
      { kind: 'singleton' },
      { ...input, expectedRevision: 0 }
    )
    expect(Object.keys(store.getState().aggregatesById)).toEqual([
      'plate',
      'well-a1'
    ])
    expect(store.getState().graphIndex.childrenByParentId).toEqual({
      plate: ['well-a1']
    })
    expect(
      store.getState().creationOperationByMaterialId
    ).toEqual({
      plate: 'create-plate-1'
    })
    expect(store.getState().canUndo()).toBe(true)
  })

  it('keeps the drag preview until a move settles and rolls it back on failure', async () => {
    const initial = materialAggregate('robot')
    let rejectMove: ((reason: Error) => void) | undefined
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({
        getGraph: async () => [initial],
        move: () =>
          new Promise((_, reject) => {
            rejectMove = reject
          })
      }),
      requireCapability: allowCapabilities(
        'material.readGraph',
        'material.move'
      ),
      createIdempotencyKey: () => 'move-robot-failure'
    })
    await store.getState().loadGraph()
    store.getState().setDragPreview('robot', {
      positionMm: [50, 60, 0],
      rotationDegXYZ: [0, 0, 0]
    })

    const movement = store.getState().move('robot', initial.placement)
    expect(store.getState().dragPreviewByMaterialId.robot).toBeDefined()

    rejectMove?.(new Error('revision conflict'))
    await expect(movement).rejects.toThrow('revision conflict')

    expect(store.getState().dragPreviewByMaterialId.robot).toBeUndefined()
    expect(store.getState().aggregatesById.robot.revision).toBe(1)
    expect(store.getState().error).toBe('revision conflict')
  })

  it('checks capability before invoking the port', async () => {
    const getGraph = vi.fn()
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({ getGraph }),
      requireCapability: () => {
        throw new Error('unsupported')
      }
    })

    await expect(store.getState().loadGraph()).rejects.toThrow('unsupported')
    expect(getGraph).not.toHaveBeenCalled()
  })

  it('coalesces concurrent graph loads from 2D and 3D panels', async () => {
    let resolveGraph:
      | ((aggregates: readonly ReturnType<typeof materialAggregate>[]) => void)
      | undefined
    const getGraph = vi.fn(
      () =>
        new Promise<readonly ReturnType<typeof materialAggregate>[]>(
          (resolve) => {
            resolveGraph = resolve
          }
        )
    )
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({ getGraph }),
      requireCapability: allowCapabilities('material.readGraph')
    })

    const first = store.getState().loadGraph()
    const second = store.getState().loadGraph()
    expect(getGraph).toHaveBeenCalledTimes(1)
    resolveGraph?.([materialAggregate('robot')])
    await Promise.all([first, second])

    expect(store.getState().loadState).toBe('ready')
  })

  it('projects one SSE material move without reloading the full graph', async () => {
    const source = materialAggregate('warehouse-1', {
      sites: [materialSite('source-site', 'warehouse-1', 'L1B1', ['vessel'])]
    })
    const target = materialAggregate('station-7', {
      sites: [materialSite('target-site', 'station-7', 'S0721')]
    })
    const vessel = materialAggregate('vessel', {
      placement: {
        kind: 'site',
        parentId: 'warehouse-1',
        siteId: 'source-site',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const getGraph = vi.fn(async () => [source, target, vessel])
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({ getGraph }),
      requireCapability: allowCapabilities('material.readGraph')
    })
    await store.getState().loadGraph()

    store.getState().applyRemoteMove({
      id: '42',
      materialId: 'vessel',
      fromParentId: 'warehouse-1',
      fromSite: 'L1B1',
      toParentId: 'station-7',
      toSite: 'S0721'
    })

    expect(getGraph).toHaveBeenCalledTimes(1)
    expect(store.getState().aggregatesById.vessel.placement).toEqual({
      kind: 'site',
      parentId: 'station-7',
      siteId: 'target-site',
      offsetPose: {
        positionMm: [0, 0, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    })
    expect(
      store.getState().aggregatesById['warehouse-1'].sites[0]
        .occupiedMaterialIds
    ).toEqual([])
    expect(
      store.getState().aggregatesById['station-7'].sites[0]
        .occupiedMaterialIds
    ).toEqual(['vessel'])
  })

  /** 证明删除仅在物料权威确认后原子移除子树并更新父库位占用。 */
  it('applies an authoritative subtree deletion without leaving dangling occupancy', async () => {
    const parent = materialAggregate('warehouse', {
      sites: [materialSite('site-a', 'warehouse', 'A1', ['sample'])]
    })
    const child = materialAggregate('sample', {
      placement: {
        kind: 'site',
        parentId: 'warehouse',
        siteId: 'site-a',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const updatedParent = materialAggregate('warehouse', {
      revision: 2,
      sites: [materialSite('site-a', 'warehouse', 'A1')]
    })
    const deleteSubtree = vi.fn(async () => ({
      deletedMaterialIds: ['sample'],
      aggregates: [updatedParent]
    }))
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({
        getGraph: async () => [parent, child],
        deleteSubtree
      }),
      requireCapability: allowCapabilities(
        'material.readGraph',
        'material.deleteSubtrees'
      ),
      createIdempotencyKey: () => 'delete-sample-1'
    })
    await store.getState().loadGraph()

    await store.getState().deleteSubtree('sample')

    expect(deleteSubtree).toHaveBeenCalledWith({
      materialId: 'sample',
      expectedRevision: 1,
      idempotencyKey: 'delete-sample-1'
    })
    expect(store.getState().aggregatesById.sample).toBeUndefined()
    expect(
      store.getState().aggregatesById.warehouse.sites[0]
        .occupiedMaterialIds
    ).toEqual([])
    expect(store.getState().canUndo()).toBe(true)
  })

  it('resets graph, previews and temporal history together', async () => {
    const initial = materialAggregate('robot')
    const moved = materialAggregate('robot', { revision: 2 })
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({
        getGraph: async () => [initial],
        move: async () => moved
      }),
      requireCapability: allowCapabilities(
        'material.readGraph',
        'material.move'
      )
    })
    await store.getState().loadGraph()
    await store.getState().move('robot', moved.placement)
    store.getState().setDragPreview('robot', {
      positionMm: [1, 2, 3],
      rotationDegXYZ: [0, 0, 0]
    })

    store.getState().reset()

    expect(store.getState()).toMatchObject({
      aggregatesById: {},
      dragPreviewByMaterialId: {},
      loadState: 'idle'
    })
    expect(store.getState().canUndo()).toBe(false)
  })
})

function allowCapabilities(
  ...allowed: readonly MaterialCapability[]
): (capability: MaterialCapability) => void {
  const set = new Set(allowed)
  return (capability) => {
    if (!set.has(capability)) {
      throw new Error(`Unsupported capability: ${capability}`)
    }
  }
}

function materialSite(
  id: string,
  ownerMaterialId: string,
  name: string,
  occupiedMaterialIds: readonly string[] = []
) {
  return {
    id,
    ownerMaterialId,
    key: name,
    name,
    anchor: { kind: 'root' as const },
    poseInAnchor: {
      positionMm: [0, 0, 0] as const,
      rotationDegXYZ: [0, 0, 0] as const
    },
    sizeMm: [10, 10, 10] as const,
    capacity: 1,
    allowedTemplateIds: [],
    occupiedMaterialIds,
    visual: {
      state: occupiedMaterialIds.length > 0
        ? 'occupied' as const
        : 'empty' as const,
      fillFraction: occupiedMaterialIds.length > 0 ? 1 : 0
    }
  }
}
