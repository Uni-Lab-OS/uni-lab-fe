import { useEffect, useRef, useState } from 'react'

import type {
  CapabilityStatus,
  WorkflowRuntimePort
} from '@unilab/services'

import type { WorkflowTracePort } from '../traceRuntime'
import type { WorkflowPanelRuntimeProjection } from '../workflowPanelProjection'
import type {
  WorkflowResourceSlotOptionsPort
} from '../utils/workflowResourceSlotOptions'
import {
  persistActiveWorkflowId,
  readActiveWorkflowId
} from '../utils/workflowAuthoringOperations'
import type { WorkflowIdeBridge } from '../utils/workflowSourceNavigation'
import {
  WorkflowCatalog,
  type WorkflowCatalogState
} from './WorkflowCatalog'
import { PersistentWorkflowAuthoringPanel } from './PersistentWorkflowAuthoringPanel'

export type { WorkflowCatalogState } from './WorkflowCatalog'
export {
  WORKFLOW_CATALOG_FILTER_CONTROLS_VISIBLE,
  WORKFLOW_CATALOG_MANAGEMENT_ACTIONS_VISIBLE,
  groupWorkflowCatalog,
  workflowGroupLabel
} from './WorkflowCatalog'

export interface WorkflowPanelProps {
  runtime: WorkflowRuntimePort
  workflowUuid?: string
  workflowName?: string
  traceRuntime?: WorkflowTracePort
  resourceSlotOptionsPort?: WorkflowResourceSlotOptionsPort
  activeWorkflowStorageKey?: string
  catalogRequestRevision?: number
  recoveryRevision?: number
  active?: boolean
  authoringStatus?: CapabilityStatus
  definitionEditingMode?: 'workspace' | 'backend'
  runStatus?: CapabilityStatus
  executionStatus?: CapabilityStatus
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void
  onActiveWorkflowChange?: (workflowUuid: string | null) => void
  onWorkflowRuntimeProjectionChange?: (
    projection: WorkflowPanelRuntimeProjection | null
  ) => void
  onSelectedWorkflowStepChange?: (workflowNodeUuid: string | null) => void
  onCatalogStateChange?: (state: WorkflowCatalogState) => void
  visibleMaterialRoles?: readonly string[] | null
  onVisibleMaterialRolesChange?: (
    visibleMaterialRoles: readonly string[] | null
  ) => void
  ideBridge?: WorkflowIdeBridge
  hideEmbeddedCodeEditor?: boolean
  hideRuntimeControls?: boolean
  allowWorkflowSelection?: boolean
  onResetEnvironment?: () => Promise<void>
  environmentResetBusy?: boolean
}

/**
 * 组合工作流（Workflow）目录或持久编写面板，并按宿主可见性发布跨面板投影。
 *
 * @param props 操作系统（OS）端口、可选固定工作流身份与宿主回调。
 * @returns 可独立挂载的工作流面板；隐藏面板不拥有跨面板发布权。
 */
