import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from 'react'

import type { FormattedLocalRuntimeLogRow } from '../lib/runtime-log-formatting'

const LOG_ROW_ESTIMATED_HEIGHT_PX = 28
const LOG_ROW_OVERSCAN_PX = LOG_ROW_ESTIMATED_HEIGHT_PX * 8

export interface VirtualizedRuntimeLogRowEntry {
  row: FormattedLocalRuntimeLogRow
  index: number
  measurementKey: string
  height: number
  top: number
}

export interface VirtualizedRuntimeLog {
  outputRef: RefObject<HTMLDivElement | null>
  totalHeight: number
  visibleRows: readonly VirtualizedRuntimeLogRowEntry[]
  setScrollTop: (scrollTop: number) => void
}

/**
 * 维护动态行高日志的测量、可视窗口和自动跟随状态。
 *
 * @param rows 当前筛选后的格式化日志行。
 * @param activeSource 当前日志来源的稳定标识。
 * @param contentVersion 当前来源原始内容，用于触发尾部跟随。
 * @param following 用户是否允许自动跟随最新输出。
 * @param hasRenderedOutput 当前是否已经挂载日志列表。
 * @param onFollowChange 自动跟随状态变更回调。
 * @returns 日志容器 ref、总高度、可视行和滚动位置写入口。
 * @safety 只维护展示测量，不修改原始日志快照或读取游标。
 */
export function useVirtualizedRuntimeLog(
  rows: readonly FormattedLocalRuntimeLogRow[],
  activeSource: string,
  contentVersion: string,
  following: boolean,
  hasRenderedOutput: boolean,
  onFollowChange: (following: boolean) => void
): VirtualizedRuntimeLog {
  const outputRef = useRef<HTMLDivElement>(null)
  const activeLogSourceRef = useRef(activeSource)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({})
  const entries = useMemo(
    /** 为当前格式化记录生成稳定的测量项。 */
    () => rows.map((row, index) => ({
      row,
      index,
      measurementKey: measurementKey(row)
    })),
    [rows]
  )
  const rowLayout = useMemo(
    /** 使用已测量高度计算每条记录的绝对位置与列表总高度。 */
    () => {
      let top = 0
      const measuredRows = entries.map((entry) => {
        const height = rowHeights[entry.measurementKey]
          ?? LOG_ROW_ESTIMATED_HEIGHT_PX
        const layoutEntry = { ...entry, height, top }
        top += height
        return layoutEntry
      })
      return { rows: measuredRows, totalHeight: top }
    },
    [entries, rowHeights]
  )
  const visibleScrollTop = following
    ? Math.max(0, rowLayout.totalHeight - viewportHeight)
    : scrollTop
  const visibleRows = useMemo(
    /** 只选择视口及上下缓冲区内的记录，避免长日志一次挂载全部节点。 */
    () => {
      const visibleTop = Math.max(0, visibleScrollTop - LOG_ROW_OVERSCAN_PX)
      const visibleBottom = visibleScrollTop
        + viewportHeight
        + LOG_ROW_OVERSCAN_PX
      return rowLayout.rows.filter((entry) => (
        entry.top + entry.height >= visibleTop && entry.top <= visibleBottom
      ))
    },
    [rowLayout.rows, viewportHeight, visibleScrollTop]
  )

  useEffect(
    /** 删除已经离开当前筛选结果的行高缓存。 */
    () => {
      const activeKeys = new Set(entries.map((entry) => entry.measurementKey))
      setRowHeights((current) => {
        const keys = Object.keys(current)
        if (keys.every((key) => activeKeys.has(key))) return current
        return Object.fromEntries(
          keys
            .filter((key) => activeKeys.has(key))
            .map((key) => [key, current[key]])
        )
      })
    },
    [entries]
  )

  useEffect(
    /** 跟踪日志视口尺寸，并在宽度变化后重新测量换行高度。 */
    () => {
      const output = outputRef.current
      if (!output || typeof ResizeObserver === 'undefined') return undefined
      const observer = new ResizeObserver(
        /** 记录日志视口的新高度，并清除依赖旧宽度的行高。 */
        ([entry]) => {
          if (!entry) return
          setViewportHeight(entry.contentRect.height)
          setRowHeights({})
        }
      )
      observer.observe(output)
      return () => observer.disconnect()
    },
    [hasRenderedOutput]
  )

  useLayoutEffect(
    /** 在浏览器完成布局后收集当前可视日志行的真实高度。 */
    () => {
      const output = outputRef.current
      if (!output) return
      const measuredRows = output.querySelectorAll<HTMLElement>(
        '[data-log-row-index]'
      )
      setRowHeights((current) => {
        let next = current
        measuredRows.forEach((element) => {
          const index = Number(element.dataset.logRowIndex)
          const entry = entries[index]
          if (!entry) return
          const height = Math.ceil(element.getBoundingClientRect().height)
          if (height <= 0 || current[entry.measurementKey] === height) return
          if (next === current) next = { ...current }
          next[entry.measurementKey] = height
        })
        return next
      })
    },
    [entries, visibleRows]
  )

  useEffect(
    /** 在来源切换或日志增长后维护自动跟随位置。 */
    () => {
      const activeSourceChanged = activeLogSourceRef.current !== activeSource
      activeLogSourceRef.current = activeSource
      if (activeSourceChanged) onFollowChange(true)

      const output = outputRef.current
      if (output && following) {
        output.scrollTop = output.scrollHeight
        setScrollTop(output.scrollTop)
      }
    },
    [
      activeSource,
      contentVersion,
      following,
      onFollowChange,
      rowLayout.totalHeight
    ]
  )

  return {
    outputRef,
    totalHeight: rowLayout.totalHeight,
    visibleRows,
    setScrollTop
  }
}

/**
 * 为动态测量缓存生成内容稳定的日志行键。
 * @param row 已格式化的单条日志记录。
 * @returns 由时间、级别、来源与正文组成的稳定键。
 */
function measurementKey(row: FormattedLocalRuntimeLogRow): string {
  return [row.time, row.level, row.source, row.message].join('\u0000')
}
