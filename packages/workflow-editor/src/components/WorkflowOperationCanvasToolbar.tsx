import type { WorkflowSummary } from '@unilab/services'
import type { RefObject } from 'react'
import { useState } from 'react'

import { WorkflowButton } from './WorkflowButton'
import { WorkflowChangeLogDialog } from './WorkflowCatalogDialogs'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'

/**
 * 实验操作画布的 HTML 原型工具栏。操作页隐藏全局工具栏时，仍保留完整的
 * 源码、流程、保存、发布和启动调试入口。
 */
export function WorkflowOperationCanvasToolbar({
  model,
  workflowName,
  visible,
  operationStructureOpen,
  onToggleOperationStructure,
}: {
  model: PersistentWorkflowAuthoringModel
  workflowName?: string
  visible: boolean
  operationStructureOpen: boolean
  onToggleOperationStructure: () => void
}): React.JSX.Element | null {
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
  if (!visible) return null
  const {
    aggregate,
    applyCandidate,
    busy,
    codeViewingAvailable,
    dirty,
    fullSourceDiff,
    mode,
    pendingMode,
    remoteConflict,
    requestMode,
    runtime,
    runtimeBusy,
    saveDraft,
    startWorkflow,
    workflowStartBusy,
    workflowStartPresentation,
    workflowUuid
  } = model
  const saveState = saveToolbarState({
    aggregate,
    busy,
    dirty,
    fullSourceDiff,
    pendingMode,
    remoteConflict,
    runtimeBusy,
    workflowStartBusy
  })
  const publishState = publishToolbarState({
    aggregate,
    busy,
    dirty,
    fullSourceDiff,
    pendingMode,
    remoteConflict,
    runtimeBusy,
    workflowStartBusy
  })
  const startState = startToolbarState({
    aggregate,
    busy,
    runtimeBusy,
    workflowStartBusy,
    workflowStartPresentation
  })
  const versionSummary = workflowSummary(
    workflowUuid,
    workflowName,
    aggregate
  )

  return (
    <>
      <WorkflowButton
        type="button"
        className="persistent-authoring__canvas-toolbar-button"
        disabled={mode === 'canvas' && codeViewingAvailable === false}
        disabledReason="当前数据源不支持查看源码"
        title={mode === 'canvas' ? '切换到 Python 源码视图' : '切换回工作流画布'}
        onClick={() => requestMode(mode === 'canvas' ? 'code' : 'canvas')}
      >
        {mode === 'canvas' ? '查看源码' : '查看画布'}
      </WorkflowButton>
      <WorkflowButton
        type="button"
        className="persistent-authoring__canvas-toolbar-button"
        disabledReason="当前流程结构暂时不能切换"
        aria-controls="persistent-authoring-operation-structure"
        aria-pressed={operationStructureOpen}
        title={operationStructureOpen ? '隐藏流程结构' : '显示流程结构'}
        onClick={onToggleOperationStructure}
      >
        {operationStructureOpen ? '隐藏流程' : '显示流程'}
      </WorkflowButton>
      <WorkflowButton
        type="button"
        className="persistent-authoring__canvas-toolbar-button"
        disabled={saveState.disabled}
        disabledReason={saveState.reason}
        title="保存工作流"
        onClick={saveDraft}
      >
        保存
      </WorkflowButton>
      <WorkflowButton
        type="button"
        className="persistent-authoring__canvas-toolbar-button is-primary"
        disabled={publishState.disabled}
        disabledReason={publishState.reason}
        title="发布当前工作流候选版本"
        onClick={applyCandidate}
      >
        发布
      </WorkflowButton>
      <WorkflowButton
        type="button"
        className="persistent-authoring__canvas-toolbar-button is-primary is-start"
        disabled={startState.disabled}
        disabledReason={startState.reason}
        title="启动实验操作调试"
        onClick={startWorkflow}
      >
        ▶ 启动调试
      </WorkflowButton>
      {versionHistoryOpen ? (
        <WorkflowChangeLogDialog
          workflow={versionSummary}
          onClose={() => setVersionHistoryOpen(false)}
          loadChanges={async () => (
            await runtime.listWorkflowDefinitionChanges(workflowUuid)
          ).items}
        />
      ) : null}
    </>
  )
}

