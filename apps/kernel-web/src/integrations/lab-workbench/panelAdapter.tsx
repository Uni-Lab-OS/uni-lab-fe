import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useRef
} from 'react'
import {
  CANONICAL_PANEL_MANIFEST,
  createPanelCapabilityUnavailable,
  createPanelRegistry,
  parsePanelLayoutDocument,
  usePanelVisibility,
  type PanelAppAdapter,
  type PanelRendererProps,
  type PanelStoragePort
} from '@unilab/workbench-layout'
import {
  MaterialCapabilityNotice,
  MaterialWorkbench
} from '@unilab/material'
import { useServices, type Services } from '@unilab/services'
import {
  createWorkflowResourceSlotOptionsPort,
  WorkflowPanel,
  workflowMaterialRoleLabel,
  type WorkflowCatalogState,
  type WorkflowPanelRuntimeProjection,
  type WorkflowResourceSlotOptionsPort
} from '@unilab/workflow-editor'
import { useStore } from 'zustand'
import {
  useLabInteractionStore
} from './LabInteractionProvider'
import { useMaterialRuntime } from './MaterialRuntimeProvider'
import type { LabInteractionStore } from './interactionStore'
import {
  UnifiedLabViewport,
  type LabViewMode
} from './UnifiedLabViewport'
import { workflowUuidFromPanelConfig } from './workflowSessions'

export interface LabPanelScope {
  services: Services
  interaction: LabInteractionStore
  workflowCatalogRequestRevision: number
  recoveryRevision: number
  onWorkflowCatalogStateChange?: (state: WorkflowCatalogState) => void
  onWorkflowUnsavedChangesChange?: (
    sessionId: string,
    hasUnsavedChanges: boolean
  ) => void
}

const PANEL_TITLES: Readonly<Record<string, string>> = {
  'layout-unified': '实验室视图',
  'layout-2d': '二维物料',
  'layout-3d': '三维场景',
  'workflow-dag': '工作流',
  'workflow-steps': '工作流步骤',
  'workflow-dag-picker': '工作流调试'
}

const registry = createPanelRegistry(
  CANONICAL_PANEL_MANIFEST.map((definition) => ({
    ...definition,
    title: PANEL_TITLES[definition.id] ?? definition.title
  }))
)
const SceneWorkbench = lazy(async () => {
  const module = await import('./SceneWorkbench')
  return { default: module.SceneWorkbench }
})

const storage: PanelStoragePort = {
  load: (key) => {
    const value = globalThis.localStorage?.getItem(key)
    return value ? JSON.parse(value) : null
  },
  save: (key, document) => {
    globalThis.localStorage?.setItem(key, JSON.stringify(document))
  }
}

/**
 * 将物料（Material）面板接入共享实验室视图与跨面板可见性意图。
 *
 * @param props 面板实例、服务、交互 Store 与统一视图开关。
 * @returns 独立物料工作台或复用同一投影的统一实验室视图。
 */
