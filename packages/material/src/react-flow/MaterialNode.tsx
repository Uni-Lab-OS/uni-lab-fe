import {
  Handle,
  Position,
  type NodeProps
} from 'reactflow'

import { useMaterialStore } from '../MaterialStoreProvider'
import { materialScopeClassName } from '../materialStyles'
import { isDecorativeDeckRail } from '../sitePresentation'
import type { MaterialAggregate, MaterialSite } from '../types'
import {
  readDefaultMaterialNodePresentation,
  shouldRenderDefaultEquipmentCard,
  type DefaultMaterialNodeKind
} from './defaultNodePresentation'
import type { MaterialFlowNodeData } from './projection'
import type { MaterialSiteDropState } from './projectionTypes'
import {
  materialSiteStyle,
  readMaterial2DVisual
} from './visual'

/**
 * 从物料存储读取聚合并渲染 React Flow 物料节点。
 *
 * @param data 节点携带的物料身份。
 * @param selected 当前节点是否被选中。
 * @returns 物料节点；聚合缺失时返回明确的缺失占位。
 * @throws 无；状态缺失在组件内失败关闭。
 */
export function MaterialNode({
  data,
  selected
}: NodeProps<MaterialFlowNodeData>): React.JSX.Element {
  const aggregate = useMaterialStore(
    (state) => state.aggregatesById[data.materialId]
  )

  if (!aggregate) {
    return (
      <div
        className={materialScopeClassName(
          'material-flow-node is-missing'
        )}
      >
        物料不存在
      </div>
    )
  }

  return (
    <>
      <Handle
        id="material-transfer-target"
        className="material-transfer-handle"
        position={Position.Left}
        type="target"
      />
      <MaterialNodePresentation
        aggregate={aggregate}
        selected={selected}
        siteDropStateById={data.siteDropStateById}
      />
      <Handle
        id="material-transfer-source"
        className="material-transfer-handle"
        position={Position.Right}
        type="source"
      />
    </>
  )
}

/**
 * 把一个已解析物料（Material）聚合投影为二维节点，保持状态读取与纯展示分离。
 *
 * @param aggregate 已由物料存储解析的物料聚合。
 * @param selected 当前 React Flow 节点是否被选中。
 * @returns 可渲染物理库位（Site）或默认卡片的二维节点。
 * @throws 无；缺失或非物理展示信息会使用既有回退投影。
 */
