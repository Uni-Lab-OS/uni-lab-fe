import {
  createWorkflowDefinitionPort,
  type CapabilityStatus,
  type WorkflowDefinitionAuthority,
  type WorkflowRuntimePort
} from '@unilab/services'
import { useEffect, useMemo } from 'react'

import type { WorkflowTracePort } from '../traceRuntime'
import type { WorkflowPanelRuntimeProjection } from '../workflowPanelProjection'
import {
  usePersistentWorkflowAuthoring,
  type PersistentWorkflowAuthoringOptions
} from '../hooks/usePersistentWorkflowAuthoring'
import type { WorkflowResourceSlotOptionsPort } from '../utils/workflowResourceSlotOptions'
import type { WorkflowIdeBridge } from '../utils/workflowSourceNavigation'
import { projectWorkflowIdeDiagnostics } from '../utils/workflowSourceNavigation'
import { PersistentWorkflowAuthoringView } from './PersistentWorkflowAuthoringView'

export {
  filterMaterialSourceSites,
  MaterialSourceInspector
} from './MaterialSourceInspector'
export type {
  MaterialSourceInspectorProps
} from './MaterialSourceInspector'

interface PersistentWorkflowAuthoringPanelProps {
  runtime: WorkflowRuntimePort
  active?: boolean
  definitionAuthority?: WorkflowDefinitionAuthority
  definitionEditingStatus?: CapabilityStatus
  workflowUuid: string
  workflowName?: string
  traceRuntime?: WorkflowTracePort
  resourceSlotOptionsPort?: WorkflowResourceSlotOptionsPort
  executionStatus?: CapabilityStatus
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void
  onWorkflowRuntimeProjectionChange?: (
    projection: WorkflowPanelRuntimeProjection | null
  ) => void
  onSelectedWorkflowStepChange?: (workflowNodeUuid: string | null) => void
  visibleMaterialRoles?: readonly string[] | null
  onVisibleMaterialRolesChange?: (
    visibleMaterialRoles: readonly string[] | null
  ) => void
  onChooseWorkflow?: () => void
  ideBridge?: WorkflowIdeBridge
  hideEmbeddedCodeEditor?: boolean
  recoveryRevision?: number
  onResetEnvironment?: () => Promise<void>
  environmentResetBusy?: boolean
}

/**
 * 保留稳定的工作流编写面板入口，把会话状态与纯视图交给深模块处理。
 */
export function PersistentWorkflowAuthoringPanel(
  props: PersistentWorkflowAuthoringPanelProps
): React.JSX.Element {
  const definitionPort = useMemo(
    () => createWorkflowDefinitionPort(
      props.runtime,
      props.definitionAuthority ?? 'workspace',
      props.workflowUuid
    ),
    [props.definitionAuthority, props.runtime, props.workflowUuid]
  )
  const model = usePersistentWorkflowAuthoring(
    {
      ...props,
      definitionPort
    } satisfies PersistentWorkflowAuthoringOptions
  )
  const onDiagnosticsChange = props.ideBridge?.onDiagnosticsChange
  useEffect(() => {
    onDiagnosticsChange?.(projectWorkflowIdeDiagnostics(
      model.aggregate,
      model.sourceProjection
    ))
    return () => onDiagnosticsChange?.([])
  }, [model.aggregate, model.sourceProjection, onDiagnosticsChange])
  return (
    <PersistentWorkflowAuthoringView
      model={model}
      workflowName={props.workflowName}
      visibleMaterialRoles={props.visibleMaterialRoles}
      onVisibleMaterialRolesChange={props.onVisibleMaterialRolesChange}
      hideEmbeddedCodeEditor={props.hideEmbeddedCodeEditor}
      onResetEnvironment={props.onResetEnvironment}
      environmentResetBusy={props.environmentResetBusy}
    />
  )
}
