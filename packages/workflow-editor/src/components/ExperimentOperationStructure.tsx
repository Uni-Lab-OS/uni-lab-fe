import type { WorkflowNode } from '../utils/parseWorkflow'

interface ExperimentOperationStructureProps {
  workflowName: string
  nodes: readonly WorkflowNode[]
  linkCount: number
  selectedNodeId: string | null
  onSelect(nodeId: string): void
  onClose(): void
}

/**
 * 从当前 Canonical DAG 投影实验操作结构，不持有第二份节点或顺序状态。
 */
export function ExperimentOperationStructure({
  workflowName,
  nodes,
  linkCount,
  selectedNodeId,
  onSelect,
  onClose
}: ExperimentOperationStructureProps): React.JSX.Element {
  return (
    <aside
      id="persistent-authoring-operation-structure"
      className="persistent-authoring__operation-structure"
      aria-label="实验流程结构"
    >
      <header>
        <span>
          <strong>实验流程结构</strong>
          <small>执行顺序与节点关系</small>
        </span>
        <button
          type="button"
          aria-label="隐藏实验流程结构"
          title="隐藏实验流程结构"
          onClick={onClose}
        >
          <span className="codicon codicon-close" aria-hidden="true" />
        </button>
      </header>

      <div className="persistent-authoring__operation-structure-columns">
        <span>序号</span>
        <span>节点名称</span>
      </div>

      <div className="persistent-authoring__operation-root">
        <span>OP</span>
        <span>
          <strong>{workflowName}</strong>
          <small>{nodes.length} 个节点 · {linkCount} 条连接</small>
        </span>
      </div>

      {nodes.length === 0 ? (
        <div className="persistent-authoring__operation-structure-empty" role="status">
          <span className="codicon codicon-list-tree" aria-hidden="true" />
          <strong>尚未添加动作节点</strong>
          <small>从操作与节点库拖入动作后，将在这里同步显示。</small>
        </div>
      ) : (
        <ol>
          {nodes.map((node, index) => (
            <li key={node.id}>
              <button
                type="button"
                aria-current={selectedNodeId === node.id ? 'true' : undefined}
                title={`在画布中定位：${node.name}`}
                onClick={() => onSelect(node.id)}
              >
                <span>{index + 1}</span>
                <span
                  className={`codicon ${operationNodeIcon(node)}`}
                  aria-hidden="true"
                />
                <span>
                  <strong>{node.name}</strong>
                  <small>{operationNodeKind(node)}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}

function operationNodeIcon(node: WorkflowNode): string {
  if (node.groupKind === 'subworkflow') return 'codicon-type-hierarchy-sub'
  if (node.materialSource) return 'codicon-package'
  if (node.type === 'condition' || node.type === 'branch') return 'codicon-git-branch'
  return 'codicon-server-process'
}

function operationNodeKind(node: WorkflowNode): string {
  if (node.groupKind === 'subworkflow') return '实验操作节点'
  if (node.materialSource) return '物料来源'
  if (node.type === 'condition' || node.type === 'branch') return '流程控制'
  return node.className || node.type || '设备动作'
}
