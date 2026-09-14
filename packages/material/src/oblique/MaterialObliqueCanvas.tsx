import AimOutlined from '@ant-design/icons/AimOutlined'
import {
  useCallback,
  useId,
  useMemo,
  useState
} from 'react'

import type {
  MaterialAggregate,
  MaterialId
} from '../types'
import type { MaterialTransferOverlayRoute } from '../materialTransferOverlay'
import { shouldShowMaterialLabelByDefault } from '../labelPresentation'
import { materialScopeClassName } from '../materialStyles'
import {
  buildMaterialObliqueScene,
  projectObliquePoint,
  type MaterialObliqueObject,
} from './projection'
import type {
  MaterialShapeLibrary
} from './shapeSpec'
import { CanvasLegend } from './CanvasLegend'
import { MaterialObliqueControls } from './MaterialObliqueControls'
import { ObliqueMaterial } from './ObliqueMaterialObject'
import {
  focusCamera,
  formatMm,
  landmarkLabelOffsets,
  selectLandmarkIds
} from './obliqueCamera'
import { useMaterialObliqueViewport } from './useMaterialObliqueViewport'

export interface MaterialObliqueCanvasProps {
  aggregates: readonly MaterialAggregate[]
  /**
   * 设备包声明、Backend 通过 `/api/v1/material-shapes` 提供的 2.5D 外形。
   * 缺省时所有物料退回实心包围盒——画布本身不认识任何具体设备。
   */
  shapes?: MaterialShapeLibrary
  showSites?: boolean
  showMaterialLabels?: boolean
  materialTransferRoutes?: readonly MaterialTransferOverlayRoute[]
  selectedMaterialIds?: readonly MaterialId[]
  highlightedMaterialIds?: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
}

const LANDMARK_LIMIT = 7

/**
 * 渲染支持环绕旋转、平移与缩放的物料（Material）2.5D 斜投影视图。
 * @param props 物料聚合、外形声明、选中态与选择回调。
 * @returns 可访问且可交互的 SVG 物料投影视图。
 */
