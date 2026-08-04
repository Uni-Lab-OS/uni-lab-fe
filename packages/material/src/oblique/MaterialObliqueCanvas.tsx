import AimOutlined from '@ant-design/icons/AimOutlined'
import FullscreenExitOutlined from '@ant-design/icons/FullscreenExitOutlined'
import ZoomInOutlined from '@ant-design/icons/ZoomInOutlined'
import ZoomOutOutlined from '@ant-design/icons/ZoomOutOutlined'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent
} from 'react'

import type {
  MaterialAggregate,
  MaterialId,
  MaterialSite
} from '../types'
import { materialScopeClassName } from '../materialStyles'
import {
  buildMaterialObliqueScene,
  type MaterialObliqueObject,
  type MaterialObliqueShape,
  type ObliquePoint
} from './projection'
import type {
  MaterialShapeLibrary,
  MaterialShapePrimitive
} from './shapeSpec'

export interface MaterialObliqueCanvasProps {
  aggregates: readonly MaterialAggregate[]
  /**
   * 设备包声明的 2.5D 外形（Bridge 的 /api/v1/material-shapes）。缺省时所有
   * 物料退回实心包围盒——画布本身不认识任何具体设备。
   */
  shapes?: MaterialShapeLibrary
  showSites?: boolean
  selectedMaterialIds?: readonly MaterialId[]
  highlightedMaterialIds?: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
}

interface ObliqueCamera {
  centerX: number
  centerY: number
  zoom: number
}

interface ObliqueViewBox {
  minX: number
  minY: number
  width: number
  height: number
}

interface ViewportSize {
  width: number
  height: number
}

interface DragState {
  pointerId: number
  clientX: number
  clientY: number
  camera: ObliqueCamera
  viewBox: ObliqueViewBox
  moved: boolean
}

const MIN_CAMERA_ZOOM = 1
const MAX_CAMERA_ZOOM = 6
const DEFAULT_VIEWPORT: ViewportSize = { width: 1600, height: 900 }
const LANDMARK_LIMIT = 7

/**
 * Responsive front-oblique material projection. Every object is an SVG
 * extrusion of its authoritative plan footprint; sites/wells are painted
 * through the same affine top-plane transform, so equal wells remain equal.
 */
export function MaterialObliqueCanvas({
  aggregates,
  shapes,
  showSites = true,
  selectedMaterialIds = [],
  highlightedMaterialIds = [],
  onSelectionChange
}: MaterialObliqueCanvasProps): React.JSX.Element {
  const scene = useMemo(
    () => buildMaterialObliqueScene(aggregates, shapes),
    [aggregates, shapes]
  )
  const [hoveredMaterialId, setHoveredMaterialId] =
    useState<MaterialId | null>(null)
  const [viewport, setViewport] =
    useState<ViewportSize>(DEFAULT_VIEWPORT)
  const [camera, setCamera] = useState<ObliqueCamera>(() =>
    fitCamera(scene.bounds)
  )
  const [isPanning, setIsPanning] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressCanvasClickRef = useRef(false)
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
  const viewBox = useMemo(
    () => cameraViewBox(scene.bounds, viewport, camera),
    [camera, scene.bounds, viewport]
  )
  const viewBoxValue = [
    viewBox.minX,
    viewBox.minY,
    viewBox.width,
    viewBox.height
  ].join(' ')
  const semanticZoom =
    camera.zoom < 1.45
      ? 'overview'
      : camera.zoom < 2.8
        ? 'detail'
        : 'inspect'

  useEffect(() => {
    setCamera(fitCamera(scene.bounds))
  }, [
    scene.bounds.height,
    scene.bounds.minX,
    scene.bounds.minY,
    scene.bounds.width
  ])

  useEffect(() => {
    const element = canvasRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const update = (): void => {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      setViewport({ width: rect.width, height: rect.height })
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [])

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

  const fitAll = useCallback(() => {
    setCamera(fitCamera(scene.bounds))
  }, [scene.bounds])

  const changeZoom = useCallback((factor: number) => {
    setCamera((current) => ({
      ...current,
      zoom: clamp(
        current.zoom * factor,
        MIN_CAMERA_ZOOM,
        MAX_CAMERA_ZOOM
      )
    }))
  }, [])

  const focusObject = useCallback(
    (object: MaterialObliqueObject | undefined) => {
      if (!object) return
      setCamera(focusCamera(scene.bounds, viewport, object))
    },
    [scene.bounds, viewport]
  )

  const handleWheel = (event: WheelEvent<SVGSVGElement>): void => {
    if (!svgRef.current) return
    event.preventDefault()
    const rect = svgRef.current.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const ratioX = clamp(
      (event.clientX - rect.left) / rect.width,
      0,
      1
    )
    const ratioY = clamp(
      (event.clientY - rect.top) / rect.height,
      0,
      1
    )
    const worldX = viewBox.minX + viewBox.width * ratioX
    const worldY = viewBox.minY + viewBox.height * ratioY
    const nextZoom = clamp(
      camera.zoom * (event.deltaY < 0 ? 1.18 : 1 / 1.18),
      MIN_CAMERA_ZOOM,
      MAX_CAMERA_ZOOM
    )
    const nextBase = fittedViewBox(scene.bounds, viewport)
    const nextWidth = nextBase.width / nextZoom
    const nextHeight = nextBase.height / nextZoom
    setCamera({
      centerX: worldX - (ratioX - 0.5) * nextWidth,
      centerY: worldY - (ratioY - 0.5) * nextHeight,
      zoom: nextZoom
    })
  }

  const handlePointerDown = (
    event: ReactPointerEvent<SVGSVGElement>
  ): void => {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      camera,
      viewBox,
      moved: false
    }
    setIsPanning(true)
  }

  const handlePointerMove = (
    event: ReactPointerEvent<SVGSVGElement>
  ): void => {
    const drag = dragRef.current
    const svg = svgRef.current
    if (!drag || drag.pointerId !== event.pointerId || !svg) return
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const deltaX = event.clientX - drag.clientX
    const deltaY = event.clientY - drag.clientY
    if (Math.abs(deltaX) + Math.abs(deltaY) > 3) drag.moved = true
    setCamera({
      ...drag.camera,
      centerX:
        drag.camera.centerX - (deltaX / rect.width) * drag.viewBox.width,
      centerY:
        drag.camera.centerY - (deltaY / rect.height) * drag.viewBox.height
    })
  }

  const finishPan = (
    event: ReactPointerEvent<SVGSVGElement>
  ): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    suppressCanvasClickRef.current = drag.moved
    dragRef.current = null
    setIsPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      ref={canvasRef}
      className={materialScopeClassName('material-oblique-canvas')}
      aria-label="实验室 2.5D 物料操作视图"
      aria-describedby={instructionsId}
      data-camera-zoom={camera.zoom.toFixed(2)}
      data-material-oblique-view
      data-site-layer-visible={showSites}
      data-semantic-zoom={semanticZoom}
      role="region"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        onSelectionChange?.([])
      }}
    >
      <header className="material-oblique-canvas__header">
        <div className="material-oblique-canvas__identity">
          <strong>实验室 2.5D</strong>
          <span>{scene.objects.length} 个对象</span>
        </div>
        <div
          className="material-oblique-canvas__camera"
          role="group"
          aria-label="2.5D 视图控制"
        >
          <button
            type="button"
            aria-label="缩小 2.5D 视图"
            disabled={camera.zoom <= MIN_CAMERA_ZOOM}
            title="缩小"
            onClick={() => changeZoom(1 / 1.25)}
          >
            <ZoomOutOutlined aria-hidden="true" />
          </button>
          <output aria-label="当前缩放比例">
            {Math.round(camera.zoom * 100)}%
          </output>
          <button
            type="button"
            aria-label="放大 2.5D 视图"
            disabled={camera.zoom >= MAX_CAMERA_ZOOM}
            title="放大"
            onClick={() => changeZoom(1.25)}
          >
            <ZoomInOutlined aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="适应全部物料"
            title="适应全部"
            onClick={fitAll}
          >
            <FullscreenExitOutlined aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="聚焦已选物料"
            disabled={!selectedObject}
            title="聚焦已选"
            onClick={() => focusObject(selectedObject)}
          >
            <AimOutlined aria-hidden="true" />
          </button>
        </div>
      </header>
      <p id={instructionsId} className="material-oblique-canvas__sr-only">
        滚轮缩放，拖动画布平移，回车或空格选择物料，按 Escape
        清除选择，按 Control 或 Command 可多选。
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
          onPointerCancel={finishPan}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPan}
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
                isEquipmentKind(object.kind)) ||
              semanticZoom === 'inspect'
            return (
              <ObliqueMaterial
                key={object.materialId}
                object={object}
                selected={isSelected}
                highlighted={isHighlighted}
                showSites={showSites}
                labelScale={1 / camera.zoom}
                labelOffsetY={landmarkOffsets.get(object.materialId) ?? 0}
                showTag={showTag}
                onClick={(event) => {
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
        </svg>
      )}
      <CanvasLegend />
    </div>
  )
}