function MaterialRenderer(
  props: PanelRendererProps<LabPanelScope> & {
    unified?: boolean
  }
): React.JSX.Element {
  const runtime = useMaterialRuntime()
  const selectedMaterialIds = useStore(
    props.scope.interaction,
    (state) => state.selectedMaterialIds
  )
  const highlightedMaterialIds = useStore(
    props.scope.interaction,
    (state) => state.highlightedMaterialIds
  )
  const workflowMaterialTransferRoutes = useStore(
    props.scope.interaction,
    (state) => state.activeWorkflowMaterialTransferRoutes
  )
  const visibleMaterialRoles = useStore(
    props.scope.interaction,
    (state) => state.activeWorkflowVisibleMaterialRoles
  )
  const activeWorkflowPanelId = useStore(
    props.scope.interaction,
    (state) => state.activeWorkflowPanelId
  )
  const materialRoleOptions = useMemo(() => {
    const options = new Map<string, {
      value: string
      label: string
      accent: string
      lineageKeys: Set<string>
    }>()
    for (const route of workflowMaterialTransferRoutes) {
      const current = options.get(route.materialRole)
      if (current) {
        current.lineageKeys.add(route.materialLineageKey)
      } else {
        options.set(route.materialRole, {
          value: route.materialRole,
          label: workflowMaterialRoleLabel(route.materialRole),
          accent: route.accent,
          lineageKeys: new Set([route.materialLineageKey])
        })
      }
    }
    return [...options.values()].map(({ lineageKeys, ...option }) => ({
      ...option,
      lineageCount: lineageKeys.size
    }))
  }, [workflowMaterialTransferRoutes])
  /**
   * 从统一实验室视图发布物料流角色（MaterialFlowRole）可见性。
   *
   * @param nextVisibleRoles 可见角色数组；null 表示全部可见。
   * @returns 无返回值；没有活动工作流面板时拒绝更新。
   */
  const publishVisibleMaterialRoles = useCallback((
    nextVisibleRoles: readonly string[] | null
  ): void => {
    if (!activeWorkflowPanelId) return
    props.scope.interaction.getState().setWorkflowVisibleMaterialRoles(
      activeWorkflowPanelId,
      nextVisibleRoles
    )
  }, [activeWorkflowPanelId, props.scope.interaction])

  if (!runtime.store || !runtime.scope) {
    const unavailableNotice = (
      <MaterialCapabilityNotice
        title="请选择实验室"
        status={{
          available: false,
          reason: '当前服务配置使用实验室范围，请先选择实验室'
        }}
      />
    )
    return props.unified ? (
      <UnifiedLabViewport renderView={() => unavailableNotice} />
    ) : unavailableNotice
  }

  return (
    <MaterialWorkbench
      catalog={props.scope.services.materials}
      profileId={`${props.scope.services.backend.id}:${props.scope.services.backend.apiUrl}`}
      scope={runtime.scope}
      capabilities={{
        readTemplates: runtime.getStatus('material.readTemplates'),
        readGraph: runtime.getStatus('material.readGraph'),
        create: runtime.getStatus('material.create'),
        updateConfig: runtime.getStatus('material.updateConfig'),
        move: runtime.getStatus('material.move'),
        attach: runtime.getStatus('material.attach'),
        detach: runtime.getStatus('material.detach')
      }}
      selectedMaterialIds={selectedMaterialIds}
      highlightedMaterialIds={highlightedMaterialIds}
      onSelectionChange={(materialIds) => {
        props.scope.interaction.getState().selectMaterials(materialIds)
      }}
      renderViewport={
        props.unified
          ? (viewportProps) => (
              <UnifiedLabViewport
                visibleMaterialRoles={visibleMaterialRoles}
                materialRoleOptions={materialRoleOptions}
                onVisibleMaterialRolesChange={publishVisibleMaterialRoles}
                renderView={(
                  viewMode,
                  {
                    showSites,
                    showMaterialTransfers,
                    showMaterialLabels
                  }
                ) => (
                  <SceneRenderer
                    {...props}
                    attachStatus={viewportProps.attachStatus}
                    detachStatus={viewportProps.detachStatus}
                    focusRequest={viewportProps.focusRequest}
                    listDragMaterialId={viewportProps.listDragMaterialId}
                    onHandlingChange={viewportProps.onHandlingChange}
                    viewMode={viewMode}
                    showSites={showSites}
                    showMaterialTransfers={showMaterialTransfers}
                    showMaterialLabels={showMaterialLabels}
                  />
                )}
              />
            )
          : undefined
      }
    />
  )
}

/**
 * 将工作流（Workflow）面板接入共享运行投影、选择与物料角色显隐意图。
 *
 * @param props 面板实例、工作流服务、物料服务与跨面板交互 Store。
 * @returns 使用唯一工作流编辑器所有者的持久编写面板。
 */