export default function WorkflowPanel({
  runtime,
  workflowUuid: explicitWorkflowUuid,
  workflowName: explicitWorkflowName,
  traceRuntime,
  resourceSlotOptionsPort,
  activeWorkflowStorageKey,
  catalogRequestRevision = 0,
  recoveryRevision = 0,
  active = true,
  authoringStatus,
  definitionEditingMode = 'workspace',
  runStatus,
  executionStatus,
  onUnsavedChangesChange,
  onActiveWorkflowChange,
  onWorkflowRuntimeProjectionChange,
  onSelectedWorkflowStepChange,
  onCatalogStateChange,
  visibleMaterialRoles,
  onVisibleMaterialRolesChange,
  ideBridge,
  hideEmbeddedCodeEditor = false,
  hideRuntimeControls = false,
  allowWorkflowSelection = false,
  onResetEnvironment,
  environmentResetBusy = false
}: WorkflowPanelProps): React.JSX.Element {
  const [selectedWorkflowUuid, setSelectedWorkflowUuid] = useState<
    string | null
  >(null)
  const [selectedWorkflowName, setSelectedWorkflowName] = useState('')
  const [showCatalog, setShowCatalog] = useState(false)
  const handledCatalogRequestRevision = useRef(catalogRequestRevision)
  const authoringAvailable = authoringStatus?.available !== false
  const runAvailable = runStatus?.available === true
  const workflowSelectable = authoringAvailable || runAvailable
  const workflowUuid = !workflowSelectable || showCatalog
    ? null
    : (allowWorkflowSelection ? selectedWorkflowUuid : null) ||
      explicitWorkflowUuid || selectedWorkflowUuid ||
      readActiveWorkflowId(activeWorkflowStorageKey)

  useEffect(() => {
    if (
      explicitWorkflowUuid ||
      handledCatalogRequestRevision.current === catalogRequestRevision
    ) return
    handledCatalogRequestRevision.current = catalogRequestRevision
    persistActiveWorkflowId(activeWorkflowStorageKey, '')
    setSelectedWorkflowUuid(null)
    setShowCatalog(true)
  }, [activeWorkflowStorageKey, catalogRequestRevision, explicitWorkflowUuid])

  useEffect(() => {
    const activeWorkflowUuid = workflowUuid && isWorkflowUuid(workflowUuid)
      ? workflowUuid
      : null
    onActiveWorkflowChange?.(active ? activeWorkflowUuid : null)
    return () => onActiveWorkflowChange?.(null)
  }, [active, onActiveWorkflowChange, workflowUuid])

  if (workflowUuid && isWorkflowUuid(workflowUuid)) {
    const definitionAuthority = definitionEditingMode === 'backend' ||
      (!authoringAvailable && runAvailable)
      ? 'backend'
      : 'workspace'
    return (
      <PersistentWorkflowAuthoringPanel
        key={`${workflowUuid}:${definitionAuthority}`}
        runtime={runtime}
        definitionAuthority={definitionAuthority}
        definitionEditingStatus={authoringStatus}
        workflowUuid={workflowUuid}
        workflowName={selectedWorkflowName || explicitWorkflowName}
        traceRuntime={traceRuntime}
        resourceSlotOptionsPort={resourceSlotOptionsPort}
        executionStatus={executionStatus}
        onUnsavedChangesChange={onUnsavedChangesChange}
        onWorkflowRuntimeProjectionChange={active
          ? onWorkflowRuntimeProjectionChange
          : undefined}
        onSelectedWorkflowStepChange={onSelectedWorkflowStepChange}
        ideBridge={ideBridge}
        hideEmbeddedCodeEditor={hideEmbeddedCodeEditor}
        hideRuntimeControls={hideRuntimeControls}
        recoveryRevision={recoveryRevision}
        visibleMaterialRoles={visibleMaterialRoles}
        onVisibleMaterialRolesChange={onVisibleMaterialRolesChange}
        onChooseWorkflow={explicitWorkflowUuid && !allowWorkflowSelection
          ? undefined
          : () => {
              persistActiveWorkflowId(activeWorkflowStorageKey, '')
              setShowCatalog(true)
            }}
        onResetEnvironment={onResetEnvironment}
        environmentResetBusy={environmentResetBusy}
      />
    )
  }

  return (
    <WorkflowCatalog
      runtime={runtime}
      activeWorkflowStorageKey={activeWorkflowStorageKey}
      recoveryRevision={recoveryRevision}
      authoringStatus={authoringStatus}
      runStatus={runStatus}
      onStateChange={onCatalogStateChange}
      onSelect={workflowSelectable
        ? (nextWorkflowUuid, nextWorkflowName) => {
            persistActiveWorkflowId(activeWorkflowStorageKey, nextWorkflowUuid)
            setSelectedWorkflowUuid(nextWorkflowUuid)
            setSelectedWorkflowName(nextWorkflowName)
            setShowCatalog(false)
          }
        : undefined}
    />
  )
}

/** 验证可进入工作流编写上下文的稳定 UUID。 */
function isWorkflowUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)
}
