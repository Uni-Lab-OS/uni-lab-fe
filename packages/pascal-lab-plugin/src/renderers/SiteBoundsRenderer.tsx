import { useEffect, useMemo, useState } from 'react'
import {
  BoxGeometry,
  CylinderGeometry,
  EdgesGeometry,
  type Object3D
} from 'three'

import type { LabFloorplanSite } from '../schema'
import { labPoseToPascal, MILLIMETERS_TO_METERS } from '../units'

export interface SiteBoundsTransform {
  position: [number, number, number]
  scale: [number, number, number]
}

export type SiteBoundsGeometry =
  | {
      kind: 'box'
      position: [number, number, number]
      size: [number, number, number]
    }
  | {
      kind: 'cylinder'
      position: [number, number, number]
      radius: number
      height: number
    }

const SITE_BOUND_HIT_MARKER = 'unilabSiteBound'

/**
 * 判断射线是否命中了库位（Site）辅助几何，而非物料（Material）身体。
 *
 * @param object Three.js 射线返回的最内层场景对象。
 * @returns 命中对象或其祖先属于库位辅助框时返回 true。
 */
export function isSiteBoundsPointerHit(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (current.userData[SITE_BOUND_HIT_MARKER] === true) return true
    current = current.parent
  }
  return false
}

/**
 * 读取库位（Site）辅助几何绑定的占用物料（Material）场景身份。
 *
 * @param object Three.js 射线返回的最内层场景对象。
 * @returns 有唯一占用物料时返回 Pascal 场景 ID，否则返回 null。
 */
export function siteBoundsOccupantSceneObjectId(
  object: Object3D
): string | null {
  let current: Object3D | null = object
  while (current) {
    if (current.userData[SITE_BOUND_HIT_MARKER] === true) {
      const occupant = current.userData.occupantSceneObjectId
      return typeof occupant === 'string' && occupant.length > 0
        ? occupant
        : null
    }
    current = current.parent
  }
  return null
}

/** Convert a lower-left Z-up Site box into a centered Pascal Y-up box. */
export function siteBoundsTransform(
  site: LabFloorplanSite
): SiteBoundsTransform {
  const [widthMm, lengthMm, depthMm] = site.sizeMm
  const [xMm, yMm, zMm] = site.positionMm
  const centered = labPoseToPascal({
    positionMm: [
      xMm + widthMm / 2,
      yMm + lengthMm / 2,
      zMm + depthMm / 2
    ],
    rotationDegXYZ: [0, 0, 0]
  })
  return {
    position: centered.position,
    scale: [
      Math.max(widthMm * MILLIMETERS_TO_METERS, 0.001),
      Math.max(depthMm * MILLIMETERS_TO_METERS, 0.001),
      Math.max(lengthMm * MILLIMETERS_TO_METERS, 0.001)
    ]
  }
}

export function siteBoundsGeometry(
  site: LabFloorplanSite
): SiteBoundsGeometry {
  const { position, scale } = siteBoundsTransform(site)
  if (site.shape === 'circle') {
    return {
      kind: 'cylinder',
      position,
      radius: Math.min(scale[0], scale[2]) / 2,
      height: scale[1]
    }
  }
  return { kind: 'box', position, size: scale }
}

/**
 * Drei's `Edges` uses an InstancedBufferGeometry whose default instance count
 * is `Infinity`. WebGPU submits that value directly to `drawIndexed`, which
 * rejects the entire frame. Native EdgesGeometry has a finite vertex count and
 * keeps the same blue-outline presentation without poisoning Pascal's renderer.
 */
export function createSiteOutlineGeometry(
  geometry: SiteBoundsGeometry
): EdgesGeometry {
  const surface = geometry.kind === 'cylinder'
    ? new CylinderGeometry(
        geometry.radius,
        geometry.radius,
        geometry.height,
        32
      )
    : new BoxGeometry(...geometry.size)
  const outline = new EdgesGeometry(surface, 15)
  surface.dispose()
  return outline
}

export function selectRenderableSiteBounds(
  sites: readonly LabFloorplanSite[],
  showSites: boolean,
  hoveredSiteId: string | null
): LabFloorplanSite[] {
  return sites.filter(
    (site) =>
      site.visible &&
      !site.occupied &&
      (showSites || site.id === hoveredSiteId)
  )
}

function SiteGeometry({
  geometry
}: {
  geometry: SiteBoundsGeometry
}): React.JSX.Element {
  return geometry.kind === 'cylinder' ? (
    <cylinderGeometry
      args={[geometry.radius, geometry.radius, geometry.height, 32]}
    />
  ) : (
    <boxGeometry args={geometry.size} />
  )
}

function SiteBound({
  site,
  shown,
  onHover
}: {
  site: LabFloorplanSite
  shown: boolean
  onHover: React.Dispatch<React.SetStateAction<string | null>>
}): React.JSX.Element {
  const geometry = useMemo(
    () => siteBoundsGeometry(site),
    [site.positionMm, site.shape, site.sizeMm]
  )
  const outlineGeometry = useMemo(
    () => createSiteOutlineGeometry(geometry),
    [geometry]
  )
  useEffect(
    () => () => outlineGeometry.dispose(),
    [outlineGeometry]
  )
  return (
    <mesh
      name={`unilab-site-bound-${site.id}`}
      position={geometry.position}
      renderOrder={18}
      userData={{
        [SITE_BOUND_HIT_MARKER]: true,
        occupantSceneObjectId: site.occupantSceneObjectId,
        siteId: site.id,
        siteShape: geometry.kind
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        onHover(site.id)
      }}
      onPointerOut={(event) => {
        event.stopPropagation()
        onHover((current) => (current === site.id ? null : current))
      }}
    >
      <SiteGeometry geometry={geometry} />
      <meshBasicMaterial
        color="#bae6fd"
        depthTest
        depthWrite={false}
        opacity={shown ? 0.24 : 0}
        transparent
      />
      {shown && (
        <lineSegments geometry={outlineGeometry} renderOrder={19}>
          <lineBasicMaterial
            color="#38bdf8"
            depthTest
            depthWrite={false}
          />
        </lineSegments>
      )}
    </mesh>
  )
}

/**
 * Empty Sites are always raycastable. The toolbar switch controls whether
 * they are persistently visible; with it off, only the hovered Site appears.
 */
export function SiteBoundsRenderer({
  sites,
  showSites
}: {
  sites: readonly LabFloorplanSite[]
  showSites: boolean
}): React.JSX.Element | null {
  const [hoveredSiteId, setHoveredSiteId] = useState<string | null>(null)
  const hitSites = useMemo(
    () => selectRenderableSiteBounds(sites, true, null),
    [sites]
  )
  const shownSiteIds = useMemo(
    () =>
      new Set(
        selectRenderableSiteBounds(sites, showSites, hoveredSiteId).map(
          (site) => site.id
        )
      ),
    [hoveredSiteId, showSites, sites]
  )

  if (hitSites.length === 0) return null

  return (
    <group
      name="unilab-site-bounds"
      userData={{
        hitSiteCount: hitSites.length,
        shownSiteCount: shownSiteIds.size
      }}
    >
      {hitSites.map((site) => (
        <SiteBound
          key={site.id}
          site={site}
          shown={shownSiteIds.has(site.id)}
          onHover={setHoveredSiteId}
        />
      ))}
    </group>
  )
}