function CanvasLegend(): React.JSX.Element {
  return (
    <div
      className="material-oblique-canvas__legend"
      aria-label="2.5D 图例与操作说明"
    >
      <div>
        <span className="material-oblique-legend-key is-selected">
          <i aria-hidden="true" />
          已选
        </span>
        <span className="material-oblique-legend-key is-occupied">
          <i aria-hidden="true" />
          已占用
        </span>
      </div>
      <span>滚轮缩放 · 拖动画布 · Ctrl / ⌘ 多选 · Esc 清除</span>
    </div>
  )
}

function fitCamera(
  bounds: MaterialObliqueSceneBounds
): ObliqueCamera {
  return {
    centerX: bounds.minX + bounds.width / 2,
    centerY: bounds.minY + bounds.height / 2,
    zoom: MIN_CAMERA_ZOOM
  }
}

type MaterialObliqueSceneBounds = {
  minX: number
  minY: number
  width: number
  height: number
}

function fittedViewBox(
  bounds: MaterialObliqueSceneBounds,
  viewport: ViewportSize
): ObliqueViewBox {
  const viewportRatio =
    viewport.width > 0 && viewport.height > 0
      ? viewport.width / viewport.height
      : DEFAULT_VIEWPORT.width / DEFAULT_VIEWPORT.height
  const contentRatio = bounds.width / bounds.height
  const width =
    viewportRatio >= contentRatio
      ? bounds.height * viewportRatio
      : bounds.width
  const height =
    viewportRatio >= contentRatio
      ? bounds.height
      : bounds.width / viewportRatio
  return {
    minX: bounds.minX - (width - bounds.width) / 2,
    minY: bounds.minY - (height - bounds.height) / 2,
    width,
    height
  }
}

function cameraViewBox(
  bounds: MaterialObliqueSceneBounds,
  viewport: ViewportSize,
  camera: ObliqueCamera
): ObliqueViewBox {
  const fitted = fittedViewBox(bounds, viewport)
  const width = fitted.width / camera.zoom
  const height = fitted.height / camera.zoom
  const sceneCenterX = bounds.minX + bounds.width / 2
  const sceneCenterY = bounds.minY + bounds.height / 2
  const centerX =
    width >= bounds.width
      ? sceneCenterX
      : clamp(
          camera.centerX,
          bounds.minX + width / 2,
          bounds.minX + bounds.width - width / 2
        )
  const centerY =
    height >= bounds.height
      ? sceneCenterY
      : clamp(
          camera.centerY,
          bounds.minY + height / 2,
          bounds.minY + bounds.height - height / 2
        )
  return {
    minX: centerX - width / 2,
    minY: centerY - height / 2,
    width,
    height
  }
}

