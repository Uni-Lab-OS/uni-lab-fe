import type {
  MaterialLoadState,
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
