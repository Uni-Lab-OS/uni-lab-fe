/** 2.5D 外形声明与求解图元的共享类型。 */

export type MaterialShapeStyle =
  | 'plain'
  | 'frame'
  | 'plate'
  | 'board'
  | 'body'
  | 'column'
  | 'module'
  | 'shell'
  | 'beam'
  | 'shaft'
  | 'probe'
  | 'deck'
  | 'gear'
  | 'motor'
  | 'foot'
  | 'glass'
  | 'cap'
  | 'hole'
  | 'bore'
  | 'port'
  | 'seat'
  | 'pad'
  | 'rim'
  | 'hairline'

export type MaterialShapeUnits = 'mm' | 'ratio'
export type MaterialShapeShadow = 'box' | 'round' | 'none'
export type MaterialShapeSort = 'center' | 'rear-edge'
export type MaterialShapeFallbackOrientation = 'match-envelope'
export type MaterialShapeGenerator =
  | 'open-rack'
  | 'stack-shelves'
  | 'site-holes'
  | 'site-markers'


export interface MaterialShapeRing {
  z: number
  r: number
}

export interface MaterialShapeSpecPart {
  type:
    | 'box'
    | 'slab'
    | 'cylinder'
    | 'lathe'
    | 'disc'
    | 'rect'
    | 'edge'
    | 'grid'
    | 'sites'
  style: MaterialShapeStyle
  units?: MaterialShapeUnits
  from?: readonly number[]
  to?: readonly number[]
  center?: readonly number[]
  d?: number
  z?: number | readonly number[]
  radius?: number
  rings?: readonly MaterialShapeRing[]
  cap?: readonly MaterialShapeRing[]
  ribs?: number
  spout?: boolean
  mouth?: boolean
  rim?: boolean
  count?: readonly number[]
  pitch?: readonly number[]
  part?: MaterialShapeSpecPart
  orientation?: MaterialShapeFallbackOrientation
  fallback?: MaterialShapeSpecPart
  generator?: MaterialShapeGenerator
  boardThicknessMm?: number
  shelfThicknessMm?: number
  plateTopZ?: number
  collarTopZ?: number
}

export interface MaterialShapeSpec {
  id: string
  bundle: string
  displayName?: string
  categories: readonly string[]
  categoryTokens: readonly string[]
  priority: number
  envelopeMm?: readonly [number, number, number]
  units: MaterialShapeUnits
  shadow: MaterialShapeShadow
  sort: MaterialShapeSort
  parts: readonly MaterialShapeSpecPart[]
}

export type MaterialShapeLibrary = readonly MaterialShapeSpec[]

/** 无真实库位（Site）时可绘制的内部结构标记，不携带任何库存身份或占用语义。 */
export interface MaterialShapeFallbackMarker {
  style: MaterialShapeStyle
  xMm: number
  yMm: number
  widthMm: number
  depthMm: number
  zMm: number
  radiusMm: number
}

/** 求解后的图元：坐标已是物料本地 mm，画布只管画。 */
export type MaterialShapePrimitive =
  | {
      kind: 'box'
      style: MaterialShapeStyle
      from: readonly [number, number, number]
      to: readonly [number, number, number]
    }
  | {
      kind: 'slab'
      style: MaterialShapeStyle
      fromZMm: number
      toZMm: number
    }
  | {
      kind: 'cylinder'
      style: MaterialShapeStyle
      centerXMm: number
      centerYMm: number
      radiusMm: number
      fromZMm: number
      toZMm: number
    }
  | {
      kind: 'lathe'
      style: MaterialShapeStyle
      centerXMm: number
      centerYMm: number
      radiusMm: number
      fromZMm: number
      toZMm: number
      rings: readonly MaterialShapeRing[]
      cap?: readonly MaterialShapeRing[]
      ribs: number
      spout: boolean
      mouth: boolean
      rim: boolean
    }
  | {
      kind: 'disc'
      style: MaterialShapeStyle
      centerXMm: number
      centerYMm: number
      radiusMm: number
      zMm: number
    }
  | {
      kind: 'rect'
      style: MaterialShapeStyle
      xMm: number
      yMm: number
      widthMm: number
      depthMm: number
      zMm: number
      radiusMm: number
    }
  | {
      kind: 'edge'
      style: MaterialShapeStyle
      from: readonly [number, number, number]
      to: readonly [number, number, number]
    }
  | { kind: 'open-rack'; boardThicknessMm?: number }
  | { kind: 'stack-shelves'; shelfThicknessMm?: number }
  | {
      kind: 'site-holes'
      plateTopZMm?: number
      collarTopZMm?: number
      fallbackMarkers?: readonly MaterialShapeFallbackMarker[]
    }
  | { kind: 'site-markers' }

export interface MaterialShapeEnvelopeMm {
  widthMm: number
  depthMm: number
  heightMm: number
}

/** 归一坐标的解释方式：x/y 按宽/深，z 按高，直径按 min(宽, 深)。 */
