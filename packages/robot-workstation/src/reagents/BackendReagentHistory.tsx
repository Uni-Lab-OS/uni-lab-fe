import { useEffect, useState } from 'react'
import { Button } from '@unilab/design-system'

import type {
  ReagentHistoryProjection,
  ReagentInventoryProjection
} from '../types'
import { uiClass } from '../uiClasses'
import { WorkstationIcon } from '../WorkstationIcon'
import styles from '../workstation.module.scss'

type HistoryState =
  | { phase: 'loading' }
  | { phase: 'ready'; entries: readonly ReagentHistoryProjection[] }
  | { phase: 'error'; message: string }

/**
 * 在主表下方展示 Backend 不可变试剂台账，避免用只读详情打断用户当前任务。
 * @param props 当前试剂、历史读取函数和关闭回调。
 * @returns 支持加载、错误恢复、空态和结构化追踪字段的内联审计面板。
 */
export function BackendReagentHistory({
  item,
  readHistory,
  onClose
}: {
  item: ReagentInventoryProjection
  readHistory: (materialId: string) => Promise<readonly ReagentHistoryProjection[]>
  onClose: () => void
}): React.JSX.Element {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<HistoryState>({ phase: 'loading' })

  useEffect(() => {
    let active = true
    setState({ phase: 'loading' })
    const materialId = item.materialId
    if (!materialId) {
      setState({ phase: 'error', message: '当前试剂没有返回容器物料 UUID，无法读取历史。' })
      return () => { active = false }
    }
    void readHistory(materialId).then(
      entries => {
        if (active) setState({ phase: 'ready', entries })
      },
      error => {
        if (active) setState({
          phase: 'error',
          message: error instanceof Error && error.message
            ? error.message
            : '试剂历史读取失败，请重试。'
        })
      }
    )
    return () => { active = false }
  }, [item.materialId, readHistory, revision])

  return (
    <section className={`${uiClass.panel} ${styles.reagentHistoryPanel}`} aria-label={`${item.name} 操作记录`}>
      <div className={uiClass.panelHeader}>
        <div>
          <h2>{item.name} · 操作记录</h2>
          <small>记录数量变化、操作来源及关联任务，便于追溯库存流转。</small>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭操作记录">
          <WorkstationIcon name="close" />
        </Button>
      </div>
      {state.phase === 'loading' ? (
        <div className={styles.historyState} role="status">正在读取库存变更记录…</div>
      ) : state.phase === 'error' ? (
        <div className={styles.historyState} role="alert">
          <span>{state.message}</span>
          <Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>重新读取</Button>
        </div>
      ) : state.entries.length === 0 ? (
        <div className={styles.historyState} role="status">当前容器没有库存变更记录。</div>
      ) : (
        <div className={styles.reagentRecords}>
          {state.entries.map(entry => (
            <article key={entry.id} data-result={entry.eventType}>
              <header>
                <strong>{historyEventLabel(entry.eventType)}</strong>
                <span>{historyOperatorLabel(entry.operatorType)}</span>
              </header>
              <dl>
                <div>
                  <dt>数量变化</dt>
                  <dd>{formatDelta(entry.quantityDelta, entry.quantityUnit)}</dd>
                </div>
                <div>
                  <dt>修订</dt>
                  <dd>{entry.revision ?? '—'}</dd>
                </div>
                <div>
                  <dt>工作流任务</dt>
                  <dd>{entry.workflowTaskId ?? '—'}</dd>
                </div>
                <div>
                  <dt>节点作业</dt>
                  <dd>{entry.workflowNodeJobId ?? '—'}</dd>
                </div>
              </dl>
              <footer>
                <time dateTime={entry.recordedAt}>{formatDateTime(entry.recordedAt)}</time>
                <code>{entry.traceId ?? entry.id}</code>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

/** 返回试剂台账事件的权威中文动作名。 */
function historyEventLabel(event: ReagentHistoryProjection['eventType']): string {
  if (event === 'add') return '新增试剂余量'
  if (event === 'remove') return '删除并闭合余量'
  if (event === 'consume') return '消耗试剂'
  return '校准试剂余量'
}

/** 返回台账操作通道中文名，不把 frontend 误写为具体人员。 */
function historyOperatorLabel(operator: ReagentHistoryProjection['operatorType']): string {
  if (operator === 'frontend') return '前端操作'
  if (operator === 'edge') return 'Edge 回执'
  return '系统操作'
}

/** 格式化带正负号的权威数量变化。 */
function formatDelta(value: number | undefined, unit: string | undefined): string {
  if (value == null) return '未提供'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString('zh-CN')} ${unit ?? ''}`.trim()
}

/** 使用中文区域格式化可审计时间，非法时间保留原始 wire 值。 */
function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'medium'
      }).format(date)
}
