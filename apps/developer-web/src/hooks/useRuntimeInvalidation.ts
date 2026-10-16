import { useEffect, useRef } from 'react'
import { useBackend } from '../app/BackendProvider'

/**
 * 全局 SSE 失效通知（workflow.runtime.changed 等）到达后调用 onInvalidate；
 * 同一轮派发/结算的多条通知合并为一次，重连后补读一次。只触发重读权威投影，不携带状态。
 */
export function useRuntimeInvalidation(onInvalidate: () => void, delayMs = 500): void {
  const { backend } = useBackend()
  const callback = useRef(onInvalidate)
  callback.current = onInvalidate
  useEffect(() => {
    const events = backend.core.workflowRuntimeEvents
    if (!events) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const fire = () => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        callback.current()
      }, delayMs)
    }
    const subscription = events.subscribe(fire, { onOpen: ({ reconnected }) => reconnected && fire() })
    return () => {
      if (timer !== null) clearTimeout(timer)
      subscription.dispose()
    }
  }, [backend, delayMs])
}