export function MaterialNodePresentation({
  aggregate,
  selected,
  siteDropStateById
}: {
  aggregate: MaterialAggregate
  selected: boolean
  siteDropStateById?: Readonly<Record<string, MaterialSiteDropState>>
}): React.JSX.Element {
  const occupied = aggregate.sites.reduce(
    (total, site) => total + site.occupiedMaterialIds.length,
    0
  )
  const visual = readMaterial2DVisual(aggregate)
  const isDeck = visual.kind.includes('deck')
  const isLabware =
    visual.kind.includes('plate') ||
    visual.kind.includes('tip-rack') ||
    visual.kind.includes('tiprack')
  const isStation = visual.kind === 'liquid-handler'
  const isTrash = visual.kind.includes('trash')
  const isEquipment = isEquipmentKind(visual.kind)
  const presentation = readDefaultMaterialNodePresentation(aggregate)
  const renderDefaultEquipmentCard =
    shouldRenderDefaultEquipmentCard(aggregate, visual)
  const hasVisibleSites = aggregate.sites.some(
    (site) => site.visible !== false
  )

  if (visual.physical || isDeck || isLabware || isStation || isTrash) {
    return (
      <article
        className={materialScopeClassName(
          [
            'material-flow-node',
            'material-flow-node--physical',
            `material-flow-node--${
              isDeck
                ? 'deck'
                : isLabware
                  ? 'labware'
                  : isTrash
                    ? 'trash'
                    : isEquipment
                      ? 'station'
                      : 'labware'
            }`,
            renderDefaultEquipmentCard
              ? 'material-flow-node--equipment-card'
              : '',
            selected ? 'is-selected' : ''
          ]
            .filter(Boolean)
            .join(' ')
        )}
        data-material-code={aggregate.material.code}
        data-material-kind={visual.kind}
      >
        <header className="material-flow-node__physical-label">
          <span>{aggregate.material.code || aggregate.material.name}</span>
        </header>
        {isTrash && (
          <div className="material-flow-node__trash-mark">
            <span aria-hidden="true">🗑</span>
            <strong>废弃物</strong>
          </div>
        )}
        {hasVisibleSites && (
          <div className="material-flow-node__sites">
            {isLabware ? (
              <LabwareSites
                sites={aggregate.sites}
                footprintMm={visual.footprintMm}
                ownerMaterialId={aggregate.material.id}
                siteDropStateById={siteDropStateById}
              />
            ) : (
              aggregate.sites
                .filter((site) => site.visible !== false)
                .map((site) =>
                  isDecorativeDeckRail(aggregate, site) ? (
                    <span
                      key={site.id}
                      aria-hidden="true"
                      className="material-flow-deck-rail"
                      data-deck-rail={site.key}
                      style={materialSiteStyle(
                        site,
                        visual.footprintMm
                      )}
                    />
                  ) : (
                    <span
                      key={site.id}
                      className={siteClassName(
                        site,
                        'material-flow-site',
                        siteDropStateById?.[site.id]
                      )}
                      data-material-site-id={site.id}
                      data-site-owner-material-id={aggregate.material.id}
                      data-site-drop-state={siteDropStateById?.[site.id]}
                      data-site-key={site.key}
                      style={materialSiteStyle(
                        site,
                        visual.footprintMm
                      )}
                      title={siteTitle(site)}
                    >
                      {Math.min(site.sizeMm[0], site.sizeMm[1]) >= 40
                        ? site.name
                        : null}
                    </span>
                  )
                )
            )}
          </div>
        )}
        {renderDefaultEquipmentCard && (
          <DefaultEquipmentCard
            name={aggregate.material.name}
            noun={presentation.noun}
            occupied={occupied}
            placement={aggregate.placement.kind}
            siteCount={aggregate.sites.length}
          />
        )}
      </article>
    )
  }

  return (
    <article
      className={materialScopeClassName(
        [
          'material-flow-node',
          'material-flow-node--default',
          `material-flow-node--default-${presentation.kind}`,
          selected ? 'is-selected' : ''
        ]
          .filter(Boolean)
          .join(' ')
      )}
      data-default-node-kind={presentation.kind}
      data-material-code={aggregate.material.code}
      data-material-kind={visual.kind}
    >
      <header className="material-flow-node__default-header">
        <span
          aria-hidden="true"
          className="material-flow-node__default-icon"
          data-default-node-icon={presentation.kind}
        >
          <DefaultNodeIcon kind={presentation.kind} />
        </span>
        <span className="material-flow-node__identity">
          <small>{presentation.noun}</small>
          <strong title={aggregate.material.name}>
            {aggregate.material.name}
          </strong>
        </span>
        <small className="material-flow-node__revision">
          r{aggregate.revision}
        </small>
      </header>
      <footer className="material-flow-node__default-meta">
        <span>
          <PlacementIcon />
          {placementLabel(aggregate.placement.kind)}
        </span>
        <span>
          {aggregate.sites.length
            ? `${occupied}/${aggregate.sites.length} 安装位`
            : '无安装位'}
        </span>
      </footer>
    </article>
  )
}

function DefaultEquipmentCard({
  name,
  noun,
  occupied,
  placement,
  siteCount
}: {
  name: string
  noun: string
  occupied: number
  placement: string
  siteCount: number
}): React.JSX.Element {
  return (
    <section
      aria-label={`${name} 默认设备卡片`}
      className="material-flow-node__equipment-card"
      data-default-equipment-card
    >
      <header className="material-flow-node__equipment-card-header">
        <strong title={name}>{name}</strong>
        <span
          aria-hidden="true"
          className="material-flow-node__equipment-card-dots"
        >
          <i />
          <i />
          <i />
        </span>
      </header>
      <div className="material-flow-node__equipment-card-body">
        <span
          aria-hidden="true"
          className="material-flow-node__equipment-card-icon"
        >
          <DefaultNodeIcon kind="equipment" />
        </span>
        <span>{noun}</span>
      </div>
      <footer className="material-flow-node__equipment-card-footer">
        <span>
          <PlacementIcon />
          {placementLabel(placement)}
        </span>
        <span>
          {siteCount ? `${occupied}/${siteCount} 安装位` : '默认二维外观'}
        </span>
      </footer>
    </section>
  )
}

