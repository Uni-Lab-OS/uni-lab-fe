import type { WorkflowNode } from '../utils/parseWorkflow'

/**
 * 在单一浮动工具栏中保留轻量 X6 节点的调试与创作操作。
 *
 * @param props 当前单选节点、组合/断点状态及由创作层提供的窄命令。
 * @returns 未单选时返回 null；否则返回不会按节点数复制的操作栏。
 * @safety 工具栏不改写工作流，只把稳定节点 ID 提交给上层命令。
 */
export function WorkflowX6NodeActions({
  node,
  expandedGroupIds,
  breakpoints,
  onSetStart,
  onToggleBreakpoint,
  onToggleDisabled,
  onToggleGroup
}: {
  node: WorkflowNode | null
  expandedGroupIds: ReadonlySet<string>
  breakpoints: ReadonlySet<string>
  onSetStart?: (nodeId: string) => void
  onToggleBreakpoint?: (nodeId: string) => void
  onToggleDisabled?: (nodeId: string) => void
  onToggleGroup: (nodeId: string) => void
}): React.JSX.Element | null {
  if (!node) return null
  const materialSource = node.type === 'material_source'
  return (
    <div
      className="workflow-x6__node-actions"
      role="toolbar"
      aria-label={`${node.name} 节点操作`}
    >
      <strong>{node.name}</strong>
      {node.groupKind === 'subworkflow' ? (
        <button type="button" onClick={() => onToggleGroup(node.id)}>
          {expandedGroupIds.has(node.id) ? '收起组合' : '展开组合'}
        </button>
      ) : (
        <>
          {onSetStart && !materialSource ? (
            <button type="button" onClick={() => onSetStart(node.id)}>
              设为开始
            </button>
          ) : null}
          {onToggleBreakpoint && !materialSource ? (
            <button
              type="button"
              onClick={() => onToggleBreakpoint(node.id)}
            >
              {breakpoints.has(node.id) ? '移除断点' : '添加断点'}
            </button>
          ) : null}
          {onToggleDisabled && !node.authoringReadOnly ? (
            <button type="button" onClick={() => onToggleDisabled(node.id)}>
              {node.disabled ? '启用节点' : '停用节点'}
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}