export function MaterialObliqueCanvas({
  aggregates,
  shapes,
  showSites = true,
  showMaterialLabels = true,
  materialTransferRoutes = [],
  selectedMaterialIds = [],
  highlightedMaterialIds = [],
  onSelectionChange
}: MaterialObliqueCanvasProps): React.JSX.Element {
  const [rotationDeg, setRotationDeg] = useState(0)
  const scene = useMemo(
    () => buildMaterialObliqueScene(aggregates, shapes, rotationDeg),
    [aggregates, rotationDeg, shapes]
  )
  const projectedTransferRoutes = useMemo(
    () => materialTransferRoutes.map((route) => ({
      ...route,
      points: route.pointsMm.map((point) =>
        projectObliquePoint(point, rotationDeg)
      )
    })),
    [materialTransferRoutes, rotationDeg]
  )
  const [hoveredMaterialId, setHoveredMaterialId] =
    useState<MaterialId | null>(null)
  const {
    canvasRef,
    svgRef,
    suppressCanvasClickRef,
    viewport,
    camera,
    viewBoxValue,
    semanticZoom,
    isPanning,
    isRotating,
    fitAll,
    rotateBy,
    changeZoom,
    setCamera,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    finishInteraction
  } = useMaterialObliqueViewport(
    scene.bounds,
    rotationDeg,
    setRotationDeg
  )
  const instructionsId = useId()
  const selected = new Set(selectedMaterialIds)
  const highlighted = new Set(highlightedMaterialIds)
  const selectedObject = scene.objects.find((object) =>
    selected.has(object.materialId)
  )
  const landmarkIds = useMemo(
    () => selectLandmarkIds(scene.objects, LANDMARK_LIMIT),
    [scene.objects]
  )
  const landmarkOffsets = useMemo(
    () => landmarkLabelOffsets(scene.objects, landmarkIds),
    [landmarkIds, scene.objects]
  )
  const select = (
    materialId: MaterialId,
    additive: boolean
  ): void => {
    if (!additive) {
      onSelectionChange?.([materialId])
      return
    }
    onSelectionChange?.(
      selected.has(materialId)
        ? selectedMaterialIds.filter((id) => id !== materialId)
        : [...selectedMaterialIds, materialId]
    )
  }

  const focusObject = useCallback(
    (object: MaterialObliqueObject | undefined) => {
      if (!object) return
      setCamera(focusCamera(scene.bounds, viewport, object))
    },
    [scene.bounds, viewport]
  )

  return (
    <div
      ref={canvasRef}
      className={materialScopeClassName('material-oblique-canvas')}
      aria-label="实验室 2.5D 物料操作视图"
      aria-describedby={instructionsId}
      data-camera-rotation={rotationDeg.toFixed(2)}
      data-camera-zoom={camera.zoom.toFixed(2)}
      data-material-oblique-view
      data-site-layer-visible={showSites}
      data-material-label-layer-visible={showMaterialLabels}
      data-semantic-zoom={semanticZoom}
      role="region"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        onSelectionChange?.([])
      }}
    >
      <MaterialObliqueControls
        objectCount={scene.objects.length}
        rotationDeg={rotationDeg}
        camera={camera}
        selectedObject={selectedObject}
        onRotate={rotateBy}
        onZoom={changeZoom}
        onFitAll={fitAll}
        onFocus={focusObject}
      />
      <p id={instructionsId} className="material-oblique-canvas__sr-only">
        滚轮缩放，左右拖动画布旋转，按住 Shift 拖动可平移，回车或空格选择物料，按
        Escape 清除选择，按 Control 或 Command 可多选。
      </p>
      {scene.diagnostics.invalidObjectCount > 0 ? (
        <div
          className="material-oblique-canvas__coverage"
          role="status"
          aria-live="polite"
        >
          <span className="is-invalid">
            坐标异常 {scene.diagnostics.invalidObjectCount}
          </span>
        </div>
      ) : null}
      {selectedObject ? (
        <div
          className="material-oblique-canvas__selection"
          aria-live="polite"
        >
          <div>
            <strong>{selectedObject.name}</strong>
            <span>{selectedObject.code}</span>
          </div>
          <span className="material-oblique-canvas__coordinates">
            X {formatMm(selectedObject.pose.positionMm[0])} · Y{' '}
            {formatMm(selectedObject.pose.positionMm[1])} · Z{' '}
            {formatMm(selectedObject.pose.positionMm[2])} mm
          </span>
          {selectedMaterialIds.length > 1 ? (
            <span>已选 {selectedMaterialIds.length} 项</span>
          ) : null}
          <button type="button" onClick={() => focusObject(selectedObject)}>
            <AimOutlined aria-hidden="true" />
            定位
          </button>
        </div>
      ) : null}
      {scene.objects.length === 0 ? (
        <div className="material-oblique-canvas__empty">
          <strong>当前物料图没有可展示对象</strong>
          <span>
            请确认物料图已加载，并检查对象坐标与尺寸是否完整。
          </span>
        </div>
      ) : (
        <svg
          ref={svgRef}
          aria-label="实验室 2.5D 物料视图"
          className="material-oblique-canvas__svg"
          data-panning={isPanning || undefined}
          data-rotating={isRotating || undefined}
          preserveAspectRatio="none"
          role="group"
          viewBox={viewBoxValue}
          onClick={() => {
            if (suppressCanvasClickRef.current) {
              suppressCanvasClickRef.current = false
              return
            }
            onSelectionChange?.([])
          }}
          onPointerCancel={finishInteraction}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishInteraction}
          onWheel={handleWheel}
        >
          <defs>
            <filter
              id="material-oblique-shadow"
              x="-30%"
              y="-30%"
              width="160%"
              height="180%"
            >
              <feDropShadow
                dx="0"
                dy="5"
                floodColor="#0f172a"
                floodOpacity="0.08"
                stdDeviation="5"
              />
            </filter>
          </defs>
          {scene.objects.map((object) => {
            const isSelected = selected.has(object.materialId)
            const isHighlighted = highlighted.has(object.materialId)
            const isHovered = hoveredMaterialId === object.materialId
            const isLandmark = landmarkIds.has(object.materialId)
            const showTag =
              isSelected ||
              isHighlighted ||
              isHovered ||
              (semanticZoom === 'overview' && isLandmark) ||
              (semanticZoom === 'detail' &&
                shouldShowMaterialLabelByDefault(object.kind)) ||
              semanticZoom === 'inspect'
            return (
              <ObliqueMaterial
                key={object.materialId}
                object={object}
                selected={isSelected}
                highlighted={isHighlighted}
                showSites={showSites}
                showMaterialLabels={showMaterialLabels}
                labelScale={1 / camera.zoom}
                labelOffsetY={landmarkOffsets.get(object.materialId) ?? 0}
                showTag={showTag}
                onClick={(event) => {
                  if (suppressCanvasClickRef.current) {
                    suppressCanvasClickRef.current = false
                    return
                  }
                  event.stopPropagation()
                  event.currentTarget.focus()
                  select(
                    object.materialId,
                    event.ctrlKey || event.metaKey
                  )
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  select(
                    object.materialId,
                    event.ctrlKey || event.metaKey
                  )
                }}
                onPointerEnter={() =>
                  setHoveredMaterialId(object.materialId)
                }
                onPointerLeave={() => setHoveredMaterialId(null)}
              />
            )
          })}
          <MaterialTransferOverlay routes={projectedTransferRoutes} />
        </svg>
      )}
      <CanvasLegend />
    </div>
  )
}

