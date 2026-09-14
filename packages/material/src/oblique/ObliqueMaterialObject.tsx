import type { KeyboardEvent, MouseEvent } from 'react'

import type { MaterialObliqueObject } from './projection'
import { ObliqueSpecBody } from './ObliqueMaterialPrimitives'
import { ObliqueSiteBounds } from './ObliqueMaterialStructures'
import { materialKindClass, pointsAttr, tagAnchor } from './obliqueGeometry'

export function ObliqueMaterial({
  object,
  selected,
  highlighted,
  showSites,
  showMaterialLabels,
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
  showMaterialLabels: boolean
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
      {showMaterialLabels ? (
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
      ) : null}
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