function focusCamera(
  sceneBounds: MaterialObliqueSceneBounds,
  viewport: ViewportSize,
  object: MaterialObliqueObject
): ObliqueCamera {
  const points = [...object.base, ...object.top]
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const objectWidth = Math.max(maxX - minX, sceneBounds.width * 0.03)
  const objectHeight = Math.max(
    maxY - minY,
    sceneBounds.height * 0.06
  )
  const fitted = fittedViewBox(sceneBounds, viewport)
  const zoom = clamp(
    Math.min(
      fitted.width / (objectWidth * 2.6),
      fitted.height / (objectHeight * 2.6)
    ),
    1.6,
    4.5
  )
  return {
    centerX: minX + (maxX - minX) / 2,
    centerY: minY + (maxY - minY) / 2,
    zoom
  }
}

function selectLandmarkIds(
  objects: readonly MaterialObliqueObject[],
  limit: number
): ReadonlySet<MaterialId> {
  const landmarks = objects
    .filter(
      (object) =>
        isEquipmentKind(object.kind) &&
        !['host', 'plc', 'deck'].some((token) =>
          object.kind.toLowerCase().includes(token)
        )
    )
    .sort(
      (left, right) =>
        landmarkScore(right) - landmarkScore(left) ||
        left.materialId.localeCompare(right.materialId)
    )
    .slice(0, limit)
    .map((object) => object.materialId)
  return new Set(landmarks)
}

function landmarkScore(object: MaterialObliqueObject): number {
  const fidelityWeight =
    object.fidelity === 'declared'
      ? 2_000_000
      : object.fidelity === 'inferred'
        ? 1_000_000
        : 0
  return (
    fidelityWeight +
    object.widthMm * object.depthMm +
    object.heightMm * 100
  )
}

function landmarkLabelOffsets(
  objects: readonly MaterialObliqueObject[],
  landmarkIds: ReadonlySet<MaterialId>
): ReadonlyMap<MaterialId, number> {
  const landmarks = objects
    .filter((object) => landmarkIds.has(object.materialId))
    .map((object) => ({
      id: object.materialId,
      anchorX: tagAnchor(object.top)[0]
    }))
    .sort((left, right) => left.anchorX - right.anchorX)
  const offsets = new Map<MaterialId, number>()
  let previousX = Number.NEGATIVE_INFINITY
  let lane = 0
  const sceneXs = objects.flatMap((object) =>
    object.top.map((point) => point[0])
  )
  const collisionDistance =
    sceneXs.length > 0
      ? Math.max(
          (Math.max(...sceneXs) - Math.min(...sceneXs)) / 18,
          180
        )
      : 240
  for (const landmark of landmarks) {
    lane =
      landmark.anchorX - previousX < collisionDistance
        ? (lane + 1) % 3
        : 0
    offsets.set(landmark.id, lane * -86)
    previousX = landmark.anchorX
  }
  return offsets
}

function formatMm(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 1
  }).format(value)
}

function ObliqueMaterial({
  object,
  selected,
  highlighted,
  showSites,
  labelScale,
  labelOffsetY,
  showTag,
  onClick,
  onKeyDown,
  onPointerEnter,
  onPointerLeave
}: {
  object: MaterialObliqueObject
  selected: boolean
  highlighted: boolean
  showSites: boolean
  labelScale: number
  labelOffsetY: number
  showTag: boolean
  onClick: (event: MouseEvent<SVGGElement>) => void
  onKeyDown: (event: KeyboardEvent<SVGGElement>) => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}): React.JSX.Element {
  const stateClass = [
    'material-oblique-object',
    selected ? 'is-selected' : '',
    highlighted ? 'is-highlighted' : '',
    showTag ? 'is-tag-visible' : '',
    `is-fidelity-${object.fidelity}`,
    `is-${materialKindClass(object.kind)}`
  ]
    .filter(Boolean)
    .join(' ')
  const tagPoint = tagAnchor(object.top)
  const showCode = Boolean(
    object.code && object.code !== object.name
  )
  const tagWidth = Math.max(
    220,
    object.name.length * 38 + 52,
    showCode ? object.code.length * 23 + 52 : 0
  )
  const tagHeight = showCode ? 74 : 52

  return (
    <g
      aria-label={`${object.name}，${object.widthMm}×${object.depthMm}×${object.heightMm} 毫米`}
      aria-pressed={selected}
      className={stateClass}
      data-material-code={object.code}
      data-material-id={object.materialId}
      data-oblique-render-style={object.renderStyle}
      data-oblique-shape={object.shape?.id ?? ''}
      data-oblique-fidelity={object.fidelity}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <title>
        {`${object.name} · ${object.widthMm}×${object.depthMm}×${object.heightMm} mm`}
      </title>
      {!object.logicalMount && object.shape ? (
        <ObliqueSpecBody
          object={object}
          shape={object.shape}
          showSites={showSites}
        />
      ) : !object.logicalMount ? (
        <ObliqueSolidBody object={object} />
      ) : null}
      {showSites ? <ObliqueSiteBounds object={object} /> : null}
      <g
        className="material-oblique-object__tag"
        transform={`translate(${tagPoint[0]} ${tagPoint[1]}) scale(${labelScale}) translate(0 ${labelOffsetY})`}
      >
        <line y1="0" y2="34" />
        <rect
          x={-tagWidth / 2}
          y={-tagHeight - 16}
          width={tagWidth}
          height={tagHeight}
          rx="12"
        />
        <text
          className="material-oblique-object__tag-name"
          y={showCode ? -61 : -42}
        >
          {object.name}
        </text>
        {showCode ? (
          <text
            className="material-oblique-object__tag-code"
            y="-34"
          >
            {object.code}
          </text>
        ) : null}
      </g>
    </g>
  )
}

/**
 * 没有外形声明时的兜底：按包围盒挤出一个实心体，位点画在顶面。
 */
function ObliqueSolidBody({
  object
}: {
  object: MaterialObliqueObject
}): React.JSX.Element {
  return (
    <>
      <polygon
        className="material-oblique-object__shadow"
        filter="url(#material-oblique-shadow)"
        points={pointsAttr(object.base)}
      />
      <polygon
        className="material-oblique-object__front"
        points={pointsAttr([
          object.base[0],
          object.base[1],
          object.top[1],
          object.top[0]
        ])}
      />
      <polygon
        className="material-oblique-object__side"
        points={pointsAttr([
          object.base[1],
          object.base[2],
          object.top[2],
          object.top[1]
        ])}
      />
      <polygon
        className="material-oblique-object__top"
        points={pointsAttr(object.top)}
      />
    </>
  )
}

