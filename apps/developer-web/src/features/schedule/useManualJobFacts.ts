import { useEffect, useMemo, useRef, useState } from 'react'
import type { SchedulerTimeline } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { nodeKey, observedTaskNodes } from '../tasks/observedTaskNodes'
import { jobFact, type ScheduleJobFact } from './scheduleNodeFacts'

const LIMIT = 500
/** 每轮最多补读的作业数；人工确认节点很少，正常一轮即可读完。 */
const PER_PASS = 8

interface JobFactCache {
  readonly facts: Map<string, ScheduleJobFact>
  readonly pending: Set<string>
}

const caches = new WeakMap<object, JobFactCache>()

function cacheFor(backend: object): JobFactCache {
  let cache = caches.get(backend)
  if (!cache) {
    cache = { facts: new Map(), pending: new Set() }
    caches.set(backend, cache)
  }
  return cache
}

/**
 * 摘要视图下，已结束的人工确认条需要作业自身的执行种类与批准时刻才能与设备动作区分。
 * 只为本会话见过以人工确认方式等待的节点、且时间线中已结束的作业按需读取作业详情
 * （单个作业，体积小），结果按作业身份缓存；不读取整份任务定义。
 */
export function useManualJobFacts(
  timeline: SchedulerTimeline | null,
): ReadonlyMap<string, ScheduleJobFact> {
  const { backend, reportError } = useBackend()
  const cache = cacheFor(backend)
  const [version, setVersion] = useState(0)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    // 默认展示投影自带全部作业事实，不会记录待补读节点，这里自然不发请求。
    if (!timeline) return
    const manual = observedTaskNodes(backend).manualConfirm
    const wanted = timeline.entries
      .filter(
        (entry) =>
          entry.endedAt != null &&
          manual.has(nodeKey(entry.taskId, entry.nodeId)) &&
          !cache.facts.has(entry.jobId) &&
          !cache.pending.has(entry.jobId),
      )
      .slice(0, PER_PASS)
    for (const entry of wanted) {
      cache.pending.add(entry.jobId)
      backend.core.executionRead
        .getNodeJobDetail(entry.jobId)
        .then((job) => {
          cache.facts.set(entry.jobId, jobFact(job.executorKind, job.raw))
          if (cache.facts.size > LIMIT) cache.facts.delete(cache.facts.keys().next().value!)
          if (mounted.current) setVersion((value) => value + 1)
        })
        // 读取失败只影响条的细分标注（仍按实际执行区间显示），由全局连接指示器呈现。
        .catch(reportError)
        .finally(() => cache.pending.delete(entry.jobId))
    }
    // version：一批读完后继续补读本轮未读到的作业。
  }, [backend, cache, reportError, timeline, version])

  // version 变化时生成新快照，让依赖它的甘特图重新计算。
  return useMemo(() => new Map(cache.facts), [cache, version])
}
