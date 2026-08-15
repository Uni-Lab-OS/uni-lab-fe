import type { ReactNode } from 'react'

interface WorkflowCanvasStageHeaderProps {
  title: string
  nodeCount: number
  linkCount: number
  projectionLabel: string
  projectionTitle: string
  tools?: ReactNode
  description?: ReactNode
}

/**
 * 渲染 dev 工作流（Workflow）画布固定的身份、规模、投影状态与工具区域。
 *
 * @param props 工作流名称、节点/边数量、权威投影说明和可选画布工具。
 * @returns OS 与 Backend 画布共同使用的标题条。
 */
export function WorkflowCanvasStageHeader({
  title,
  nodeCount,
  linkCount,
  projectionLabel,
  projectionTitle,
  tools,
  description
}: WorkflowCanvasStageHeaderProps): React.JSX.Element {
  return (
    <header className="persistent-authoring__stage-header">
      <div>
        <strong>{title}</strong>
        <span>{nodeCount} 个节点 · {linkCount} 条边</span>
      </div>
      <div className="persistent-authoring__stage-context">
        <span
          className="persistent-authoring__projection-status"
          title={projectionTitle}
        >
          {projectionLabel}
        </span>
        {description}
        {tools ? (
          <div className="persistent-authoring__stage-tools">
            {tools}
          </div>
        ) : null}
      </div>
    </header>
  )
}
