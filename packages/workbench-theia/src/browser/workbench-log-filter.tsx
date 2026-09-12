import { useEffect, useRef } from 'react'
import { WORKBENCH_LOG_LEVELS, type WorkbenchLogQuery } from '@unilab/workbench-session/log-query'

const OPTIONS = [...WORKBENCH_LOG_LEVELS, 'heartbeat'] as const
export function logFilterOptionLabel(option: string): string {
  if (option === 'heartbeat') return 'Ping / Pong 心跳'
  if (option === 'warning') return 'WARN'
  if (option === 'critical') return 'FATAL'
  return option === 'plain' ? 'LOG' : option.toUpperCase()
}
export function logFilterSummary(selected: readonly string[]): string {
  return selected.length === OPTIONS.length ? '全部日志' : selected.length === 0 ? '未选择日志'
    : selected.length === 1 ? logFilterOptionLabel(selected[0]!) : `已选 ${selected.length} 项`
}
export function selectedLogFilters(query: WorkbenchLogQuery): string[] {
  return [...(query.levels ?? WORKBENCH_LOG_LEVELS), ...(query.heartbeat !== false ? ['heartbeat'] : [])]
}
export function logFilterSelectionQuery(selected: readonly string[]): WorkbenchLogQuery {
  return { levels: WORKBENCH_LOG_LEVELS.filter(level => selected.includes(level)),
    heartbeat: selected.includes('heartbeat'), limit: 500 }
}

/** 原生 summary 支持 Enter/Space；复选框支持 Tab/Space，Escape 和外部点击关闭。 */
export function WorkbenchLogFilter({ query, onChange }: {
  query: WorkbenchLogQuery
  onChange: (query: WorkbenchLogQuery) => void
}): React.JSX.Element {
  const root = useRef<HTMLDetailsElement>(null)
  const selected = selectedLogFilters(query)
  useEffect(() => {
    const element = root.current
    if (!element) return
    return installLogFilterDismissal(element)
  }, [])
  return <details className="unilab-runtime-log-filter" ref={root} onToggle={event => {
    const element = event.currentTarget
    const menu = element.querySelector<HTMLElement>('.unilab-runtime-log-filter__menu')
    if (element.open && menu) {
      const available = element.ownerDocument.documentElement.clientHeight - element.getBoundingClientRect().bottom - 16
      menu.style.maxHeight = `${Math.max(0, Math.min(360, available))}px`
    }
  }} onBlur={event => {
    closeLogFilterOnFocusExit(event.currentTarget, event.relatedTarget as Node | null)
  }}>
    <summary aria-label="日志级别筛选">
      {logFilterSummary(selected)}
      <span aria-hidden="true">⌄</span>
    </summary>
    <div className="unilab-runtime-log-filter__menu" role="group" aria-label="选择日志">
      <div className="unilab-runtime-log-filter__actions">
        <button type="button" onClick={() => onChange(logFilterSelectionQuery(OPTIONS))}>全选</button>
        <button type="button" onClick={() => onChange(logFilterSelectionQuery([]))}>清空</button>
      </div>
      {OPTIONS.map(option => <label key={option}>
        <input type="checkbox" checked={selected.includes(option)} onChange={() => {
          onChange(logFilterSelectionQuery(selected.includes(option)
            ? selected.filter(value => value !== option) : [...selected, option]))
        }} />
        {logFilterOptionLabel(option)}
      </label>)}
    </div>
  </details>
}

/** 绑定于宿主文档，清理时移除监听，避免抽屉卸载后残留处理。 */
export function installLogFilterDismissal(element: HTMLDetailsElement): () => void {
  const document = element.ownerDocument
  const onPointer = (event: Event) => {
    if (!element.contains(event.target as Node)) element.open = false
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !element.open) return
    event.preventDefault()
    event.stopPropagation()
    element.open = false
    element.querySelector('summary')?.focus()
  }
  document.addEventListener('pointerdown', onPointer)
  element.addEventListener('keydown', onKey)
  return () => {
    document.removeEventListener('pointerdown', onPointer)
    element.removeEventListener('keydown', onKey)
  }
}

/** 标签点击可能暂时没有新焦点；仅明确 Tab 离开时关闭，外点击由 pointerdown 处理。 */
export function closeLogFilterOnFocusExit(element: HTMLDetailsElement, next: Node | null): void {
  if (next !== null && !element.contains(next)) element.open = false
}
