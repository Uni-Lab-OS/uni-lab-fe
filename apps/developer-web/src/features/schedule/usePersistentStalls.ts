import { useEffect, useMemo, useRef, useState } from 'react'
import { persistentStalls, type TimePlanSnapshot } from '@unilab-fe/core'

type Stall = TimePlanSnapshot['blocked'][number]

/**
 * 从最近一次读取的无法排程节点中，筛出已持续 minAgeMs 的。任务真正停住时 OS 不再发失效通知，
 * 不会有新的读取；没有通知即说明上次读取仍是权威状态，因此只在本地按时钟重新判定（不请求后端）。
 */
export function usePersistentStalls(raw: readonly Stall[], minAgeMs = 60_000): readonly Stall[] {
  const firstSeen = useRef(new Map<string, number>())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (raw.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [raw])
  return useMemo(
    () => persistentStalls(raw, firstSeen.current, now, minAgeMs),
    [raw, now, minAgeMs],
  )
}
