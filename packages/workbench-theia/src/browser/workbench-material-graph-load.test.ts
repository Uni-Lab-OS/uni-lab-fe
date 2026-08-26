import type {
  MaterialGraphPort,
  MaterialMovedEvent,
  MaterialStore,
  MaterialStoreState
} from '@unilab/material'
import { describe, expect, it, vi } from 'vitest'

import { subscribeWorkbenchMaterialMoves } from './workbench-material-graph-load'

const MOVE: MaterialMovedEvent = {
  id: '48',
  materialId: 'material-1',
  revision: 3,
  fromParentId: 'robot-1',
  toParentId: 'warehouse-1',
  toSite: 'slot-1'
}

function subscriptionHarness(initialLoadState: MaterialStoreState['loadState']) {
  const applyRemoteMove = vi.fn()
  const reset = vi.fn()
  const loadGraph = vi.fn(async () => undefined)
  const disposeGraph = vi.fn()
  const disposeStore = vi.fn()
  let state = {
    loadState: initialLoadState,
    aggregatesById: { 'material-1': { revision: 2 } },
    applyRemoteMove,
    reset,
    loadGraph
  } as unknown as MaterialStoreState
  let moveListener: ((event: MaterialMovedEvent) => void) | undefined
  let storeListener:
    | ((state: MaterialStoreState, previous: MaterialStoreState) => void)
    | undefined
  let onResyncRequired: (() => void) | undefined
  const store = {
    getState: () => state,
    subscribe: vi.fn((listener) => {
      storeListener = listener
      return disposeStore
    })
  } as unknown as MaterialStore
  const graph = {
    subscribeMoves: vi.fn((next, options) => {
      moveListener = next
      onResyncRequired = options?.onResyncRequired
      return { dispose: disposeGraph }
    })
  } as Pick<MaterialGraphPort, 'subscribeMoves'>
  return {
    applyRemoteMove,
    disposeGraph,
    disposeStore,
    graph,
    loadGraph,
    move: (event = MOVE) => moveListener?.(event),
    ready: () => {
      const previous = state
      state = { ...state, loadState: 'ready' }
      storeListener?.(state, previous)
    },
    reset,
    resync: () => onResyncRequired?.(),
    setRevision: (revision: number) => {
      state = {
        ...state,
        aggregatesById: { 'material-1': { revision } }
      } as unknown as MaterialStoreState
    },
    store
  }
}

describe('subscribeWorkbenchMaterialMoves', () => {
  it('projects one authoritative move into the ready Workbench store', () => {
    const harness = subscriptionHarness('ready')
    const close = subscribeWorkbenchMaterialMoves(
      harness.store,
      harness.graph,
      true
    )

    harness.move()

    expect(harness.applyRemoteMove).toHaveBeenCalledWith(MOVE)
    close()
    expect(harness.disposeGraph).toHaveBeenCalledOnce()
    expect(harness.disposeStore).toHaveBeenCalledOnce()
  })

  it('buffers a move until the authoritative snapshot becomes ready', () => {
    const harness = subscriptionHarness('loading')
    subscribeWorkbenchMaterialMoves(harness.store, harness.graph, true)

    harness.move()
    expect(harness.applyRemoteMove).not.toHaveBeenCalled()

    harness.ready()
    expect(harness.applyRemoteMove).toHaveBeenCalledWith(MOVE)
  })

  it('skips a replay already represented by the authoritative revision', () => {
    const harness = subscriptionHarness('ready')
    harness.setRevision(3)
    subscribeWorkbenchMaterialMoves(harness.store, harness.graph, true)

    harness.move()

    expect(harness.applyRemoteMove).not.toHaveBeenCalled()
  })

  it('reloads the authoritative graph when the SSE connection reconnects', async () => {
    const harness = subscriptionHarness('ready')
    subscribeWorkbenchMaterialMoves(harness.store, harness.graph, true)

    harness.resync()
    await vi.waitFor(() => expect(harness.loadGraph).toHaveBeenCalledOnce())

    expect(harness.reset).toHaveBeenCalledOnce()
  })
})
