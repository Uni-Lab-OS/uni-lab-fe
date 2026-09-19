import { useEffect, useRef, useState } from 'react'

import type {
  CapabilityStatus,
  WorkflowRuntimePort
} from '@unilab/services'
import { workflowDefinitionKind } from '@unilab/services'

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
import type {
  WorkflowCanvasBreadcrumb,
  WorkflowCanvasNavigationState
} from '../utils/workflowCanvasCommands'
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
  /** 宿主可把子工作流导航到独立的实验操作调试界面。 */
  onOpenChildWorkflow?: (workflowUuid: string, workflowName: string) => void
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
  hideCanvasSidebars?: boolean
  hideRuntimeControls?: boolean
  allowWorkflowSelection?: boolean
  onResetEnvironment?: () => Promise<void>
  environmentResetBusy?: boolean
  debugLayout?: boolean
  catalogOnly?: boolean
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
  workflowName: explicitWorkflowName = '',
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
  onOpenChildWorkflow,
  onWorkflowRuntimeProjectionChange,
  onSelectedWorkflowStepChange,
  onCatalogStateChange,
  visibleMaterialRoles,
  onVisibleMaterialRolesChange,
  ideBridge,
  hideEmbeddedCodeEditor = false,
  hideCanvasSidebars = false,
  hideRuntimeControls = false,
  allowWorkflowSelection = false,
  onResetEnvironment,
  environmentResetBusy = false,
  debugLayout = false,
  catalogOnly = false
}: WorkflowPanelProps): React.JSX.Element {
  const [selectedWorkflowUuid, setSelectedWorkflowUuid] = useState<
    string | null
  >(null)
  const [selectedWorkflowName, setSelectedWorkflowName] = useState('')
  const [showCatalog, setShowCatalog] = useState(false)
  const [workflowBreadcrumbs, setWorkflowBreadcrumbs] = useState<
    WorkflowCanvasBreadcrumb[]
  >([])
  const [canvasRestoreByWorkflow, setCanvasRestoreByWorkflow] = useState<
    Readonly<Record<string, WorkflowCanvasNavigationState>>
  >({})
  const handledCatalogRequestRevision = useRef(catalogRequestRevision)
  const authoringAvailable = authoringStatus?.available !== false
  const runAvailable = runStatus?.available === true
  const workflowSelectable = authoringAvailable || runAvailable
  const workflowUuid = catalogOnly || !workflowSelectable || showCatalog
    ? null
    : (allowWorkflowSelection ? selectedWorkflowUuid : null) ||
      explicitWorkflowUuid || selectedWorkflowUuid ||
      readActiveWorkflowId(activeWorkflowStorageKey)
  const activateWorkflow = (
    nextWorkflowUuid: string,
    nextWorkflowName: string
  ): void => {
    persistActiveWorkflowId(activeWorkflowStorageKey, nextWorkflowUuid)
    setSelectedWorkflowUuid(nextWorkflowUuid)
    setSelectedWorkflowName(nextWorkflowName)
    setShowCatalog(false)
  }
  const selectWorkflow = (
    nextWorkflowUuid: string,
    nextWorkflowName: string
  ): void => {
    setWorkflowBreadcrumbs([])
    activateWorkflow(nextWorkflowUuid, nextWorkflowName)
  }

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

  useEffect(() => {
    if (catalogOnly || !debugLayout || !active || workflowUuid || showCatalog || !workflowSelectable) return
    let disposed = false
    void runtime.listWorkflows({ page: 1, page_size: 100 }).then((page) => {
      if (disposed) return
      const workflow = page.items.filter((item) => workflowDefinitionKind(item) === 'workflow')
        .sort((left, right) => right.update_time.localeCompare(left.update_time))[0]
      if (!workflow) return
      persistActiveWorkflowId(activeWorkflowStorageKey, workflow.uuid)
      setSelectedWorkflowUuid(workflow.uuid)
      setSelectedWorkflowName(workflow.name)
    }).catch(() => {
      // 目录组件保留统一的读取失败提示与重试入口。
    })
    return () => { disposed = true }
  }, [active, activeWorkflowStorageKey, catalogOnly, debugLayout, runtime, showCatalog, workflowSelectable, workflowUuid])

  if (workflowUuid && isWorkflowUuid(workflowUuid)) {
    const definitionAuthority = definitionEditingMode === 'backend' ||
      (!authoringAvailable && runAvailable)
      ? 'backend'
      : 'workspace'
    return (
      <PersistentWorkflowAuthoringPanel
        key={debugLayout ? definitionAuthority : `${workflowUuid}:${definitionAuthority}`}
        runtime={runtime}
        debugLayout={debugLayout}
        initialMode={debugLayout ? 'canvas' : undefined}
        active={active}
        definitionAuthority={definitionAuthority}
        definitionEditingStatus={authoringStatus}
        workflowUuid={workflowUuid}
        workflowName={explicitWorkflowName || selectedWorkflowName}
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
        hideCanvasSidebars={hideCanvasSidebars}
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
        onSelectWorkflow={explicitWorkflowUuid && !allowWorkflowSelection
          ? undefined
          : selectWorkflow}
        onOpenChildWorkflow={explicitWorkflowUuid && !allowWorkflowSelection
          ? undefined
          : (childWorkflowUuid, childWorkflowName, parentState) => {
              if (onOpenChildWorkflow) {
                onOpenChildWorkflow(childWorkflowUuid, childWorkflowName)
                return
              }
              setCanvasRestoreByWorkflow((current) => ({
                ...current,
                [workflowUuid]: parentState
              }))
              setWorkflowBreadcrumbs((current) => [
                ...current,
                {
                  workflowUuid,
                  workflowName: selectedWorkflowName || workflowUuid
                }
              ])
              activateWorkflow(childWorkflowUuid, childWorkflowName)
            }}
        workflowBreadcrumbs={workflowBreadcrumbs}
        onNavigateBreadcrumb={workflowBreadcrumbs.length > 0
          ? (index) => {
              const target = workflowBreadcrumbs[index]
              if (!target) return
              setWorkflowBreadcrumbs((current) => current.slice(0, index))
              activateWorkflow(target.workflowUuid, target.workflowName)
            }
          : undefined}
        restoreCanvasState={canvasRestoreByWorkflow[workflowUuid] ?? null}
        onResetEnvironment={onResetEnvironment}
        environmentResetBusy={environmentResetBusy}
      />
    )
  }

  return (
    <WorkflowCatalog
      creationEntryVisible={debugLayout ? true : undefined}
      runtime={runtime}
      activeWorkflowStorageKey={activeWorkflowStorageKey}
      recoveryRevision={recoveryRevision}
      authoringStatus={authoringStatus}
      runStatus={runStatus}
      onStateChange={onCatalogStateChange}
      onSelect={catalogOnly
        ? undefined
        : workflowSelectable
          ? selectWorkflow
          : undefined}
    />
  )
}

/** 验证可进入工作流编写上下文的稳定 UUID。 */
function isWorkflowUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)
}