function WorkflowRenderer(
  props: PanelRendererProps<LabPanelScope>
): React.JSX.Element {
  const materialRuntime = useMaterialRuntime()
  const panelVisible = usePanelVisibility()
  const panelId = props.panelInstance.id
  const visibleMaterialRoles = useStore(
    props.scope.interaction,
    (state) => state.activeWorkflowVisibleMaterialRoles
  )
  const workflowProjectionRef = useRef<WorkflowPanelRuntimeProjection | null>(
    null
  )
  const resourceSlotOptionsPort = useMemo(
    () => createWorkflowResourceSlotOptionsPort(
      props.scope.services.materials,
      materialRuntime.scope
    ),
    [materialRuntime.scope, props.scope.services.materials]
  )
  /** 发布当前可见工作流（Workflow）的稳定身份，并恢复该面板最后一份路线投影。 */
  const publishActiveWorkflow = useCallback(
    (workflowUuid: string | null): void => {
      const interaction = props.scope.interaction.getState()
      if (workflowUuid) {
        interaction.activateWorkflowPanel(panelId, workflowUuid)
        if (workflowProjectionRef.current?.workflowUuid === workflowUuid) {
          interaction.publishWorkflowRuntime(
            panelId,
            workflowProjectionRef.current
          )
        }
      } else {
        interaction.deactivateWorkflowPanel(panelId)
      }
    },
    [panelId, props.scope.interaction]
  )
  /** 缓存并发布工作流面板拥有的任务身份、代次和只读物料转运路线。 */
  const publishWorkflowRuntime = useCallback(
    (projection: WorkflowPanelRuntimeProjection | null): void => {
      workflowProjectionRef.current = projection
      if (!projection) return
      props.scope.interaction.getState().publishWorkflowRuntime(
        panelId,
        projection
      )
    },
    [panelId, props.scope.interaction]
  )
  /** 发布当前面板选中的工作流节点身份；非所有者更新由交互 Store 拒绝。 */
  const publishSelectedWorkflowStep = useCallback(
    (workflowNodeUuid: string | null): void => {
      props.scope.interaction.getState().selectWorkflowStep(
        panelId,
        workflowNodeUuid
      )
    },
    [panelId, props.scope.interaction]
  )
  /** 发布物料流角色（MaterialFlowRole）显隐，使画布与场景共享同一投影。 */
  const publishVisibleMaterialRoles = useCallback(
    (nextVisibleRoles: readonly string[] | null): void => {
      props.scope.interaction.getState().setWorkflowVisibleMaterialRoles(
        panelId,
        nextVisibleRoles
      )
    },
    [panelId, props.scope.interaction]
  )
  return (
    <WorkflowPanel
      runtime={props.scope.services.workflow}
      authoringStatus={props.scope.services.getCapabilityStatus(
        'workflow.authoring'
      )}
      runStatus={props.scope.services.getCapabilityStatus(
        'workflow.runTasks'
      )}
      resourceSlotOptionsPort={resourceSlotOptionsPort}
      workflowUuid={workflowUuidFromPanelConfig(props.config) ?? undefined}
      active={panelVisible}
      traceRuntime={globalThis.window?.api?.observability}
      activeWorkflowStorageKey={`unilab.workflow.active.${
        encodeURIComponent(
          `${props.scope.services.backend.id}:${
            props.scope.services.backend.apiUrl
          }`
        )
      }.v1`}
      catalogRequestRevision={props.scope.workflowCatalogRequestRevision}
      recoveryRevision={props.scope.recoveryRevision}
      onCatalogStateChange={props.scope.onWorkflowCatalogStateChange}
      onUnsavedChangesChange={(hasUnsavedChanges) => {
        props.scope.onWorkflowUnsavedChangesChange?.(
          props.panelInstance.id,
          hasUnsavedChanges
        )
      }}
      onActiveWorkflowChange={publishActiveWorkflow}
      onWorkflowRuntimeProjectionChange={publishWorkflowRuntime}
      onSelectedWorkflowStepChange={publishSelectedWorkflowStep}
      visibleMaterialRoles={visibleMaterialRoles}
      onVisibleMaterialRolesChange={publishVisibleMaterialRoles}
    />
  )
}

