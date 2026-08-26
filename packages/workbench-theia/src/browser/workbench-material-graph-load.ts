import type {
  MaterialGraphPort,
  MaterialLoadState,
  MaterialMovedEvent,
  MaterialStore
} from '@unilab/material'
import { useEffect, useRef } from 'react'

/**
 * 判断 Workbench 是否应读取物料图。
 *
 * 初始加载失败后允许一次有界恢复；第二次失败保留 store 的诊断并停止，避免持续性
 * 服务或数据错误触发请求循环。
 */
export function shouldLoadWorkbenchMaterialGraph(input: {
  available: boolean
  loadState: MaterialLoadState
  errorRecoveryAttempted: boolean
}): boolean {
  if (!input.available) return false
  if (input.loadState === 'idle') return true
  return input.loadState === 'error' && !input.errorRecoveryAttempted
}

/** 在 Workbench 物料域挂载期间协调初次加载与一次失败恢复。 */
export function useWorkbenchMaterialGraphLoad(
  store: MaterialStore,
  available: boolean,
  loadState: MaterialLoadState
): void {
  const errorRecoveryAttempted = useRef(false)

  useEffect(() => {
    if (loadState === 'idle') errorRecoveryAttempted.current = false
    if (!shouldLoadWorkbenchMaterialGraph({
      available,
      loadState,
      errorRecoveryAttempted: errorRecoveryAttempted.current
    })) return

    if (loadState === 'error') errorRecoveryAttempted.current = true
    void store.getState().loadGraph().catch(() => undefined)
  }, [available, loadState, store])
}

/**
 * 把 Backend 的权威物料父级/Site 变化接到 Workbench 唯一 Material store。
 *
 * 运行时附着只负责 Three 场景中的 tool0 跟随；pick/place 完成后的库存归属仍
 * 必须由 Material 事件更新 aggregate，不能从附着帧猜测目标库位。
 */
export function subscribeWorkbenchMaterialMoves(
  store: MaterialStore,
  graph: Pick<MaterialGraphPort, 'subscribeMoves'>,
  available: boolean,
  warn: (message: string, error: unknown) => void = console.warn
): () => void {
  if (!available || !graph.subscribeMoves) return () => undefined
  const pendingByMaterial = new Map<string, MaterialMovedEvent>()
  let disposed = false
  let resyncing = false

  const project = (event: MaterialMovedEvent): void => {
    const state = store.getState()
    const currentRevision = state.aggregatesById[event.materialId]?.revision
    if (
      event.revision != null &&
      currentRevision != null &&
      currentRevision >= event.revision
    ) return
    try {
      state.applyRemoteMove(event)
    } catch (error) {
      // 非法或与当前快照不相容的增量不能污染现有图；权威全量仍可在恢复时重读。
      warn('物料移动事件投影失败', error)
      resync()
    }
  }
  const flush = (): void => {
    if (store.getState().loadState !== 'ready') return
    const events = [...pendingByMaterial.values()]
    pendingByMaterial.clear()
    for (const event of events) project(event)
  }
  const resync = (): void => {
    if (disposed || resyncing) return
    resyncing = true
    store.getState().reset()
    void store.getState().loadGraph().finally(() => {
      resyncing = false
      flush()
    })
  }
  const unsubscribeStore = store.subscribe((state, previous) => {
    if (state.loadState === 'ready' && previous.loadState !== 'ready') flush()
  })
  const subscription = graph.subscribeMoves((event: MaterialMovedEvent) => {
    if (store.getState().loadState === 'ready') {
      project(event)
      return
    }
    // 同一物料只保留加载窗口内最新修订；applyRemoteMove 会从当前父级移到最终父级。
    pendingByMaterial.delete(event.materialId)
    pendingByMaterial.set(event.materialId, event)
    flush()
  }, { onResyncRequired: resync })
  return () => {
    disposed = true
    pendingByMaterial.clear()
    unsubscribeStore()
    subscription.dispose()
  }
}
