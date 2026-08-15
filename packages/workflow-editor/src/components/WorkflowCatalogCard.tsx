import type { WorkflowSummary } from '@unilab/services'

import { WorkflowButton } from './WorkflowButton'

interface WorkflowCatalogCardProps {
  workflow: WorkflowSummary
  selectionMode: 'authoring' | 'run' | null
  manageable: boolean
  managementActionsVisible: boolean
  disabledReason: string
  onOpen: () => void
  onShowLog: () => void
  onDelete: () => void
}

/** 展示一个工作流定义，并明确区分创作入口与已有工作流运行入口。 */
export function WorkflowCatalogCard({
  workflow,
  selectionMode,
  manageable,
  managementActionsVisible,
  disabledReason,
  onOpen,
  onShowLog,
  onDelete
}: WorkflowCatalogCardProps): React.JSX.Element {
  const status = workflow.definition_status === 'configured'
    ? '已配置'
    : workflow.definition_status === 'empty'
      ? '待编排'
      : '状态未知'
  const selectable = selectionMode !== null
  return (
    <article role="listitem" className="workflow-runtime__catalog-card">
      <WorkflowButton
        type="button"
        className="workflow-runtime__catalog-card-main"
        disabled={!selectable}
        disabledReason={disabledReason}
        onClick={onOpen}
        aria-label={selectable
          ? `${selectionMode === 'run' ? '运行' : '打开'}工作流 ${workflow.name}`
          : `工作流 ${workflow.name}（当前 Backend 只读）`}
        title={`${workflow.name}\n版本 ${workflow.revision}`}
      >
        <span className="workflow-runtime__catalog-mark" aria-hidden="true">◇</span>
        <span className="workflow-runtime__catalog-copy">
          <strong>{workflow.name}</strong>
          <span className="workflow-runtime__catalog-description">
            {workflow.description?.trim() || '暂无描述'}
          </span>
          <small>{workflow.tags.length > 0
            ? workflow.tags.slice(0, 3).join(' · ')
            : formatUpdatedAt(workflow.update_time)}</small>
        </span>
        <span className="workflow-runtime__catalog-open" aria-hidden="true">
          {selectionMode === 'run' ? '运行' : selectable ? '→' : '只读'}
        </span>
      </WorkflowButton>
      <footer>
        <span className={`workflow-runtime__catalog-status is-${workflow.definition_status ?? 'unknown'}`}>
          {status}
        </span>
        <span>版本 {workflow.revision}</span>
        {manageable && managementActionsVisible ? (
          <div>
            <button type="button" onClick={onShowLog}>修改日志</button>
            <button type="button" className="is-danger" onClick={onDelete}>删除</button>
          </div>
        ) : null}
      </footer>
    </article>
  )
}

/** 返回紧凑的中文更新时间。 */
function formatUpdatedAt(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '更新时间未知'
  return `更新于 ${new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  }).format(timestamp)}`
}
