import { emitter } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  PascalEditorHost,
  type SceneGraph
} from '@unilab/pascal-host'
import {
  MaterialCanvas,
  MaterialObliqueCanvas,
  type MaterialTransferOverlayRoute
} from '@unilab/material'
import type {
  MaterialAggregate,
  MaterialShapeLibrary
} from '@unilab/material/domain'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  type MaterialSceneMove,
  type MaterialTransferSceneRoute,
  materialAggregatesToSceneGraph,
  sceneGraphToMaterialMoves
} from './materialAggregateSceneBridge'
import {
  configureLabModelRuntime,
  type LabModelRuntime
} from './modelRuntime'
import {
  indexMaterialSceneObjects,
  materialIdsToSceneObjectIds
} from './materialSceneSelection'
import { preparePascalLabPlugin } from './plugin'
import { shouldPausePascalRendering } from './renderActivity'
import {
  isLabDeviceNode,
  type LabMaterialTransferLayerNode,
  isLabTableNode
} from './schema'
import type { SceneCameraView } from './sceneCameraRequest'
import { pascalPoseToLab } from './units'

export interface PascalLabWorkbenchProps {
  aggregates: readonly MaterialAggregate[]
  /** 设备包声明的 2.5D 外形，透传给斜二测画布。 */
  shapes?: MaterialShapeLibrary
  /** 统一控制 2D、2.5D 与 3D 中的库位/点位图层。 */
  showSites?: boolean
  /** 工作流（Workflow）派生的只读物料（Material）转运路线。 */
  materialTransferRoutes?: readonly MaterialTransferSceneRoute[]
  showMaterialTransfers?: boolean
  materialTransferProjectionError?: string | null
  viewMode?: '2d' | '2.5d' | '3d' | 'split'
  /** Agent 截图使用的显式相机预设；普通交互仍由工具栏维护。 */
  cameraPreset?: SceneCameraView
  cameraRequestRevision?: number
  /** 复用 Pascal WebGPU 离屏管线的宿主截图请求。 */
  captureRequest?: {
    revision: number
    width: number
    height: number
  } | null
  onCaptureReady?: (blob: Blob) => void
  projectId?: string
  modelRuntime?: LabModelRuntime
  editable?: boolean
  selectedMaterialIds?: readonly string[]
  highlightedMaterialIds?: readonly string[]
  onMaterialMoves?: (moves: readonly MaterialSceneMove[]) => void
  onSelectionChange?: (
    materialIds: readonly string[],
    sceneObjectIds: readonly string[]
  ) => void
}

/**
 * 将物料图（Material Graph）及只读转运路线组合到 Pascal 2D/2.5D/3D 视图。
 *
 * @param props 物料聚合、形状、视图开关、选择和移动回调。
 * @returns 不拥有物料位置权威的 Pascal 实验室工作台。
 * @throws 不主动抛错；插件初始化异常在局部错误状态中展示。
 * @safety 选择与高亮只更新视图投影，物料位置仅通过注入的移动命令提交。
 */