interface ToolbarState {
  disabled: boolean
  reason: string
}

function saveToolbarState({
  aggregate,
  busy,
  dirty,
  fullSourceDiff,
  pendingMode,
  remoteConflict,
  runtimeBusy,
  workflowStartBusy
}: Pick<
  PersistentWorkflowAuthoringModel,
  | 'aggregate'
  | 'busy'
  | 'dirty'
  | 'fullSourceDiff'
  | 'pendingMode'
  | 'remoteConflict'
  | 'runtimeBusy'
  | 'workflowStartBusy'
>): ToolbarState {
  const disabled = Boolean(
    !dirty || busy || runtimeBusy || workflowStartBusy || !aggregate ||
    fullSourceDiff || pendingMode || remoteConflict
  )
  const reason = busy || runtimeBusy || workflowStartBusy
    ? '正在处理工作流，请稍候再保存'
    : !aggregate
      ? '工作流尚未加载完成'
      : fullSourceDiff || pendingMode || remoteConflict
        ? '请先完成当前工作流确认操作'
        : '当前工作流没有待保存修改'
  return { disabled, reason }
}

function publishToolbarState({
  aggregate,
  busy,
  dirty,
  fullSourceDiff,
  pendingMode,
  remoteConflict,
  runtimeBusy,
  workflowStartBusy
}: Pick<
  PersistentWorkflowAuthoringModel,
  | 'aggregate'
  | 'busy'
  | 'dirty'
  | 'fullSourceDiff'
  | 'pendingMode'
  | 'remoteConflict'
  | 'runtimeBusy'
  | 'workflowStartBusy'
>): ToolbarState {
  const disabled = Boolean(
    !aggregate?.candidate || dirty || busy || runtimeBusy ||
    workflowStartBusy || fullSourceDiff || pendingMode || remoteConflict
  )
  const reason = !aggregate?.candidate
    ? '当前没有可发布的工作流候选版本'
    : dirty
      ? '请先保存当前工作流修改'
      : busy || runtimeBusy || workflowStartBusy
        ? '正在处理工作流，请稍候再发布'
        : fullSourceDiff || pendingMode || remoteConflict
          ? '请先完成当前工作流确认操作'
          : '当前工作流暂时不能发布'
  return { disabled, reason }
}

function startToolbarState({
  aggregate,
  busy,
  runtimeBusy,
  workflowStartBusy,
  workflowStartPresentation
}: Pick<
  PersistentWorkflowAuthoringModel,
  | 'aggregate'
  | 'busy'
  | 'runtimeBusy'
  | 'workflowStartBusy'
  | 'workflowStartPresentation'
>): ToolbarState {
  const disabled = Boolean(
    !aggregate || busy || runtimeBusy || workflowStartBusy ||
    workflowStartPresentation.disabled
  )
  const reason = busy
    ? '正在处理工作流编写操作，请稍候'
    : runtimeBusy || workflowStartBusy
      ? '正在处理工作流任务，请稍候'
      : workflowStartPresentation.disabledReason ?? '工作流尚未就绪'
  return { disabled, reason }
}

function workflowSummary(
  workflowUuid: string,
  workflowName: string | undefined,
  aggregate: PersistentWorkflowAuthoringModel['aggregate']
): WorkflowSummary {
  return {
    uuid: workflowUuid,
    create_time: '',
    update_time: '',
    meta_data: { unilab: { definition_kind: 'operation' } },
    name: workflowName || '当前实验操作',
    tags: [],
    revision: aggregate?.workflow_revision ?? 0,
    definition_status: aggregate ? 'configured' : 'empty'
  }
}