/**
 * 唯一的外形解释器：把设备包声明展开出的图元按顺序画出来。这里没有任何
 * 设备名——每个分支都是一种几何画法。
 */
function ObliqueSpecBody({
  object,
  shape,
  showSites
}: {
  object: MaterialObliqueObject
  shape: MaterialObliqueShape
  showSites: boolean
}): React.JSX.Element {
  return (
    <>
      <ObliqueShapeShadow object={object} shape={shape} />
      {shape.primitives.map((primitive, index) => (
        <ObliquePrimitiveNode
          key={`${primitive.kind}-${index}`}
          object={object}
          primitive={primitive}
          showSites={showSites}
        />
      ))}
    </>
  )
}

function ObliquePrimitiveNode({
  object,
  primitive,
  showSites
}: {
  object: MaterialObliqueObject
  primitive: MaterialShapePrimitive
  showSites: boolean
}): React.JSX.Element | null {
  const partClass = (style: string): string =>
    `material-oblique-part material-oblique-part--${style}`

  switch (primitive.kind) {
    case 'box':
      return (
        <ObliqueBox
          className={partClass(primitive.style)}
          from={primitive.from}
          object={object}
          to={primitive.to}
        />
      )
    case 'slab':
      return (
        <ObliqueSlab
          className={partClass(primitive.style)}
          from={primitive.fromZMm}
          object={object}
          to={primitive.toZMm}
        />
      )
    case 'cylinder':
      return (
        <ObliqueCylinder
          centerX={primitive.centerXMm}
          centerY={primitive.centerYMm}
          className={partClass(primitive.style)}
          from={primitive.fromZMm}
          object={object}
          radiusMm={primitive.radiusMm}
          to={primitive.toZMm}
        />
      )
    case 'lathe':
      return <ObliqueLathe object={object} primitive={primitive} />
    case 'disc':
      return (
        <g
          transform={`matrix(${planeTransform(object, primitive.zMm).join(' ')})`}
        >
          <circle
            className={partClass(primitive.style)}
            cx={primitive.centerXMm}
            cy={primitive.centerYMm}
            r={primitive.radiusMm}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )
    case 'rect':
      return (
        <g
          transform={`matrix(${planeTransform(object, primitive.zMm).join(' ')})`}
        >
          <rect
            className={partClass(primitive.style)}
            x={primitive.xMm}
            y={primitive.yMm}
            width={primitive.widthMm}
            height={primitive.depthMm}
            rx={primitive.radiusMm}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )
    case 'edge': {
      const [x0, y0, z0] = primitive.from
      const [x1, y1, z1] = primitive.to
      const start = applyAffinePoint(planeTransform(object, z0), x0, y0)
      const end = applyAffinePoint(planeTransform(object, z1), x1, y1)
      return (
        <line
          className={partClass(primitive.style)}
          x1={start[0]}
          y1={start[1]}
          x2={end[0]}
          y2={end[1]}
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    case 'open-rack':
      return (
        <ObliqueOpenRack
          object={object}
          thicknessMm={primitive.boardThicknessMm}
        />
      )
    case 'stack-shelves':
      return (
        <ObliqueStackShelves
          object={object}
          thicknessMm={primitive.shelfThicknessMm}
        />
      )
    case 'site-holes':
      if (!showSites) return null
      return (
        <ObliqueSiteHoles
          collarTopZMm={primitive.collarTopZMm}
          object={object}
          plateTopZMm={primitive.plateTopZMm}
        />
      )
    case 'site-markers':
      return null
    default:
      return null
  }
}

/** 台面上的投影：方体按包围盒，回转体按底圈。 */
function ObliqueShapeShadow({
  object,
  shape
}: {
  object: MaterialObliqueObject
  shape: MaterialObliqueShape
}): React.JSX.Element | null {
  if (shape.shadow === 'none') return null
  if (shape.shadow === 'round') {
    const round = shape.primitives.find(
      (primitive) =>
        primitive.kind === 'lathe' || primitive.kind === 'cylinder'
    )
    if (round && (round.kind === 'lathe' || round.kind === 'cylinder')) {
      const ring = round.kind === 'lathe' ? round.rings[0] : undefined
      const zMm =
        round.kind === 'lathe' && ring
          ? round.fromZMm + (round.toZMm - round.fromZMm) * ring.z
          : round.fromZMm
      const radiusMm = round.radiusMm * (ring ? ring.r : 1)
      return (
        <polygon
          className="material-oblique-object__shadow"
          filter="url(#material-oblique-shadow)"
          points={pointsAttr(
            arcPoints(
              planeTransform(object, zMm),
              round.centerXMm,
              round.centerYMm,
              radiusMm,
              0,
              2 * Math.PI,
              44
            )
          )}
        />
      )
    }
  }
  return (
    <polygon
      className="material-oblique-object__shadow"
      filter="url(#material-oblique-shadow)"
      points={pointsAttr(object.base)}
    />
  )
}

/**
 * Open-front racks (beaker/reagent stacks, tip warehouses) are drawn as a
 * frame: rear and side panels plus one board per slot level. The front stays
 * open, so the vessels standing on each board remain visible.
 */
function ObliqueOpenRack({
  object,
  thicknessMm
}: {
  object: MaterialObliqueObject
  thicknessMm?: number
}): React.JSX.Element {
  const boardThickness =
    thicknessMm ?? clamp(object.heightMm * 0.02, 6, 14)
  const topLevelZ = object.levels.length
    ? object.levels[object.levels.length - 1].zMm
    : 0
  const hasRoof = object.heightMm - topLevelZ > boardThickness * 2

  return (
    <>
      <polygon
        className="material-oblique-part material-oblique-part--frame is-rear"
        points={pointsAttr([
          object.base[2],
          object.base[3],
          object.top[3],
          object.top[2]
        ])}
      />
      <polygon
        className="material-oblique-part material-oblique-part--frame is-inner-side"
        points={pointsAttr([
          object.base[3],
          object.base[0],
          object.top[0],
          object.top[3]
        ])}
      />
      {object.levels.map((level) => (
        <ShelfBoard
          key={level.key}
          object={object}
          thickness={boardThickness}
          zMm={level.zMm}
        />
      ))}
      <polygon
        className="material-oblique-part material-oblique-part--frame"
        points={pointsAttr([
          object.base[1],
          object.base[2],
          object.top[2],
          object.top[1]
        ])}
      />
      {hasRoof && (
        <ShelfBoard
          object={object}
          thickness={boardThickness}
          zMm={object.heightMm}
        />
      )}
      {[object.base[0], object.base[1]].map((corner, index) => {
        const upper = elevatePoint(corner, object.heightMm)
        if (!corner || !upper) return null
        return (
          <line
            key={`post-${index}`}
            className="material-oblique-part material-oblique-part--post"
            x1={corner[0]}
            y1={corner[1]}
            x2={upper[0]}
            y2={upper[1]}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </>
  )
}

function ShelfBoard({
  children,
  object,
  thickness,
  zMm
}: {
  children?: React.ReactNode
  object: MaterialObliqueObject
  thickness: number
  zMm: number
}): React.JSX.Element {
  const plane = planeAtHeight(object.base, zMm)

  return (
    <g className="material-oblique-board-group">
      <polygon
        className="material-oblique-part material-oblique-part--board"
        points={pointsAttr(plane)}
      />
      <polygon
        className="material-oblique-part material-oblique-part--board is-lip"
        points={pointsAttr([
          plane[0],
          plane[1],
          dropPoint(plane[1], thickness),
          dropPoint(plane[0], thickness)
        ])}
      />
      {children && (
        <g
          className="material-oblique-object__plan"
          transform={`matrix(${planeTransform(object, zMm).join(' ')})`}
        >
          {children}
        </g>
      )}
    </g>
  )
}

/**
 * 孔板上的孔与孔里插着的东西（枪头）：孔位与占用状态都来自实例位点，
 * 声明只说"这里有一块孔板"。
 */
function ObliqueSiteHoles({
  collarTopZMm,
  object,
  plateTopZMm
}: {
  collarTopZMm?: number
  object: MaterialObliqueObject
  plateTopZMm?: number
}): React.JSX.Element {
  const holeSites = object.levels[0]?.sites ?? object.sites
  const plateTopZ =
    plateTopZMm ?? object.levels[0]?.zMm ?? object.heightMm * 0.83
  const collarTopZ = collarTopZMm ?? object.heightMm
  const collarHeight = Math.max(collarTopZ - plateTopZ, 0)
  const point = (x: number, y: number, z: number): ObliquePoint =>
    applyAffinePoint(planeTransform(object, z), x, y)

  return (
    <>
      <g transform={`matrix(${planeTransform(object, plateTopZ).join(' ')})`}>
        {holeSites.map((site) => (
          <circle
            key={site.id}
            className={`material-oblique-part material-oblique-part--hole is-${
              site.visual?.state ?? 'empty'
            }`}
            cx={site.poseInAnchor.positionMm[0] + site.sizeMm[0] / 2}
            cy={site.poseInAnchor.positionMm[1] + site.sizeMm[1] / 2}
            data-site-key={site.key}
            r={Math.min(site.sizeMm[0], site.sizeMm[1]) / 2}
            vectorEffect="non-scaling-stroke"
          >
            <title>{site.name}</title>
          </circle>
        ))}
      </g>
      {collarHeight > 0 &&
        holeSites.map((site) => {
          const [x, y] = site.poseInAnchor.positionMm
          const radius = Math.min(site.sizeMm[0], site.sizeMm[1]) / 2
          const centerX = x + site.sizeMm[0] / 2
          const centerY = y + site.sizeMm[1] / 2
          return (
            <polygon
              key={`collar-${site.id}`}
              className="material-oblique-hole__collar"
              points={pointsAttr([
                point(centerX - radius, centerY, plateTopZ),
                point(centerX + radius, centerY, plateTopZ),
                point(centerX + radius, centerY, plateTopZ + collarHeight),
                point(centerX - radius, centerY, plateTopZ + collarHeight)
              ])}
            />
          )
        })}
    </>
  )
}

/** 每个 Site 按自己的局部高度绘制浅蓝包围盒，不依赖设备 shape 声明。 */
function ObliqueSiteBounds({
  object
}: {
  object: MaterialObliqueObject
}): React.JSX.Element {
  return (
    <>
      {object.siteBounds.map((site) => (
        <g
          key={site.id}
          className="material-oblique-object__plan"
          transform={`matrix(${planeTransform(
            object,
            site.poseInAnchor.positionMm[2]
          ).join(' ')})`}
        >
          <ObliqueSite site={site} />
        </g>
      ))}
      {object.siteBounds.map((site) => {
        const transform = planeTransform(
          object,
          site.poseInAnchor.positionMm[2]
        )
        return (
          <ObliqueSiteLabel
            key={`label-${site.id}`}
            site={site}
            transform={transform}
          />
        )
      })}
    </>
  )
}

/** Upright cylinder in local mm: turned wall silhouette plus its top face. */
function ObliqueCylinder({
  centerX,
  centerY,
  className,
  from,
  object,
  radiusMm,
  to
}: {
  centerX: number
  centerY: number
  className: string
  from: number
  object: MaterialObliqueObject
  radiusMm: number
  to: number
}): React.JSX.Element {
  const sweep = frontSweepSign(object.topTransform)
  const startAngle =
    Math.atan2(object.topTransform[2], object.topTransform[0]) + Math.PI

  return (
    <g className={className}>
      <polygon
        className="material-oblique-object__front"
        points={pointsAttr(
          latheOutline({
            object,
            rings: [
              { zMm: from, radiusMm },
              { zMm: to, radiusMm }
            ],
            centerX,
            centerY,
            startAngle,
            sweep
          })
        )}
      />
      <polygon
        className="material-oblique-object__top"
        points={pointsAttr(
          arcPoints(
            planeTransform(object, to),
            centerX,
            centerY,
            radiusMm,
            startAngle,
            startAngle + 2 * Math.PI,
            44
          )
        )}
      />
    </g>
  )
}

/** Axis-aligned box given by two local corners, drawn front, side then top. */
function ObliqueBox({
  className,
  from,
  object,
  to
}: {
  className: string
  from: readonly [number, number, number]
  object: MaterialObliqueObject
  to: readonly [number, number, number]
}): React.JSX.Element {
  const corner = (x: number, y: number, z: number): ObliquePoint =>
    applyAffinePoint(planeTransform(object, z), x, y)
  const [x0, y0, z0] = from
  const [x1, y1, z1] = to

  return (
    <g className={className}>
      <polygon
        className="material-oblique-object__front"
        points={pointsAttr([
          corner(x0, y0, z0),
          corner(x1, y0, z0),
          corner(x1, y0, z1),
          corner(x0, y0, z1)
        ])}
      />
      <polygon
        className="material-oblique-object__side"
        points={pointsAttr([
          corner(x1, y0, z0),
          corner(x1, y1, z0),
          corner(x1, y1, z1),
          corner(x1, y0, z1)
        ])}
      />
      <polygon
        className="material-oblique-object__top"
        points={pointsAttr([
          corner(x0, y0, z1),
          corner(x1, y0, z1),
          corner(x1, y1, z1),
          corner(x0, y1, z1)
        ])}
      />
    </g>
  )
}

/** Box slice between two local heights, drawn as front, side and top faces. */
function ObliqueSlab({
  className,
  from,
  object,
  to
}: {
  className: string
  from: number
  object: MaterialObliqueObject
  to: number
}): React.JSX.Element {
  const lower = planeAtHeight(object.base, from)
  const upper = planeAtHeight(object.base, to)

  return (
    <g className={className}>
      <polygon
        className="material-oblique-object__front"
        points={pointsAttr([lower[0], lower[1], upper[1], upper[0]])}
      />
      <polygon
        className="material-oblique-object__side"
        points={pointsAttr([lower[1], lower[2], upper[2], upper[1]])}
      />
      <polygon
        className="material-oblique-object__top"
        points={pointsAttr(upper)}
      />
    </g>
  )
}

/**
 * 回转体：把轮廓采样成一圈圈半径再缝成一条剪影，肩部曲线因此是光滑的、
 * body 上不会横着接缝。烧杯、试剂瓶、注粉瓶都是它。
 */
function ObliqueLathe({
  object,
  primitive
}: {
  object: MaterialObliqueObject
  primitive: Extract<MaterialShapePrimitive, { kind: 'lathe' }>
}): React.JSX.Element {
  const {
    centerXMm,
    centerYMm,
    radiusMm,
    fromZMm,
    toZMm,
    rings,
    cap
  } = primitive
  const sweep = frontSweepSign(object.topTransform)
  const startAngle =
    Math.atan2(object.topTransform[2], object.topTransform[0]) + Math.PI
  const span = toZMm - fromZMm
  const resolve = (ring: { z: number; r: number }): LatheRing => ({
    zMm: fromZMm + span * ring.z,
    radiusMm: radiusMm * ring.r
  })
  const lathe = (source: readonly { z: number; r: number }[]): ObliquePoint[] =>
    latheOutline({
      object,
      rings: source.map(resolve),
      centerX: centerXMm,
      centerY: centerYMm,
      startAngle,
      sweep
    })

  const mouth = resolve(rings[rings.length - 1])
  const mouthTransform = planeTransform(object, mouth.zMm)
  const capRings = cap ?? []

  return (
    <g className={`material-oblique-part material-oblique-part--${primitive.style}`}>
      <polygon
        className="material-oblique-lathe__wall"
        points={pointsAttr(lathe(rings))}
      />
      {capRings.length > 1 && (
        <>
          <polygon
            className="material-oblique-lathe__cap"
            points={pointsAttr(lathe(capRings))}
          />
          {ribAngles(startAngle, sweep, primitive.ribs).map(
            (angle, index) => {
              const capBottom = resolve(capRings[0])
              const from = circlePoint(
                planeTransform(object, capBottom.zMm),
                centerXMm,
                centerYMm,
                capBottom.radiusMm,
                angle
              )
              const to = circlePoint(
                mouthTransform,
                centerXMm,
                centerYMm,
                mouth.radiusMm,
                angle
              )
              return (
                <line
                  key={`rib-${index}`}
                  className="material-oblique-lathe__rib"
                  x1={from[0]}
                  y1={from[1]}
                  x2={to[0]}
                  y2={to[1]}
                  vectorEffect="non-scaling-stroke"
                />
              )
            }
          )}
        </>
      )}
      {primitive.spout && (
        <polygon
          className="material-oblique-lathe__spout"
          points={pointsAttr(
            spoutOutline(
              mouthTransform,
              centerXMm,
              centerYMm,
              mouth.radiusMm,
              span
            )
          )}
        />
      )}
      {primitive.mouth && (
        <g transform={`matrix(${mouthTransform.join(' ')})`}>
          <circle
            className="material-oblique-lathe__mouth"
            cx={centerXMm}
            cy={centerYMm}
            r={mouth.radiusMm}
            vectorEffect="non-scaling-stroke"
          />
          {primitive.rim && (
            <circle
              className="material-oblique-lathe__rim"
              cx={centerXMm}
              cy={centerYMm}
              r={mouth.radiusMm * 0.88}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      )}
    </g>
  )
}

/** 板仓/堆栈塔：立柱 + 每个位点一层层板，占用状态画在层板上。 */
function ObliqueStackShelves({
  object,
  thicknessMm
}: {
  object: MaterialObliqueObject
  thicknessMm?: number
}): React.JSX.Element {
  const shelfThickness =
    thicknessMm ?? clamp(object.heightMm * 0.009, 4, 10)
  const basePlane = planeAtHeight(object.base, 0)
  const topPlane = planeAtHeight(object.base, object.heightMm)

  return (
    <>
      <StackRail
        className="is-rear"
        from={object.base[2]}
        to={object.top[2]}
      />
      <StackRail
        className="is-rear"
        from={object.base[3]}
        to={object.top[3]}
      />
      <StackShelf
        className="is-base"
        plane={basePlane}
        thickness={shelfThickness}
      />
      {object.shelves.map((shelf) => (
        <StackShelf
          key={shelf.key}
          label={shelf.label}
          occupied={shelf.occupied}
          plane={planeAtHeight(object.base, shelf.heightMm)}
          siteKey={shelf.siteKey}
          thickness={shelfThickness}
        />
      ))}
      <StackShelf
        className="is-cap"
        plane={topPlane}
        thickness={shelfThickness}
      />
      <StackRail from={object.base[0]} to={object.top[0]} />
      <StackRail from={object.base[1]} to={object.top[1]} />
    </>
  )
}

function StackRail({
  className = '',
  from,
  to
}: {
  className?: string
  from?: ObliquePoint
  to?: ObliquePoint
}): React.JSX.Element | null {
  if (!from || !to) return null
  return (
    <line
      className={`material-oblique-stack__rail ${className}`}
      x1={from[0]}
      y1={from[1]}
      x2={to[0]}
      y2={to[1]}
      vectorEffect="non-scaling-stroke"
    />
  )
}

function StackShelf({
  className = '',
  plane,
  thickness,
  occupied = false,
  siteKey,
  label
}: {
  className?: string
  plane: readonly ObliquePoint[]
  thickness: number
  occupied?: boolean
  siteKey?: string
  label?: string
}): React.JSX.Element {
  const frontStart = plane[0]
  const frontEnd = plane[1]
  const occupiedPlane = insetPlane(plane, 0.1)
  const labelPoint =
    frontStart && frontEnd
      ? midpoint(frontStart, frontEnd)
      : undefined

  return (
    <g className={`material-oblique-stack__shelf-group ${className}`}>
      <polygon
        className="material-oblique-stack__shelf"
        points={pointsAttr(plane)}
      />
      <polygon
        className="material-oblique-stack__shelf-lip"
        points={pointsAttr([
          frontStart,
          frontEnd,
          dropPoint(frontEnd, thickness),
          dropPoint(frontStart, thickness)
        ])}
      />
      {occupied && (
        <polygon
          className="material-oblique-stack__occupied"
          points={pointsAttr(occupiedPlane)}
        />
      )}
      {label && labelPoint && (
        <text
          className="material-oblique-stack__label"
          data-site-key={siteKey}
          data-site-label={label}
          x={labelPoint[0]}
          y={labelPoint[1] - 4}
        >
          {label}
        </text>
      )}
    </g>
  )
}

function ObliqueSite({
  site
}: {
  site: MaterialSite
}): React.JSX.Element {
  const [width, depth] = site.sizeMm
  const [x, y] = site.poseInAnchor.positionMm
  const className = [
    'material-oblique-site',
    `is-${site.kind ?? 'site'}`,
    `is-${site.visual?.state ?? 'empty'}`
  ].join(' ')

  return (
    <g className="material-oblique-site-group">
      {site.shape === 'circle' ? (
        <circle
          className={className}
          cx={x + width / 2}
          cy={y + depth / 2}
          data-oblique-site-bounds
          data-site-id={site.id}
          data-site-key={site.key}
          data-site-occupancy={site.occupiedMaterialIds.length ? 'occupied' : 'empty'}
          r={Math.min(width, depth) / 2}
          vectorEffect="non-scaling-stroke"
        >
          <title>{site.name}</title>
        </circle>
      ) : (
        <rect
          className={className}
          data-oblique-site-bounds
          data-site-id={site.id}
          data-site-key={site.key}
          data-site-occupancy={site.occupiedMaterialIds.length ? 'occupied' : 'empty'}
          x={x}
          y={y}
          width={width}
          height={depth}
          rx={Math.min(width, depth) * 0.08}
          vectorEffect="non-scaling-stroke"
        >
          <title>{site.name}</title>
        </rect>
      )}
    </g>
  )
}

function ObliqueSiteLabel({
  site,
  transform
}: {
  site: MaterialSite
  transform: readonly [number, number, number, number, number, number]
}): React.JSX.Element | null {
  const [width, depth] = site.sizeMm
  const label = site.key || site.name
  if (
    !label ||
    site.kind === 'well' ||
    site.kind === 'tip-spot' ||
    Math.max(width, depth) < 18
  ) {
    return null
  }
  const [x, y] = site.poseInAnchor.positionMm
  const [labelX, labelY] = applyAffinePoint(
    transform,
    x + width / 2,
    y + depth / 2
  )
  const labelSize = clamp(Math.min(width, depth) * 0.18, 11, 16)

  return (
    <text
      className="material-oblique-site__label"
      data-site-key={site.key}
      data-site-label={label}
      fontSize={labelSize}
      x={labelX}
      y={labelY}
      dominantBaseline="middle"
      textAnchor="middle"
      vectorEffect="non-scaling-stroke"
    >
      {label}
    </text>
  )
}

function applyAffinePoint(
  transform: readonly [number, number, number, number, number, number],
  x: number,
  y: number
): ObliquePoint {
  const [a, b, c, d, e, f] = transform
  return [a * x + c * y + e, b * x + d * y + f]
}

type Affine = readonly [number, number, number, number, number, number]

/** 回转轮廓的一圈，已解算成本地 mm。 */
interface LatheRing {
  zMm: number
  radiusMm: number
}

/**
 * Silhouette of a turned solid: front arc of the lowest ring, the right-hand
 * extreme of every ring going up, rear arc of the highest ring, then the
 * left-hand extremes coming back down.
 */
function latheOutline(options: {
  object: MaterialObliqueObject
  rings: readonly LatheRing[]
  centerX: number
  centerY: number
  startAngle: number
  sweep: 1 | -1
}): ObliquePoint[] {
  const { object, rings, centerX, centerY, startAngle, sweep } = options
  if (rings.length === 0) return []

  const transformFor = (ring: LatheRing): Affine =>
    planeTransform(object, ring.zMm)
  const rightAngle = startAngle + sweep * Math.PI
  const middle = rings.slice(1, -1)
  const bottom = rings[0]
  const top = rings[rings.length - 1]

  return [
    ...arcPoints(
      transformFor(bottom),
      centerX,
      centerY,
      bottom.radiusMm,
      startAngle,
      rightAngle,
      30
    ),
    ...middle.map((ring) =>
      circlePoint(
        transformFor(ring),
        centerX,
        centerY,
        ring.radiusMm,
        rightAngle
      )
    ),
    ...arcPoints(
      transformFor(top),
      centerX,
      centerY,
      top.radiusMm,
      rightAngle,
      startAngle + sweep * 2 * Math.PI,
      30
    ),
    ...[...middle].reverse().map((ring) =>
      circlePoint(
        transformFor(ring),
        centerX,
        centerY,
        ring.radiusMm,
        startAngle
      )
    )
  ]
}

/** Plane transform at an arbitrary local height, derived from the top plane. */
function planeTransform(
  object: MaterialObliqueObject,
  heightMm: number
): Affine {
  const [a, b, c, d, e, f] = object.topTransform
  return [a, b, c, d, e, f + (object.heightMm - heightMm)]
}

/** Rotational direction that walks the rim across the viewer-facing side. */
function frontSweepSign(transform: Affine): 1 | -1 {
  const [a, b, c, d] = transform
  const leftAngle = Math.atan2(c, a) + Math.PI
  const frontAngle = Math.atan2(d, b)
  return Math.cos(leftAngle + Math.PI / 2 - frontAngle) >= 0 ? 1 : -1
}

function circlePoint(
  transform: Affine,
  cx: number,
  cy: number,
  r: number,
  angle: number
): ObliquePoint {
  return applyAffinePoint(
    transform,
    cx + r * Math.cos(angle),
    cy + r * Math.sin(angle)
  )
}

function arcPoints(
  transform: Affine,
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  samples = 24
): ObliquePoint[] {
  const step = (to - from) / samples
  return Array.from({ length: samples + 1 }, (_, index) =>
    circlePoint(transform, cx, cy, r, from + step * index)
  )
}

function ribAngles(
  startAngle: number,
  sweep: 1 | -1,
  count: number
): number[] {
  const safeCount = Math.max(Math.round(count), 0)
  return Array.from(
    { length: safeCount },
    (_, index) =>
      startAngle + sweep * Math.PI * ((index + 1) / (safeCount + 1))
  )
}

function spoutOutline(
  transform: Affine,
  cx: number,
  cy: number,
  r: number,
  heightMm: number
): ObliquePoint[] {
  const [a, b, c, d] = transform
  const frontAngle = Math.atan2(d, b)
  const rightAngle = Math.atan2(c, a)
  const axis = frontAngle + (rightAngle - frontAngle) * 0.35
  const spread = 0.42
  const lift = heightMm * 0.035
  const tip = circlePoint(transform, cx, cy, r * 1.24, axis)
  return [
    circlePoint(transform, cx, cy, r, axis - spread),
    [tip[0], tip[1] - lift],
    circlePoint(transform, cx, cy, r, axis + spread)
  ]
}

function planeAtHeight(
  base: readonly ObliquePoint[],
  heightMm: number
): ObliquePoint[] {
  return base.map(([x, y]) => [x, y - heightMm])
}

function elevatePoint(
  point: ObliquePoint | undefined,
  heightMm: number
): ObliquePoint | undefined {
  return point ? [point[0], point[1] - heightMm] : undefined
}

function dropPoint(
  point: ObliquePoint | undefined,
  distance: number
): ObliquePoint | undefined {
  return point ? [point[0], point[1] + distance] : undefined
}

function insetPlane(
  plane: readonly ObliquePoint[],
  ratio: number
): ObliquePoint[] {
  if (plane.length === 0) return []
  const center: ObliquePoint = [
    plane.reduce((total, point) => total + point[0], 0) / plane.length,
    plane.reduce((total, point) => total + point[1], 0) / plane.length
  ]
  return plane.map(([x, y]) => [
    x + (center[0] - x) * ratio,
    y + (center[1] - y) * ratio
  ])
}

function midpoint(
  left: ObliquePoint,
  right: ObliquePoint
): ObliquePoint {
  return [
    (left[0] + right[0]) / 2,
    (left[1] + right[1]) / 2
  ]
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function tagAnchor(points: readonly ObliquePoint[]): ObliquePoint {
  return [
    points.reduce((total, point) => total + point[0], 0) / points.length,
    Math.min(...points.map((point) => point[1])) - 18
  ]
}

function pointsAttr(points: readonly (ObliquePoint | undefined)[]): string {
  return points
    .filter((point): point is ObliquePoint => point != null)
    .map((point) => point.join(','))
    .join(' ')
}

function isEquipmentKind(kind: string): boolean {
  const normalized = kind.replaceAll('_', '-').toLowerCase()
  const isLabware = [
    'plate',
    'tip-rack',
    'tiprack',
    'labware',
    'container',
    'reagent',
    'sample',
    'tube',
    'beaker',
    'vial',
    'bottle',
    'trash',
    'deck'
  ].some((token) => normalized.includes(token))
  // 「烧杯堆栈」这类载架名字里带 beaker，但仍是设备，标签要保留
  return isLabware ? normalized.includes('stack') : true
}

function materialKindClass(kind: string): string {
  const normalized = kind.replaceAll('_', '-').toLowerCase()
  if (
    normalized.includes('hotel') ||
    normalized.includes('stack')
  ) {
    return 'stack'
  }
  if (normalized.includes('trash')) return 'trash'
  if (normalized.includes('deck')) return 'deck'
  if (
    normalized.includes('beaker') ||
    normalized.includes('vial') ||
    normalized.includes('bottle') ||
    normalized.includes('reagent')
  ) {
    return 'vessel'
  }
  if (
    normalized.includes('plate') ||
    normalized.includes('tip-rack') ||
    normalized.includes('tiprack')
  ) {
    return 'labware'
  }
  return 'equipment'
}