export function PascalLabWorkbench({
  aggregates,
  shapes,
  showSites = true,
  materialTransferRoutes = [],
  showMaterialTransfers = true,
  materialTransferProjectionError = null,
  viewMode = '3d',
  cameraPreset,
  cameraRequestRevision = 0,
  captureRequest = null,
  onCaptureReady,
  projectId = 'unilab-local-scene',
  modelRuntime,
  editable = false,
  selectedMaterialIds = [],
  highlightedMaterialIds = [],
  onMaterialMoves,
  onSelectionChange
}: PascalLabWorkbenchProps): React.JSX.Element {
  const [cameraRequest, setCameraRequest] = useState<{
    revision: number
    view: SceneCameraView
  }>({ revision: 0, view: 'default' })
  useEffect(() => {
    if (!cameraPreset) return
    useViewer.getState().setCameraMode(
      cameraPreset === 'top' ? 'orthographic' : 'perspective'
    )
    setCameraRequest(({ revision }) => ({
      revision: Math.max(revision + 1, cameraRequestRevision),
      view: cameraPreset
    }))
  }, [cameraPreset, cameraRequestRevision])
  useEffect(() => {
    if (!captureRequest || !onCaptureReady) return
    const frame = requestAnimationFrame(() => {
      emitter.emit('camera-controls:generate-thumbnail', {
        projectId,
        captureMode: 'standard',
        standardSize: {
          w: captureRequest.width,
          h: captureRequest.height
        }
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [captureRequest, onCaptureReady, projectId])
  const scene = useMemo(
    () =>
      materialAggregatesToSceneGraph(aggregates, {
        fitSceneRevision: cameraRequest.revision,
        fitSceneView: cameraRequest.view,
        showSites,
        showMaterialTransfers,
        materialTransferRoutes
      }),
    [
      aggregates,
      cameraRequest,
      materialTransferRoutes,
      showMaterialTransfers,
      showSites
    ]
  )
  const [saveStatus, setSaveStatus] = useState<
    'saved' | 'dirty' | 'saving'
  >('saved')
  const transferLayer = (
    scene.nodes.level_unilab as {
      materialTransferLayer?: LabMaterialTransferLayerNode | null
    } | undefined
  )?.materialTransferLayer
  const transferRouteCount = transferLayer?.routes.length ?? 0
  const unresolvedTransferRouteCount =
    transferLayer?.unresolvedRouteIds.length ?? 0
  const materialTransferOverlayRoutes = useMemo<
    MaterialTransferOverlayRoute[]
  >(
    () => (transferLayer?.routes ?? []).map((route) => ({
      id: route.id,
      label: route.label,
      sourceMaterialId: route.sourceOwnerMaterialId,
      targetMaterialId: route.targetOwnerMaterialId,
      sourceLabel: route.sourceAnchorLabel,
      targetLabel: route.targetAnchorLabel,
      status: route.status,
      accent: route.accent,
      pointsMm: route.points.map((point) =>
        pascalPoseToLab(point, [0, 0, 0]).positionMm
      )
    })),
    [transferLayer]
  )
  const materialSceneSelectionIndex = useMemo(
    () => indexMaterialSceneObjects(scene),
    [scene]
  )

  const selectedSceneObjectIds = useMemo(
    () => materialIdsToSceneObjectIds(
      materialSceneSelectionIndex,
      selectedMaterialIds
    ),
    [materialSceneSelectionIndex, selectedMaterialIds]
  )
  const highlightedSceneObjectIds = useMemo(
    () => materialIdsToSceneObjectIds(
      materialSceneSelectionIndex,
      highlightedMaterialIds
    ),
    [highlightedMaterialIds, materialSceneSelectionIndex]
  )
  const reportedMaterialIdsRef = useRef<readonly string[]>(
    selectedMaterialIds
  )
  reportedMaterialIdsRef.current = selectedMaterialIds

  const reportSelectionChange = useCallback((
    materialIds: readonly string[],
    sceneObjectIds: readonly string[]
  ): void => {
    if (sameIds(reportedMaterialIdsRef.current, materialIds)) return
    // Pascal 在 pointerup 和随后 click 中可能连续发出同一选中结果。
    // 先同步 ref，避免 React 批处理提交前重复刷新整个工作台。
    reportedMaterialIdsRef.current = [...materialIds]
    onSelectionChange?.(materialIds, sceneObjectIds)
  }, [onSelectionChange])

  useEffect(() => {
    const state = useViewer.getState()
    if (!sameIds(state.selection.selectedIds, selectedSceneObjectIds)) {
      state.setSelection({
        selectedIds: [...selectedSceneObjectIds] as never[]
      })
    }
  }, [selectedSceneObjectIds])

  useEffect(() => {
    const state = useViewer.getState()
    if (!sameIds(state.previewSelectedIds, highlightedSceneObjectIds)) {
      state.setPreviewSelectedIds(
        [...highlightedSceneObjectIds] as never[]
      )
    }
  }, [highlightedSceneObjectIds])

  const prepare = useCallback(async () => {
    if (modelRuntime) configureLabModelRuntime(modelRuntime)
    await preparePascalLabPlugin()
  }, [modelRuntime])

  const handleSave = useCallback(
    async (scene: SceneGraph) => {
      if (!editable) {
        setSaveStatus('saved')
        return
      }
      setSaveStatus('saving')
      onMaterialMoves?.(
        sceneGraphToMaterialMoves(scene, aggregates)
      )
      setSaveStatus('saved')
    },
    [aggregates, editable, onMaterialMoves]
  )

  const handleSelectionChange = useCallback(
    (sceneObjectIds: readonly string[]) => {
      const materialIds = sceneObjectIds.flatMap((id) => {
        const node = scene.nodes[id]
        return isLabDeviceNode(node) || isLabTableNode(node)
          ? [node.materialNodeId]
          : []
      })
      reportSelectionChange(materialIds, sceneObjectIds)
    },
    [reportSelectionChange, scene.nodes]
  )

  const statusLabel = useMemo(() => {
    if (saveStatus === 'saving') return '正在保存'
    if (saveStatus === 'dirty') return '有未保存修改'
    const count = aggregates.length
    return editable
      ? `${count} 个物料 · 已保存`
      : `${count} 个物料 · 只读`
  }, [aggregates.length, editable, saveStatus])
  const pascalViewMode = viewMode === '2.5d' ? '3d' : viewMode

  const toolbar = (
    <div className="pascal-lab-toolbar">
      <span className="pascal-lab-toolbar__title">
        实验室 {viewMode.toUpperCase()} · Pascal
      </span>
      <span className="pascal-lab-toolbar__status">{statusLabel}</span>
      {showMaterialTransfers && (
        <span
          className="pascal-lab-toolbar__transfer-status"
          title={materialTransferProjectionError ?? (
            unresolvedTransferRouteCount > 0
              ? `${unresolvedTransferRouteCount} 条路线缺少可解析的库位（Site）坐标`
              : undefined
          )}
        >
          <i aria-hidden="true" />
          {materialTransferProjectionError
            ? '转运投影需检查'
            : transferRouteCount > 0
              ? `${transferRouteCount} 条物料转运路线`
              : materialTransferRoutes.length > 0
                ? '暂无可定位的转运路线'
                : '选择工作流以显示转运路线'}
        </span>
      )}
      {viewMode !== '2d' && (
        <div className="pascal-lab-toolbar__actions">
          <button
            type="button"
            className="pascal-lab-toolbar__button"
            onClick={() => {
              useViewer.getState().setCameraMode('orthographic')
              requestAnimationFrame(() => {
                setCameraRequest(({ revision }) => ({
                  revision: revision + 1,
                  view: 'top'
                }))
              })
            }}
          >
            顶视图
          </button>
          <button
            type="button"
            className="pascal-lab-toolbar__button"
            onClick={() => {
              useViewer.getState().setCameraMode('perspective')
              requestAnimationFrame(() => {
                setCameraRequest(({ revision }) => ({
                  revision: revision + 1,
                  view: 'default'
                }))
              })
            }}
          >
            适配场景
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div
      className={`pascal-lab-workbench${
        viewMode === '2.5d' ? ' is-oblique' : ''
      }`}
    >
      <div
        aria-hidden={viewMode === '2.5d'}
        className="pascal-lab-workbench__native"
      >
        <PascalEditorHost
          scene={scene}
          projectId={projectId}
          prepare={prepare}
          readOnly={!editable}
          editorViewMode={pascalViewMode}
          renderPaused={shouldPausePascalRendering(viewMode)}
          sceneTheme="studio"
          showGrid
          floorplanOverlay={
            <MaterialCanvas
              floorplanOverlay
              physicalLayout
              showSites={showSites}
              materialTransferRoutes={
                showMaterialTransfers ? materialTransferOverlayRoutes : []
              }
              readStatus={{ available: true }}
              moveStatus={{
                available: editable,
                reason: editable
                  ? undefined
                  : '当前服务不支持移动物料'
              }}
              selectedMaterialIds={selectedMaterialIds}
              highlightedMaterialIds={highlightedMaterialIds}
              onSelectionChange={(materialIds) => {
                reportSelectionChange(
                  materialIds,
                  materialIdsToSceneObjectIds(
                    materialSceneSelectionIndex,
                    materialIds
                  )
                )
              }}
            />
          }
          toolbar={toolbar}
          editorProps={{
            onThumbnailCapture: (blob) => onCaptureReady?.(blob)
          }}
          onDirty={() => {
            if (editable) setSaveStatus('dirty')
          }}
          onSave={handleSave}
          onSelectionChange={handleSelectionChange}
          suppressSelectionAfterPointerDrag={
            viewMode === '3d' || viewMode === 'split'
          }
        />
      </div>
      {viewMode === '2.5d' && (
        <div className="pascal-lab-workbench__oblique">
          <MaterialObliqueCanvas
            aggregates={aggregates}
            shapes={shapes}
            showSites={showSites}
            materialTransferRoutes={
              showMaterialTransfers ? materialTransferOverlayRoutes : []
            }
            selectedMaterialIds={selectedMaterialIds}
            highlightedMaterialIds={highlightedMaterialIds}
            onSelectionChange={(materialIds) => {
              reportSelectionChange(
                materialIds,
                materialIdsToSceneObjectIds(
                  materialSceneSelectionIndex,
                  materialIds
                )
              )
            }}
          />
        </div>
      )}
    </div>
  )
}

function sameIds(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
