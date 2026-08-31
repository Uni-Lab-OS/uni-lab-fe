import {
  MaterialCapabilityNotice,
  useMaterialStore,
  useMaterialStoreApi,
  type CapabilityStatus,
  type MaterialFocusRequest
} from '@unilab/material'
import {
  PascalLabWorkbench,
  type MaterialTransferSceneRoute
} from '@unilab/pascal-lab-plugin'
import { useEffect, useMemo } from 'react'

import { useWorkbench } from '../../context/WorkbenchContext'
import { useLabInteraction } from './LabInteractionProvider'
import { useMaterialRuntime } from './MaterialRuntimeProvider'
import type { LabViewMode } from './UnifiedLabViewport'
import { supportsWebGl } from './webGlCapability'

/**
 * 将物料（Material）图投影到 Pascal 三维场景（3D Scene）工作台。
 *
 * `showSites` 控制库位（Site）图层是否可见，`viewMode` 指定统一实验室视图模式；
 * 返回包含能力降级、模型资源解析、选择同步和移动提交能力的 React 视图。
 */
export function SceneWorkbench({
  showSites = true,
  showMaterialLabels = true,
  showMaterialTransfers = true,
  viewMode = '3d',
  attachStatus = { available: false },
  detachStatus = { available: false },
  focusRequest = null
}: {
  showSites?: boolean
  showMaterialLabels?: boolean
  showMaterialTransfers?: boolean
  viewMode?: LabViewMode
  attachStatus?: CapabilityStatus
  detachStatus?: CapabilityStatus
  focusRequest?: MaterialFocusRequest | null
}): React.JSX.Element {
  const { backend } = useWorkbench()
  const runtime = useMaterialRuntime()
  const store = useMaterialStoreApi()
  const aggregatesById = useMaterialStore(
    (state) => state.aggregatesById
  )
  const loadState = useMaterialStore((state) => state.loadState)
  const shapeLibrary = useMaterialStore((state) => state.shapeLibrary)
  const selectedMaterialIds = useLabInteraction(
    (state) => state.selectedMaterialIds
  )
  const highlightedMaterialIds = useLabInteraction(
    (state) => state.highlightedMaterialIds
  )
  const workflowMaterialTransferRoutes = useLabInteraction(
    (state) => state.activeWorkflowMaterialTransferRoutes
  )
  const selectedWorkflowStepId = useLabInteraction(
    (state) => state.selectedWorkflowStepId
  )
  const visibleMaterialRoles = useLabInteraction(
    (state) => state.activeWorkflowVisibleMaterialRoles
  )
  const materialTransferRoutes = useMemo<MaterialTransferSceneRoute[]>(
    () => workflowMaterialTransferRoutes
      .filter((route) =>
        !visibleMaterialRoles ||
          visibleMaterialRoles.includes(route.materialRole)
      )
      .map((route) => ({
        ...route,
        selected: route.workflowNodeUuid === selectedWorkflowStepId
      })),
    [
      visibleMaterialRoles,
      selectedWorkflowStepId,
      workflowMaterialTransferRoutes
    ]
  )
  const selectMaterials = useLabInteraction(
    (state) => state.selectMaterials
  )
  const selectSceneObjects = useLabInteraction(
    (state) => state.selectSceneObjects
  )
  const aggregates = useMemo(
    () => Object.values(aggregatesById),
    [aggregatesById]
  )
  const modelRuntime = useMemo(
    () => ({
      resolveUrl: (model: { path: string }) => {
        if (!model.path || /^https?:\/\//.test(model.path)) {
          return model.path
        }
        const base = backend.assetUrl || backend.apiUrl
        return new URL(model.path, `${base.replace(/\/+$/, '')}/`).toString()
      }
    }),
    [backend.apiUrl, backend.assetUrl]
  )
  const readStatus = runtime.getStatus('material.readGraph')
  const moveStatus = runtime.getStatus('material.move')

  useEffect(() => {
    if (!readStatus.available || loadState !== 'idle') return
    void store.getState().loadGraph().catch(() => undefined)
  }, [loadState, readStatus.available, store])

  if (!readStatus.available) {
    return (
      <div className="material-scene-unavailable">
        <MaterialCapabilityNotice
          title="三维物料场景不可用"
          status={readStatus}
        />
      </div>
    )
  }

  if (loadState === 'idle' || loadState === 'loading') {
    return <div className="app-loading">正在加载 3D 物料场景…</div>
  }

  if (
    (viewMode === '3d' || viewMode === 'split') &&
    !supportsWebGl()
  ) {
    return (
      <div className="material-scene-unavailable">
        <MaterialCapabilityNotice
          title="三维视图不可用"
          status={{
            available: false,
            reason: '当前浏览器或图形环境未启用 WebGL，请开启硬件加速后重试'
          }}
        />
      </div>
    )
  }

  const scopeKey =
    runtime.scope?.kind === 'laboratory'
      ? runtime.scope.laboratoryId
      : 'singleton'

  return (
    <PascalLabWorkbench
      aggregates={aggregates}
      shapes={shapeLibrary}
      showSites={showSites}
      showMaterialLabels={showMaterialLabels}
      showMaterialTransfers={showMaterialTransfers}
      materialTransferRoutes={materialTransferRoutes}
      materialTransferProjectionError={null}
      viewMode={viewMode}
      projectId={`unilab-${backend.id}-${scopeKey}`}
      moveStatus={moveStatus}
      attachStatus={attachStatus}
      detachStatus={detachStatus}
      focusRequest={focusRequest}
      selectedMaterialIds={selectedMaterialIds}
      highlightedMaterialIds={highlightedMaterialIds}
      modelRuntime={modelRuntime}
      onSelectionChange={(materialIds, sceneObjectIds) => {
        selectMaterials(materialIds)
        selectSceneObjects(sceneObjectIds)
      }}
    />
  )
}
