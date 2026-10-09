import { Icon } from '@unilab/design-v2/icons'
import { StatusBadge } from '@unilab/lab-ui'
import type { WorkflowReadyFrontierCandidate } from '@unilab-fe/core'

import styles from './TaskExecutionTimeline.module.scss'

export interface TaskParallelTimelineRowProps {
  readonly open: boolean
  readonly onOpen: () => void
  readonly candidates: readonly WorkflowReadyFrontierCandidate[]
}

export function TaskParallelTimelineRow({
  open,
  onOpen,
  candidates,
}: TaskParallelTimelineRowProps) {
  const selectableCount = candidates.filter((candidate) => candidate.selectable).length
  return (
    <button
      type="button"
      className={[styles.row, styles.parallelRow, open && styles.isSelected]
        .filter(Boolean)
        .join(' ')}
      onClick={onOpen}
    >
      <span className={styles.time}>—</span>
      <span className={styles.marker} data-status="manual" aria-hidden="true">
        <Icon name="development/git-branch-01" size={14} color="inherit" />
      </span>
      <span className={styles.content}>
        <span className={styles.head}>
          <span className={styles.title}>OS 返回的并行候选</span>
          <StatusBadge status="manual" label="待选择" />
        </span>
        <span className={styles.meta}>
          <span>{selectableCount} 个可选择节点</span>
          <span>共 {candidates.length} 个候选</span>
        </span>
      </span>
      <span className={styles.chevron} aria-hidden="true">
        <Icon name="arrows/chevron-right" size={16} color="inherit" />
      </span>
    </button>
  )
}