function MaterialTransferOverlay({
  routes
}: {
  routes: readonly (MaterialTransferOverlayRoute & {
    points: readonly (readonly [number, number])[]
  })[]
}): React.JSX.Element | null {
  if (routes.length === 0) return null
  return (
    <g className="material-oblique-transfer-layer">
      <defs>
        {routes.map((route, index) => (
          <marker
            key={route.id}
            id={`material-oblique-transfer-arrow-${index}`}
            markerHeight="7"
            markerWidth="7"
            orient="auto-start-reverse"
            refX="6"
            refY="3.5"
            viewBox="0 0 7 7"
          >
            <path d="M0 0 7 3.5 0 7Z" fill={route.accent} />
          </marker>
        ))}
      </defs>
      {routes.map((route, index) => {
        const first = route.points[0]
        const last = route.points[route.points.length - 1]
        if (!first || !last || route.points.length < 2) return null
        return (
          <g
            key={route.id}
            aria-label={`${route.label}：${route.sourceLabel} 到 ${route.targetLabel}`}
            data-material-transfer-route={route.id}
            data-transfer-status={route.status}
            role="img"
          >
            <title>{`${route.label} · ${route.sourceLabel} → ${route.targetLabel}`}</title>
            <polyline
              className="material-oblique-transfer-route__halo"
              fill="none"
              points={route.points.map((point) => point.join(',')).join(' ')}
            />
            <polyline
              className="material-oblique-transfer-route"
              fill="none"
              markerEnd={`url(#material-oblique-transfer-arrow-${index})`}
              points={route.points.map((point) => point.join(',')).join(' ')}
              stroke={route.accent}
              strokeDasharray={
                route.status === 'planned' || route.status === 'pending'
                  ? '10 8'
                  : undefined
              }
            />
            <circle
              className="material-oblique-transfer-route__endpoint"
              cx={first[0]}
              cy={first[1]}
              fill={route.accent}
              r="5"
            />
            <circle
              className="material-oblique-transfer-route__endpoint"
              cx={last[0]}
              cy={last[1]}
              fill={route.accent}
              r="5"
            />
          </g>
        )
      })}
    </g>
  )
}
