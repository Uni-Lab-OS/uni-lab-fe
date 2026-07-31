import {
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent
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
  selectedMaterialIds?: readonly MaterialId[]
  highlightedMaterialIds?: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
}

/**
 * Responsive front-oblique material projection. Every object is an SVG
 * extrusion of its authoritative plan footprint; sites/wells are painted
 * through the same affine top-plane transform, so equal wells remain equal.
 */
export function MaterialObliqueCanvas({
  aggregates,
  shapes,
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
  const selected = new Set(selectedMaterialIds)
  const highlighted = new Set(highlightedMaterialIds)
  const viewBox = [
    scene.bounds.minX,
    scene.bounds.minY,
    scene.bounds.width,
    scene.bounds.height
  ].join(' ')

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

  return (
    <div
      className={materialScopeClassName('material-oblique-canvas')}
      data-material-oblique-view
    >
      <div className="material-oblique-canvas__header">
        <strong>实验室 2.5D · SVG</strong>
        <span>正面斜二测 · 深度 1:2</span>
      </div>
      {scene.objects.length === 0 ? (
        <div className="material-oblique-canvas__empty">暂无物料</div>
      ) : (
        <svg
          aria-label="实验室 2.5D 物料视图"
          className="material-oblique-canvas__svg"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          viewBox={viewBox}
          onClick={() => onSelectionChange?.([])}
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
            return (
              <ObliqueMaterial
                key={object.materialId}
                object={object}
                selected={isSelected}
                highlighted={isHighlighted}
                showTag={
                  isEquipmentKind(object.kind) ||
                  isSelected ||
                  isHighlighted ||
                  isHovered
                }
                onClick={(event) => {
                  event.stopPropagation()
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
    </div>
  )
}

function ObliqueMaterial({
  object,
  selected,
  highlighted,
  showTag,
  onClick,
  onKeyDown,
  onPointerEnter,
  onPointerLeave
}: {
  object: MaterialObliqueObject
  selected: boolean
  highlighted: boolean
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
    `is-${materialKindClass(object.kind)}`
  ]
    .filter(Boolean)
    .join(' ')
  const label = object.code || object.name
  const tagPoint = tagAnchor(object.top)
  const tagWidth = Math.max(70, label.length * 13 + 24)

  return (
    <g
      aria-label={`${label}，${object.widthMm}×${object.depthMm}×${object.heightMm} 毫米`}
      className={stateClass}
      data-material-code={object.code}
      data-material-id={object.materialId}
      data-oblique-render-style={object.renderStyle}
      data-oblique-shape={object.shape?.id ?? ''}
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
      {object.shape ? (
        <ObliqueSpecBody object={object} shape={object.shape} />
      ) : (
        <ObliqueSolidBody object={object} />
      )}
      {showTag && (
        <g
          className="material-oblique-object__tag"
          transform={`translate(${tagPoint[0]} ${tagPoint[1]})`}
        >
          <line y1="0" y2="13" />
          <rect
            x={-tagWidth / 2}
            y={-31}
            width={tagWidth}
            height="30"
            rx="8"
          />
          <text y="-16">{label}</text>
        </g>
      )}
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
      <ObliqueSiteMarkers object={object} />
    </>
  )
}

/**
 * 唯一的外形解释器：把设备包声明展开出的图元按顺序画出来。这里没有任何
 * 设备名——每个分支都是一种几何画法。
 */
function ObliqueSpecBody({
  object,
  shape
}: {
  object: MaterialObliqueObject
  shape: MaterialObliqueShape
}): React.JSX.Element {
  return (
    <>
      <ObliqueShapeShadow object={object} shape={shape} />
      {shape.primitives.map((primitive, index) => (
        <ObliquePrimitiveNode
          key={`${primitive.kind}-${index}`}
          object={object}
          primitive={primitive}
        />
      ))}
    </>
  )
}

function ObliquePrimitiveNode({
  object,
  primitive
}: {
  object: MaterialObliqueObject
  primitive: MaterialShapePrimitive
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
      return (
        <ObliqueSiteHoles
          collarTopZMm={primitive.collarTopZMm}
          object={object}
          plateTopZMm={primitive.plateTopZMm}
        />
      )
    case 'site-markers':
      return <ObliqueSiteMarkers object={object} />
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
        >
          {level.sites.map((site) => (
            <ObliqueSite key={site.id} site={site} />
          ))}
        </ShelfBoard>
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
      {object.levels.flatMap((level) =>
        level.sites.map((site) => (
          <ObliqueSiteLabel
            key={`label-${site.id}`}
            site={site}
            transform={planeTransform(object, level.zMm)}
          />
        ))
      )}
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

/** 位点画在顶面：兜底实心体与板式耗材共用。 */
function ObliqueSiteMarkers({
  object
}: {
  object: MaterialObliqueObject
}): React.JSX.Element {
  return (
    <>
      <g
        className="material-oblique-object__plan"
        transform={`matrix(${object.topTransform.join(' ')})`}
      >
        {object.sites.map((site) => (
          <ObliqueSite key={site.id} site={site} />
        ))}
      </g>
      {object.sites.map((site) => (
        <ObliqueSiteLabel
          key={`label-${site.id}`}
          site={site}
          transform={object.topTransform}
        />
      ))}
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
          data-site-key={site.key}
          r={Math.min(width, depth) / 2}
          vectorEffect="non-scaling-stroke"
        >
          <title>{site.name}</title>
        </circle>
      ) : (
        <rect
          className={className}
          data-site-key={site.key}
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
