import { Handle, Position } from 'reactflow'
import type { CSSProperties, ReactNode } from 'react'
import type { WorkflowHandlePort } from '../utils/parseWorkflow'
import type {
  WorkflowMaterialPortCard,
  WorkflowNodeData
} from './WorkflowNodeCard'
import styles from './workflow.module.scss'

interface WorkflowTransferNodeProps {
  data: WorkflowNodeData
  materialPort: WorkflowMaterialPortCard
  materialTargetPosition: Position
  materialSourcePosition: Position
  stateVisible: boolean
  stateLabel: string
  structuralTargetHandles: ReactNode
  structuralSourceHandles: ReactNode
}

/**
 * 将标准物料转运子工作流投影为菱形机械臂节点，并保持物料流句柄在菱形外缘。
 *
 * @param props 节点数据、物料端口、逐节点端口方位、状态与结构句柄。
 * @returns 保留物料占位符（ResourceSlot）身份和调试标记的转运节点。
 */
export default function WorkflowTransferNode({
  data,
  materialPort,
  materialTargetPosition,
  materialSourcePosition,
  stateVisible,
  stateLabel,
  structuralTargetHandles,
  structuralSourceHandles
}: WorkflowTransferNodeProps): React.JSX.Element {
  const transferSafety = data.materialTransferSafety
  const virtualOnly = transferSafety?.hardwareExecutable === false
  const blockerCodes = transferSafety?.blockers
    .map((blocker) => blocker.code)
    .join(',')
  const blockerTitle = transferSafety?.blockers
    .map((blocker) => blocker.message || blocker.code)
    .join('；') || '当前转运尚未标定，仅支持虚拟执行'
  return (
    <div
      className={`${styles.node} wf-node wf-node--robot-transfer ${
        data.sourceSelected ? 'wf-node--source-selected' : ''
      } cursor-pointer overflow-visible`}
      data-workflow-node-uuid={data.id}
      data-workflow-node-kind={data.kind || 'workflow'}
      data-workflow-node-visual-kind="robot-transfer"
      data-workflow-layout-strategy={data.layoutStrategy}
      data-workflow-layout-direction={data.materialLaneDirection}
      data-workflow-node-description={data.description}
      data-workflow-material-transfer-hardware-executable={transferSafety
        ? String(transferSafety.hardwareExecutable)
        : undefined}
      aria-label={data.description
        ? `${data.name || data.id}：${data.description}`
        : data.name || data.id}
      style={{ '--wf-material-accent': materialPort.accent } as CSSProperties}
    >
      {structuralTargetHandles}
      <span
        className="wf-node__robot-transfer-port"
        data-workflow-material-port-variable={materialPort.variableName}
        data-workflow-material-port-label={materialPort.label}
        data-workflow-material-port-description={materialPort.description}
        title={materialPort.description}
      >
        {materialPort.targetHandle && renderTransferHandle(
          materialPort.targetHandle,
          'target',
          materialPort,
          materialTargetPosition
        )}
        <span
          className="wf-node__robot-transfer-visual"
          data-workflow-robot-arm
          aria-label="机械臂转运"
          role="img"
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 48 48">
            <path d="M13 39h22" />
            <path d="M17 39v-6h14v6" />
            <circle cx="19" cy="29" r="4" />
            <path d="m21.8 26.2 7.3-8.2" />
            <circle cx="31" cy="16" r="3.5" />
            <path d="m28.6 13.5-5.3-5.2" />
            <path d="M20.7 6h6v4.7" />
            <path d="m34 16 4.2 3.4" />
            <path d="M38.2 19.4 41 17" />
            <path d="m38.2 19.4.7 3.7" />
          </svg>
        </span>
        {materialPort.sourceHandle && renderTransferHandle(
          materialPort.sourceHandle,
          'source',
          materialPort,
          materialSourcePosition
        )}
      </span>
      <span className="wf-node__robot-transfer-copy">
        <strong title={data.description?.trim() || data.name || data.id}>
          {data.name || data.id}
        </strong>
        <small title={materialPort.description}>
          {materialPort.label} · 机械臂转运
        </small>
        {virtualOnly && (
          <span
            className="wf-node__robot-transfer-safety"
            data-workflow-material-transfer-safety="virtual-only"
            data-workflow-material-transfer-blockers={blockerCodes}
            data-workflow-material-transfer-source-site={
              transferSafety.source?.site
            }
            data-workflow-material-transfer-target-site={
              transferSafety.target?.site
            }
            title={blockerTitle}
            aria-label={`仅虚拟执行，未标定：${blockerTitle}`}
          >
            仅虚拟/未标定
          </span>
        )}
        {data.groupKind === 'subworkflow' && (
          <button
            type="button"
            className="wf-node__robot-transfer-toggle"
            data-subworkflow-toggle
            aria-expanded={Boolean(data.groupExpanded)}
            aria-label={`${data.groupExpanded ? '折叠' : '展开'}子工作流 ${data.name || data.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              data.onToggleGroup?.(data.id)
            }}
          >
            <span aria-hidden="true">{data.groupExpanded ? '▾' : '▸'}</span>
            {data.descendantCount || 0} 个内部节点
          </button>
        )}
        {stateVisible && (
          <span className={`wf-node__robot-transfer-state wf-node__state--${data.status || 'pending'}`}>
            {stateLabel}
          </span>
        )}
      </span>
      {(data.startNode || data.breakpoint || data.pausedBefore || data.beforeStart) && (
        <span className="wf-node__robot-transfer-flags" aria-label="调试标记">
          {data.startNode && <span title="起始点">⚑</span>}
          {data.breakpoint && <span title="断点">●</span>}
          {data.pausedBefore && <span title="下一步执行">▶</span>}
          {data.beforeStart && <span title="不执行">⊘</span>}
        </span>
      )}
      {(data.onSetStart || data.onToggleBreakpoint) && (
        <span className="wf-node__robot-transfer-actions">
          {data.onSetStart && (
            <button
              type="button"
              className={data.startNode ? 'is-active is-start' : ''}
              aria-label={`${data.startNode ? '取消' : '设为'}起始点 ${data.id}`}
              title={data.startNode ? '取消起始点' : '从此节点开始执行'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                data.onSetStart?.(data.id)
              }}
            >
              ⚑
            </button>
          )}
          {data.onToggleBreakpoint && (
            <button
              type="button"
              className={data.breakpoint ? 'is-active is-breakpoint' : ''}
              aria-label={`${data.breakpoint ? '取消' : '设置'}断点 ${data.id}`}
              title={data.breakpoint ? '取消断点' : '在此节点前暂停'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                data.onToggleBreakpoint?.(data.id)
              }}
            >
              ●
            </button>
          )}
        </span>
      )}
      {structuralSourceHandles}
    </div>
  )
}

/**
 * 渲染机械臂转运节点的一侧物料占位符（ResourceSlot）端口。
 *
 * @param handle OS 投影出的物料句柄。
 * @param ioType 输入或输出方向。
 * @param port 合并后的物料端口展示信息。
 * @param position 当前节点布局指定的边缘方位。
 * @returns 可供 React Flow 路由的物料端口元素。
 */
function renderTransferHandle(
  handle: WorkflowHandlePort,
  ioType: 'source' | 'target',
  port: WorkflowMaterialPortCard,
  position: Position
): React.JSX.Element {
  return (
    <Handle
      id={handle.uuid}
      type={ioType}
      position={position}
      className={`wf-node__handle wf-node__handle--material wf-node__robot-transfer-handle wf-node__robot-transfer-handle--${ioType}`}
      data-workflow-handle-template-uuid={handle.uuid}
      data-workflow-handle-key={handle.handleKey}
      data-workflow-handle-io={ioType}
      data-workflow-handle-kind="material"
      aria-label={`${port.label} 物料${ioType === 'target' ? '输入' : '输出'}端口`}
      title={handle.description || `${port.label} · 物料流`}
    />
  )
}
