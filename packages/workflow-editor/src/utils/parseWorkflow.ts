/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: 工作流结构的共享类型定义(节点/连接/步骤/整体结构)
 * Context: 工作流方向结构预览的公共类型,供 JSON 解析器与 DAG 布局复用
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import type { MaterialShapeSpec } from '@unilab/material'
import type { WorkflowNodeVisualKind } from './workflowNodeVisualKind'

export interface WorkflowMaterialTransferEndpoint {
  device?: string
  mountResource?: string
  site?: string
}

export interface WorkflowMaterialTransferBlocker {
  code: string
  message?: string
}

/** OS-managed material-transfer safety context projected for canvas display. */
export interface WorkflowMaterialTransferSafety {
  hardwareExecutable: boolean
  blockers: WorkflowMaterialTransferBlocker[]
  source?: WorkflowMaterialTransferEndpoint
  target?: WorkflowMaterialTransferEndpoint
}

export interface WorkflowNode {
  id: string
  /** OS Authoring 图中的静态禁用；保存后 Planner 不为它创建 Job。 */
  disabled?: boolean
  // 展示名称(JSON 导出格式携带中文名;无则回退 id)
  name: string
  // OS 节点或模板发布的完整操作说明；画布 hover 使用，不参与执行身份。
  description?: string
  type: string
  className: string
  // 大 web 语义节点类型(Sample/Labware/Reagent/Transport/Device),决定分色
  labNodeType: string
  // 显式坐标(JSON 导出格式自带 pose.position;无则由 layoutDag 计算)
  x?: number
  y?: number
  // Canonical group/source_map 派生的嵌套范围；不改变 OS 的平面执行 DAG。
  groupKind?: 'group' | 'subworkflow'
  parentGroupId?: string
  childNodeIds?: string[]
  descendantNodeIds?: string[]
  collapsedByDefault?: boolean
  // Persistent Authoring projects OS-owned Composite internals as read-only.
  authoringReadOnly?: boolean
  authoringReadOnlyReason?: string
  // Stable navigation target for a Composite boundary or one of its internals.
  openChildWorkflowUuid?: string
  // Resets session-only expansion when the authoritative OS graph changes.
  compositeSignature?: string
  // OS 已发布工作流来源元数据派生的专用画布视觉。
  visualKind?: WorkflowNodeVisualKind
  handles?: WorkflowHandlePort[]
  materialSource?: {
    mode: string
    flowRole: string
    mountUuid: string
    resourceTemplateUuid: string
    shape?: MaterialShapeSpec
  }
  materialTransferSafety?: WorkflowMaterialTransferSafety
}

export interface WorkflowHandlePort {
  uuid: string
  handleKey: string
  displayName: string
  title?: string
  description?: string
  ioType: 'source' | 'target'
  valueType?: string
  valueSchema?: Record<string, unknown>
  dataKey?: string | null
  editorControl?: string | null
  allowedResourceTemplateUuids?: string[] | null
  implicitPassthrough?: boolean
}

export interface WorkflowLink {
  id?: string
  source: string
  target: string
  type: string
  branch?: string | null
  sourceHandleUuid?: string
  targetHandleUuid?: string
}

export interface WorkflowStep {
  action: string
  args: Record<string, unknown>
  // 步骤动作的 JSON Schema(对齐大 web schema.properties.goal),供 RJSF 渲染
  schema: Record<string, unknown> | null
}

export interface WorkflowStructure {
  nodes: WorkflowNode[]
  links: WorkflowLink[]
  steps: WorkflowStep[]
  error: string | null
}
