import type { WorkflowNodePaletteProps } from './WorkflowNodePalette'
import { WorkflowButton } from './WorkflowButton'
import { writeWorkflowNodePaletteDragPayload, type WorkflowNodePaletteDragPayload } from '../utils/workflowCanvasCommands'

type Props = Pick<WorkflowNodePaletteProps,
  'catalog' | 'busy' | 'canvasMutationEnabled' | 'graphAvailable' |
  'materialSourceCatalogAvailable' | 'materialSourceAuthorityBlocked' |
  'materialSourceCatalogLoading' | 'materialSourceCatalogError' |
  'onAddManualConfirmation' | 'onAddAction' | 'onAddMaterialSource' | 'onPaletteDragStart' |
  'onRefreshMaterialSourceCatalog'>

/** 使用权威模板和既有插入命令展示非设备节点，不在前端伪造模板身份。 */
export function ExperimentOperationControlLibrary(props: Props): React.JSX.Element {
  const blocked = props.busy || !props.canvasMutationEnabled || !props.graphAvailable
  const reason = props.busy ? '正在处理实验操作，请稍后添加节点'
    : !props.canvasMutationEnabled ? '请先选择可编辑的实验操作'
      : '实验操作画布尚未加载完成'
  const entries = [
    { kind: 'condition', label: '条件', icon: '◇' },
    { kind: 'repeat_until', label: '循环', icon: '↻' },
    { kind: 'material_source', label: '物料来源', icon: '▱' }
  ] as const
  return <details className="operation-control-library" open>
    <summary><strong>流程控制与物料</strong><span>4 项</span></summary>
    <div className="operation-control-library__grid">
      <WorkflowButton type="button" disabled={blocked || !props.catalog || !props.onAddManualConfirmation}
        disabledReason={blocked ? reason : '当前服务不支持人工确认'}
        data-node-kind="manual_confirm" data-workflow-palette-manual="true"
        draggable={!blocked && Boolean(props.catalog && props.onAddManualConfirmation)}
        onClick={() => props.onAddManualConfirmation?.()}
        onDragStart={event => {
          if (blocked || !props.catalog || !props.onAddManualConfirmation) { event.preventDefault(); return }
          const payload = { kind: 'manual_confirmation' } as const
          props.onPaletteDragStart?.(payload)
          writeWorkflowNodePaletteDragPayload(event.dataTransfer, payload)
        }}><span aria-hidden="true">♧</span>人工确认</WorkflowButton>
      {entries.map(entry => {
        const material = entry.kind === 'material_source'
        const template = props.catalog?.actionTemplates.find(item =>
          item.nodeType === entry.kind &&
          item.actionClass === `unilabos.workflow.authoring:${entry.kind}`)
        const unavailable = material
          ? !props.materialSourceCatalogAvailable || props.materialSourceAuthorityBlocked || props.materialSourceCatalogLoading
          : !template
        const disabled = blocked || unavailable
        const disabledReason = blocked ? reason : material
          ? '物料与库位目录尚未就绪，请先刷新目录'
          : '当前服务尚未提供此节点模板'
        const payload: WorkflowNodePaletteDragPayload | null = material
          ? { kind: 'material' }
          : template ? { kind: 'action', templateUuid: template.uuid } : null
        return <WorkflowButton key={entry.kind} type="button"
          disabled={disabled} disabledReason={disabledReason}
          draggable={!disabled} data-node-kind={entry.kind}
          data-workflow-palette-action={!material ? template?.uuid : undefined}
          data-workflow-palette-material={material ? 'true' : undefined}
          title={material ? '物料来源（materialSource）' : entry.label}
          onClick={() => {
            if (disabled) return
            if (material) props.onAddMaterialSource()
            else if (template) props.onAddAction(template.uuid)
          }}
          onPointerDown={event => {
            if (disabled || !payload || !props.onPaletteDragStart) return
            event.currentTarget.setPointerCapture?.(event.pointerId)
            props.onPaletteDragStart(payload)
          }}
          onDragStart={event => {
            if (disabled || !payload) { event.preventDefault(); return }
            props.onPaletteDragStart?.(payload)
            writeWorkflowNodePaletteDragPayload(event.dataTransfer, payload)
          }}>
          <span aria-hidden="true">{entry.icon}</span>{entry.label}
        </WorkflowButton>
      })}
    </div>
    {props.materialSourceCatalogError && <div role="alert" className="operation-control-library__error">
      <span>{props.materialSourceCatalogError}</span>
      <button type="button" disabled={props.busy || props.materialSourceCatalogLoading}
        onClick={() => void props.onRefreshMaterialSourceCatalog()}>刷新物料目录</button>
    </div>}
  </details>
}
