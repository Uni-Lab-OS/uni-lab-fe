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
  WorkflowPanel,
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
        move: runtime.getStatus('material.move')
      }}
      selectedMaterialIds={selectedMaterialIds}
      highlightedMaterialIds={highlightedMaterialIds}
      onSelectionChange={(materialIds) => {
        props.scope.interaction.getState().selectMaterials(materialIds)
      }}
      renderViewport={
        props.unified
          ? (_viewportProps) => (
              <UnifiedLabViewport
                renderView={(
                  viewMode,
                  { showSites, showMaterialTransfers }
                ) => (
                  <SceneRenderer
                    {...props}
                    viewMode={viewMode}
                    showSites={showSites}
                    showMaterialTransfers={showMaterialTransfers}
                  />
                )}
              />
            )
          : undefined
      }
    />
  )
}

function WorkflowRenderer(
  props: PanelRendererProps<LabPanelScope>
): React.JSX.Element {
  const materialRuntime = useMaterialRuntime()
  const panelVisible = usePanelVisibility()
  const panelId = props.panelInstance.id
  const workflowProjectionRef = useRef<WorkflowPanelRuntimeProjection | null>(
    null
  )
  const resourceSlotOptionsPort = useMemo<WorkflowResourceSlotOptionsPort>(
    () => ({
      list: async () => {
        if (!materialRuntime.scope) {
          throw new Error('请先选择实验室，再选择 Material ResourceSlot')
        }
        const aggregates = await props.scope.services.materials.getGraph(
          materialRuntime.scope
        )
        return aggregates.map(({ material }) => ({
          materialUuid: material.id,
          resourceTemplateUuid: material.sourceTemplateId,
          displayLabel: `${material.name} · ${material.id}`
        }))
      }
    }),
    [materialRuntime.scope, props.scope.services.materials]
  )
  /** 发布当前可见工作流（Workflow）的稳定身份，并恢复该面板最后一份路线投影。 */
  const publishActiveWorkflow = useCallback(
    (workflowUuid: string | null): void => {
      const interaction = props.scope.interaction.getState()
      if (workflowUuid) {
        interaction.activateWorkflowPanel(panelId, workflowUuid)
        if (workflowProjectionRef.current) {
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
  return (
    <WorkflowPanel
      runtime={props.scope.services.workflow}
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
      onUnsavedChangesChange={(hasUnsavedChanges) => {
        props.scope.onWorkflowUnsavedChangesChange?.(
          props.panelInstance.id,
          hasUnsavedChanges
        )
      }}
      onActiveWorkflowChange={publishActiveWorkflow}
      onWorkflowRuntimeProjectionChange={publishWorkflowRuntime}
      onSelectedWorkflowStepChange={publishSelectedWorkflowStep}
    />
  )
}

function SceneRenderer(
  props: PanelRendererProps<LabPanelScope> & {
    viewMode?: LabViewMode
    showSites?: boolean
    showMaterialTransfers?: boolean
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
        showSites={props.showSites}
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
  workflowCatalogRequestRevision = 0
): PanelAppAdapter<LabPanelScope> {
  const services = useServices()
  const interaction = useLabInteractionStore()
  const workflowCatalogRequestRevisionRef = useRef(
    workflowCatalogRequestRevision
  )
  // 导航命令变化不能重建适配器，否则面板宿主会卸载并丢失本次命令。
  workflowCatalogRequestRevisionRef.current = workflowCatalogRequestRevision

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
      onWorkflowUnsavedChangesChange,
      services
    ]
  )
}
