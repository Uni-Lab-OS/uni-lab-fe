import { useEffect, useRef } from 'react'
import type { WorkflowRuntimeInvalidation } from '@unilab-fe/core'
import { useBackend } from '../app/BackendProvider'

export interface RuntimeInvalidationOptions {
  /** 两次重读之间的最小间隔；任务运行时失效通知几乎连续到达，不能每条都重读。 */
  readonly minIntervalMs?: number
  /** 只处理关心的通知；默认处理任务与设备动作通知，不处理工站错误处置通知。 */
  readonly accept?: (event: WorkflowRuntimeInvalidation) => boolean
  readonly enabled?: boolean
}

const BURST_MS = 200
const acceptTaskEvents = (event: WorkflowRuntimeInvalidation) =>
  event.event !== 'station.error_handling.changed'

/**
 * 全局 SSE 失效通知到达后调用 onInvalidate 重读权威投影（通知不携带状态）。
 * 节流：同一轮的多条通知合并；上一次重读未结束时不并发，结束后若期间有新通知再补读一次；
 * 两次重读至少间隔 minIntervalMs。重连后补读一次。
 */
export function useRuntimeInvalidation(
  onInvalidate: () => unknown,
  {
    minIntervalMs = 2_000,
    accept = acceptTaskEvents,
    enabled = true,
  }: RuntimeInvalidationOptions = {},
): void {
  const { backend } = useBackend()
  const callback = useRef(onInvalidate)
  callback.current = onInvalidate
  const filter = useRef(accept)
  filter.current = accept
  useEffect(() => {
    const events = backend.core.workflowRuntimeEvents
    if (!events || !enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let running = false
    let dirty = false
    let disposed = false
    let lastRun = 0
    const schedule = () => {
      if (disposed || timer !== null) return
      if (running) {
        dirty = true
        return
      }
      const wait = Math.max(BURST_MS, lastRun + minIntervalMs - Date.now())
      timer = setTimeout(() => void run(), wait)
    }
    const run = async () => {
      timer = null
      running = true
      dirty = false
      lastRun = Date.now()
      try {
        await callback.current()
      } catch {
        // 重读失败由各页面自己的读取状态展示；这里只负责节流。
      } finally {
        running = false
        if (dirty) schedule()
      }
    }
    const subscription = events.subscribe((event) => filter.current(event) && schedule(), {
      onOpen: ({ reconnected }) => reconnected && schedule(),
    })
    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      subscription.dispose()
    }
  }, [backend, enabled, minIntervalMs])
}
