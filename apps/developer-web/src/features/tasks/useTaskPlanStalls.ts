import { useCallback, useEffect, useRef, useState } from 'react'
import { stalledPlanNodes, type TimePlanSnapshot } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { useRuntimeInvalidation } from '../../hooks/useRuntimeInvalidation'

export type TaskPlanStall = TimePlanSnapshot['blocked'][number]

/**
 * 该任务中 OS 无法排程的节点（非结构性“时间待定”原因）。这类节点不会被派发，任务会无报错地
 * 停在运行中，因此在任务详情显式提示。时间计划约数 MB，至多 5 秒重读一次；读取失败时不提示。
 */
export function useTaskPlanStalls(
  taskId: string | null,
  active: boolean,
): readonly TaskPlanStall[] {
  const { backend, readyEpoch } = useBackend()
  const available =
    backend.getCapabilityStatus('scheduler.timePlan').available && active && Boolean(taskId)
  const [stalls, setStalls] = useState<readonly TaskPlanStall[]>([])
  const sequence = useRef(0)
  const load = useCallback(async () => {
    if (!available || !taskId) return
    const current = ++sequence.current
    try {
      const plan = await backend.core.schedulerTimePlan.getTimePlan()
      if (current === sequence.current) setStalls(stalledPlanNodes(plan, taskId))
    } catch {
      if (current === sequence.current) setStalls([])
    }
  }, [available, backend, taskId])
  useEffect(() => {
    if (!available) setStalls([])
    void load()
  }, [available, load, readyEpoch])
  useRuntimeInvalidation(load, { enabled: available, minIntervalMs: 5_000 })
  return stalls
}
