import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorkflowRecoveryPort } from '@unilab/services'
import { WorkflowRecoveryController } from '../../runtime/WorkflowRecoveryController'

const controllers = new WeakMap<WorkflowRecoveryPort, WorkflowRecoveryController>()
export function useRecoveryController(port: WorkflowRecoveryPort, active: boolean) {
  let controller = controllers.get(port)
  if (!controller) {
    let storage: Storage | undefined
    try { storage = globalThis.sessionStorage } catch { /* 提交时明确显示存储不可用。 */ }
    controller = new WorkflowRecoveryController(port, storage)
    controllers.set(port, controller)
  }
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => active ? controller.retain() : undefined, [controller, active])
  return { controller, state }
}
export const RecoveryContext = createContext<{ port: WorkflowRecoveryPort; revision: number } | null>(null)
export function useRecovery() {
  const context = useContext(RecoveryContext)
  if (!context) throw new Error('异常处置服务未装配')
  return context
}

/** 对话框内按身份读取，切换 Authority/会话后立即清除旧数据；可按需串行补读命令详情。 */
export function useRecoveryRead<T>(key: string, load: () => Promise<T>, enabled = true, pollMs = 0): { data?: T; error?: string; loading: boolean; refresh: () => void } {
  const { port, revision } = useRecovery()
  const identity = `${port.scopeKey}:${key}`
  const loader = useRef(load); loader.current = load
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{ identity: string; data?: T; error?: string; loading: boolean }>({ identity, loading: true })
  useEffect(() => {
    if (!enabled) return
    let canceled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      setState((previous) => ({ identity, data: previous.identity === identity ? previous.data : undefined, loading: true }))
      try {
        const data = await loader.current()
        if (!canceled) setState((previous) => ({ identity, data: previous.identity === identity && JSON.stringify(previous.data) === JSON.stringify(data) ? previous.data : data, loading: false }))
      } catch (error) {
        if (!canceled) setState({ identity, error: error instanceof Error ? error.message : String(error), loading: false })
      } finally {
        if (!canceled && pollMs) timer = setTimeout(() => { void read() }, pollMs)
      }
    }
    void read()
    return () => { canceled = true; clearTimeout(timer) }
  }, [identity, revision, retry, enabled, pollMs])
  return { ...(state.identity === identity && enabled ? state : { loading: enabled }), refresh: () => setRetry((value) => value + 1) }
}
