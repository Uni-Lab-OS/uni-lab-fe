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

  it('sends idempotent attach and detach commands with both aggregate revisions', async () => {
    const parent = materialAggregate('parent', {
      sites: [materialSite('site-1', 'parent', 'A1')]
    })
    const child = materialAggregate('child')
    const attachedParent = materialAggregate('parent', {
      revision: 2,
      sites: [materialSite('site-1', 'parent', 'A1', ['child'])]
    })
    const attachedChild = materialAggregate('child', {
      revision: 2,
      placement: {
        kind: 'site',
        parentId: 'parent',
        siteId: 'site-1',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const detachedParent = materialAggregate('parent', {
      revision: 3,
      sites: [materialSite('site-1', 'parent', 'A1')]
    })
    const detachedChild = materialAggregate('child', {
      revision: 3,
      placement: { kind: 'unplaced' }
    })
    const attach = vi.fn(async () => ({
      aggregates: [attachedParent, attachedChild]
    }))
    const detach = vi.fn(async () => ({
      aggregates: [detachedParent, detachedChild]
    }))
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({
        getGraph: async () => [parent, child],
        attach,
        detach
      }),
      requireCapability: allowCapabilities(
        'material.readGraph',
        'material.attach',
        'material.detach'
      ),
      createIdempotencyKey: () => 'relation-command-1'
    })
    await store.getState().loadGraph()

    await store.getState().attach('parent', 'child', 'site-1')
    expect(attach).toHaveBeenCalledWith({
      parentId: 'parent',
      childId: 'child',
      siteId: 'site-1',
      expectedParentRevision: 1,
      expectedChildRevision: 1,
      idempotencyKey: 'relation-command-1'
    })

    await store.getState().detach('child')
    expect(detach).toHaveBeenCalledWith({
      parentId: 'parent',
      childId: 'child',
      expectedParentRevision: 2,
      expectedChildRevision: 2,
      idempotencyKey: 'relation-command-1'
    })
    expect(store.getState().aggregatesById.child.placement).toEqual({
      kind: 'unplaced'
    })
  })

  it('applies a cross-parent site transfer without leaving source occupancy', async () => {
    const source = materialAggregate('source', {
      sites: [materialSite('source-site', 'source', 'A1', ['child'])]
    })
    const target = materialAggregate('target', {
      sites: [materialSite('target-site', 'target', 'B1')]
    })
    const child = materialAggregate('child', {
      placement: {
        kind: 'site',
        parentId: 'source',
        siteId: 'source-site',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const transferredSource = materialAggregate('source', {
      revision: 2,
      sites: [materialSite('source-site', 'source', 'A1')]
    })
    const transferredTarget = materialAggregate('target', {
      revision: 2,
      sites: [materialSite('target-site', 'target', 'B1', ['child'])]
    })
    const transferredChild = materialAggregate('child', {
      revision: 2,
      placement: {
        kind: 'site',
        parentId: 'target',
        siteId: 'target-site',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const attach = vi.fn(async () => ({
      aggregates: [transferredSource, transferredTarget, transferredChild]
    }))
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({
        getGraph: async () => [source, target, child],
        attach
      }),
      requireCapability: allowCapabilities(
        'material.readGraph',
        'material.attach'
      ),
      createIdempotencyKey: () => 'transfer-child-1'
    })
    await store.getState().loadGraph()

    await store.getState().attach('target', 'child', 'target-site')

    expect(store.getState().aggregatesById.source.sites[0].occupiedMaterialIds)
      .toEqual([])
    expect(store.getState().aggregatesById.target.sites[0].occupiedMaterialIds)
      .toEqual(['child'])
    expect(store.getState().aggregatesById.child.placement).toMatchObject({
      kind: 'site',
      parentId: 'target',
      siteId: 'target-site'
    })
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

  /** 证明外形声明缺失会形成明确降级状态，而不是假装仍在加载。 */
  it('records an unavailable shape library independently from the graph', async () => {
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort({
        getGraph: async () => [materialAggregate('robot')],
        getShapeLibrary: async () => []
      }),
      requireCapability: allowCapabilities('material.readGraph')
    })

    await store.getState().loadGraph()

    expect(store.getState()).toMatchObject({
      loadState: 'ready',
      shapeLibrary: [],
      shapeLibraryState: 'unavailable'
    })
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
      loadState: 'idle',
      shapeLibrary: [],
      shapeLibraryState: 'idle'
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
