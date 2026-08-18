import type {
  MaterialObliqueObject,
  MaterialObliqueShape,
  ObliquePoint
} from './projection'
import type { MaterialShapePrimitive } from './shapeSpec'
import { ObliqueStackShelves } from './ObliqueStackAndSites'
import { ObliqueLathe } from './ObliqueLathePrimitive'
import { ObliqueOpenRack, ObliqueSiteHoles } from './ObliqueMaterialStructures'
import {
  applyAffinePoint,
  arcPoints,
  frontSweepSign,
  latheOutline,
  planeAtHeight,
  planeTransform,
  pointsAttr
} from './obliqueGeometry'

/**
 * 唯一的外形解释器：把设备包声明展开出的图元按顺序画出来。这里没有任何
 * 设备名——每个分支都是一种几何画法。
 */
export function ObliqueSpecBody({
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

/**
 * 绘制一条已经求解为毫米坐标的通用 Shape 图元。
 * @param object 当前物料的 2.5D 投影对象。
 * @param primitive 待绘制的已求解图元。
 * @param showSites 是否展示库位（Site）及其内部结构层。
 * @returns 对应 SVG 节点；被显示开关抑制的图元返回 null。
 */
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
          fallbackMarkers={primitive.fallbackMarkers}
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
