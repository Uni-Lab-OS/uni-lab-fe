import {
  createWorkflowDefinitionPort,
  type CapabilityStatus,
  type WorkflowDefinitionKind,
  type WorkflowDefinitionAuthority,
  type WorkflowRuntimePort
} from '@unilab/services'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { WorkflowTracePort } from '../traceRuntime'
import type { WorkflowPanelRuntimeProjection } from '../workflowPanelProjection'
import {
  usePersistentWorkflowAuthoring,
  type PersistentWorkflowAuthoringOptions
} from '../hooks/usePersistentWorkflowAuthoring'
import type { WorkflowResourceSlotOptionsPort } from '../utils/workflowResourceSlotOptions'
import type { WorkflowIdeBridge } from '../utils/workflowSourceNavigation'
import type {
  WorkflowCanvasBreadcrumb,
  WorkflowCanvasNavigationState
} from '../utils/workflowCanvasCommands'
import type { WorkflowEditMode } from '../utils/workflowCanvasPolicy'
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
  initialMode?: WorkflowEditMode
  workflowUuid: string
  workflowName?: string
  definitionKind?: WorkflowDefinitionKind
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
  onSelectWorkflow?: (workflowUuid: string, workflowName: string) => void
  onOpenChildWorkflow?: (
    workflowUuid: string,
    workflowName: string,
    parentState: WorkflowCanvasNavigationState
  ) => void
  workflowBreadcrumbs?: readonly WorkflowCanvasBreadcrumb[]
  onNavigateBreadcrumb?: (index: number) => void
  restoreCanvasState?: WorkflowCanvasNavigationState | null
  ideBridge?: WorkflowIdeBridge
  hideEmbeddedCodeEditor?: boolean
  hideAuthoringToolbar?: boolean
  hideCanvasSidebars?: boolean
  hideRuntimeControls?: boolean
  recoveryRevision?: number
  onResetEnvironment?: () => Promise<void>
  environmentResetBusy?: boolean
  debugLayout?: boolean
}

type AuthoringModel = ReturnType<typeof usePersistentWorkflowAuthoring>
interface SessionSnapshot {
  model: AuthoringModel
  props: PersistentWorkflowAuthoringPanelProps
}

/** 界面保持挂载，会话按工作流隔离；新数据就绪前保留旧画面并锁定交互。 */
export function PersistentWorkflowAuthoringPanel(
  props: PersistentWorkflowAuthoringPanelProps
): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const requestedWorkflow = useRef(props.workflowUuid)
  requestedWorkflow.current = props.workflowUuid
  const publish = useCallback((next: SessionSnapshot) => {
    if (next.props.workflowUuid !== requestedWorkflow.current) return
    setSnapshot(previous => {
      if (previous && previous.props.workflowUuid !== next.props.workflowUuid &&
          next.model.busy && !next.model.aggregate) return previous
      return next
    })
  }, [])
  const switching = snapshot !== null && snapshot.props.workflowUuid !== props.workflowUuid
  return (
    <>
      <AuthoringSession key={props.workflowUuid} sourceProps={props} publish={publish} />
      <div style={{ display: 'contents' }} inert={switching} aria-busy={switching}>
        {snapshot && <AuthoringSessionView {...snapshot} />}
      </div>
    </>
  )
}

/** 只有会话重建，旧订阅和异步请求随卸载清理，不能更新新工作流。 */
const AuthoringSession = memo(function AuthoringSession({ sourceProps: props, publish }: {
  sourceProps: PersistentWorkflowAuthoringPanelProps
  publish: (snapshot: SessionSnapshot) => void
}): null {
  const definitionPort = useMemo(
    () => createWorkflowDefinitionPort(
      props.runtime, props.definitionAuthority ?? 'workspace', props.workflowUuid
    ),
    [props.definitionAuthority, props.runtime, props.workflowUuid]
  )
  const model = usePersistentWorkflowAuthoring(
    { ...props, definitionPort } satisfies PersistentWorkflowAuthoringOptions
  )
  useLayoutEffect(() => { publish({ model, props }) }, [model, props, publish])
  const onDiagnosticsChange = props.ideBridge?.onDiagnosticsChange
  useEffect(() => {
    onDiagnosticsChange?.(projectWorkflowIdeDiagnostics(model.aggregate, model.sourceProjection))
    return () => onDiagnosticsChange?.([])
  }, [model.aggregate, model.sourceProjection, onDiagnosticsChange])
  return null
})

function AuthoringSessionView({ model, props }: SessionSnapshot): React.JSX.Element {
  return (
    <PersistentWorkflowAuthoringView
      model={model}
      debugLayout={props.debugLayout}
      workflowName={props.workflowName}
      definitionKind={props.definitionKind}
      onSelectWorkflow={props.onSelectWorkflow}
      onOpenChildWorkflow={props.onOpenChildWorkflow}
      workflowBreadcrumbs={props.workflowBreadcrumbs}
      onNavigateBreadcrumb={props.onNavigateBreadcrumb}
      restoreCanvasState={props.restoreCanvasState}
      visibleMaterialRoles={props.visibleMaterialRoles}
      onVisibleMaterialRolesChange={props.onVisibleMaterialRolesChange}
      hideEmbeddedCodeEditor={props.hideEmbeddedCodeEditor}
      hideAuthoringToolbar={props.hideAuthoringToolbar}
      hideCanvasSidebars={props.hideCanvasSidebars}
      hideRuntimeControls={props.hideRuntimeControls}
      onResetEnvironment={props.onResetEnvironment}
      environmentResetBusy={props.environmentResetBusy}
    />
  )
}