function DefaultNodeIcon({
  kind
}: {
  kind: DefaultMaterialNodeKind
}): React.JSX.Element {
  if (kind === 'control') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect height="8" rx="2" width="14" x="5" y="3" />
        <path d="M8 7h.01M11 7h5M12 11v4M6.5 15h11" />
        <circle cx="6.5" cy="18" r="2" />
        <circle cx="17.5" cy="18" r="2" />
      </svg>
    )
  }

  if (kind === 'equipment') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect height="15" rx="2.5" width="16" x="4" y="4" />
        <rect height="6" rx="1" width="8" x="8" y="7" />
        <path d="M8 19v2M16 19v2" />
        <circle cx="9" cy="16" r=".75" />
        <path d="M12 16h4" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5M8 5.3l8 4.5" />
    </svg>
  )
}

function PlacementIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M8 14s4-4.1 4-7.3a4 4 0 1 0-8 0C4 9.9 8 14 8 14Z" />
      <circle cx="8" cy="6.7" r="1.4" />
    </svg>
  )
}

function isEquipmentKind(kind: string): boolean {
  return ![
    'plate',
    'tip-rack',
    'tiprack',
    'labware',
    'container',
    'reagent',
    'sample',
    'tube',
    'trash'
  ].some((token) => kind.includes(token))
}

/**
 * Wells and tip spots are drawn in one physical-coordinate SVG. Reusing the
 * same vector geometry prevents fractional CSS boxes and one-pixel borders
 * from making equal 8.2 mm wells appear to have different diameters.
 */
function LabwareSites({
  sites,
  footprintMm,
  ownerMaterialId,
  siteDropStateById
}: {
  sites: readonly MaterialSite[]
  footprintMm: readonly [number, number]
  ownerMaterialId: string
  siteDropStateById?: Readonly<Record<string, MaterialSiteDropState>>
}): React.JSX.Element {
  return (
    <svg
      aria-label="物料孔位"
      className="material-flow-sites-vector"
      preserveAspectRatio="none"
      viewBox={`0 0 ${footprintMm[0]} ${footprintMm[1]}`}
    >
      {sites
        .filter((site) => site.visible !== false)
        .map((site) => {
          const width = Math.max(site.sizeMm[0], 0.5)
          const height = Math.max(site.sizeMm[1], 0.5)
          const x = site.poseInAnchor.positionMm[0]
          const y =
            footprintMm[1] -
            site.poseInAnchor.positionMm[1] -
            height
          const className = siteClassName(
            site,
            'material-flow-site-vector',
            siteDropStateById?.[site.id]
          )

          return site.shape === 'circle' ? (
            <circle
              key={site.id}
              className={className}
              cx={x + width / 2}
              cy={y + height / 2}
              data-material-site-id={site.id}
              data-site-owner-material-id={ownerMaterialId}
              data-site-drop-state={siteDropStateById?.[site.id]}
              data-site-key={site.key}
              r={Math.min(width, height) / 2}
              vectorEffect="non-scaling-stroke"
            >
              <title>{siteTitle(site)}</title>
            </circle>
          ) : (
            <rect
              key={site.id}
              className={className}
              data-material-site-id={site.id}
              data-site-owner-material-id={ownerMaterialId}
              data-site-drop-state={siteDropStateById?.[site.id]}
              data-site-key={site.key}
              height={height}
              rx={Math.min(width, height) * 0.12}
              vectorEffect="non-scaling-stroke"
              width={width}
              x={x}
              y={y}
            >
              <title>{siteTitle(site)}</title>
            </rect>
          )
        })}
    </svg>
  )
}

function siteClassName(
  site: MaterialSite,
  base: string,
  dropState?: MaterialSiteDropState
): string {
  return [
    base,
    `is-${site.kind ?? 'site'}`,
    `is-${site.visual?.state ?? 'empty'}`,
    site.shape === 'circle' ? 'is-circle' : '',
    dropState ? `is-drop-${dropState}` : ''
  ].join(' ')
}

function siteTitle(site: MaterialSite): string {
  return site.name
}

function placementLabel(kind: string): string {
  if (kind === 'world') return '全局'
  if (kind === 'parent') return '父级'
  if (kind === 'site') return '安装位'
  return '未放置'
}