function SceneRenderer(
  props: PanelRendererProps<LabPanelScope> & {
    viewMode?: LabViewMode
    showSites?: boolean
    showMaterialLabels?: boolean
    showMaterialTransfers?: boolean
    attachStatus?: import('@unilab/material').CapabilityStatus
    detachStatus?: import('@unilab/material').CapabilityStatus
    focusRequest?: import('@unilab/material').MaterialFocusRequest | null
    listDragMaterialId?: string | null
    onHandlingChange?: (active: boolean) => void
  }
): React.JSX.Element {
  const runtime = useMaterialRuntime()
  if (!runtime.store || !runtime.scope) {
    return (
      <MaterialCapabilityNotice
        title="请选择实验室"
        status={{
          available: false,
          reason: '当前服务配置使用实验室范围，请先选择实验室'
        }}
      />
    )
  }
  const readStatus = runtime.getStatus('material.readGraph')
  if (!readStatus.available) {
    return (
      <MaterialCapabilityNotice
        title="三维物料场景不可用"
        status={readStatus}
      />
    )
  }
  return (
    <Suspense
      fallback={<div className="app-loading">正在加载 3D 编辑器…</div>}
    >
      <SceneWorkbench
        attachStatus={props.attachStatus}
        detachStatus={props.detachStatus}
        focusRequest={props.focusRequest}
        listDragMaterialId={props.listDragMaterialId}
        onHandlingChange={props.onHandlingChange}
        showSites={props.showSites}
        showMaterialLabels={props.showMaterialLabels}
        showMaterialTransfers={props.showMaterialTransfers}
        viewMode={props.viewMode}
      />
    </Suspense>
  )
}

function UnifiedLayoutRenderer(
  props: PanelRendererProps<LabPanelScope>
): React.JSX.Element {
  return <MaterialRenderer {...props} unified />
}

/**
 * The app adapter is the only place where feature packages meet each other.
 * workbench-layout stays application-neutral and each feature remains independently
 * testable.
 */
export function useLabPanelAdapter(
  onWorkflowUnsavedChangesChange?: (
    sessionId: string,
    hasUnsavedChanges: boolean
  ) => void,
  workflowCatalogRequestRevision = 0,
  recoveryRevision = 0,
  onWorkflowCatalogStateChange?: (state: WorkflowCatalogState) => void
): PanelAppAdapter<LabPanelScope> {
  const services = useServices()
  const interaction = useLabInteractionStore()
  const workflowCatalogRequestRevisionRef = useRef(
    workflowCatalogRequestRevision
  )
  // 导航命令变化不能重建适配器，否则面板宿主会卸载并丢失本次命令。
  workflowCatalogRequestRevisionRef.current = workflowCatalogRequestRevision
  const recoveryRevisionRef = useRef(recoveryRevision)
  recoveryRevisionRef.current = recoveryRevision

  return useMemo<PanelAppAdapter<LabPanelScope>>(
    () => ({
      registry,
      storage,
      parseLayout: parsePanelLayoutDocument,
      scope: {
        resolve: () => ({
          services,
          interaction,
          workflowCatalogRequestRevision:
            workflowCatalogRequestRevisionRef.current,
          recoveryRevision: recoveryRevisionRef.current,
          onWorkflowCatalogStateChange,
          onWorkflowUnsavedChangesChange
        })
      },
      renderers: {
        resolve: (panelInstance) => {
          if (panelInstance.panelType === 'layout-unified') {
            return { status: 'ready', Renderer: UnifiedLayoutRenderer }
          }
          if (panelInstance.panelType === 'layout-2d') {
            return { status: 'ready', Renderer: MaterialRenderer }
          }
          if (
            panelInstance.panelType === 'workflow-dag' ||
            panelInstance.panelType === 'workflow-steps' ||
            panelInstance.panelType === 'workflow-dag-picker'
          ) {
            return { status: 'ready', Renderer: WorkflowRenderer }
          }
          if (panelInstance.panelType === 'layout-3d') {
            return { status: 'ready', Renderer: SceneRenderer }
          }
          return createPanelCapabilityUnavailable(
            panelInstance.panelType,
            '该面板能力尚未完成迁移'
          )
        }
      }
    }),
    [
      interaction,
      onWorkflowCatalogStateChange,
      onWorkflowUnsavedChangesChange,
      services
    ]
  )
}
