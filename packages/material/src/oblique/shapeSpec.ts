/**
 * 2.5D 外形声明的读取与求解。
 *
 * 外形不再写在前端：设备包在自己的 shape_manifest.yaml 里声明图元，Bridge 通过
 * `/api/v1/material-shapes` 下发，这里只负责校验、按 category 选中一条声明，并把
 * 声明里的归一坐标、网格阵列、位点生成器展开成绘制用的图元列表。
 *
 * 格式定义见 Uni-Lab-SZLab/schemas/shape-manifest-v1.schema.json。
 */

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
export type MaterialShapeGenerator =
  | 'open-rack'
  | 'stack-shelves'
  | 'site-holes'
  | 'site-markers'

const STYLES = new Set<string>([
  'plain',
  'frame',
  'plate',
  'board',
  'body',
  'column',
  'module',
  'shell',
  'beam',
  'shaft',
  'probe',
  'deck',
  'gear',
  'motor',
  'foot',
  'glass',
  'cap',
  'hole',
  'bore',
  'port',
  'seat',
  'pad',
  'rim',
  'hairline'
])

const GENERATORS = new Set<string>([
  'open-rack',
  'stack-shelves',
  'site-holes',
  'site-markers'
])

/** 回转轮廓的一圈：z 与 r 都是图元自身 z 区间与半径内的 0..1 归一值。 */
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
  | { kind: 'site-holes'; plateTopZMm?: number; collarTopZMm?: number }
  | { kind: 'site-markers' }

export interface MaterialShapeEnvelopeMm {
  widthMm: number
  depthMm: number
  heightMm: number
}

/** 归一坐标的解释方式：x/y 按宽/深，z 按高，直径按 min(宽, 深)。 */
interface UnitScale {
  x: number
  y: number
  z: number
  radial: number
}

export function normalizeShapeCategory(value: string): string {
  return value.trim().replaceAll('_', '-').toLowerCase()
}

/**
 * 选中最合适的一条声明：精确 category 胜过子串匹配；同为子串匹配时先看
 * priority（注粉瓶要赢过通用试剂瓶），再看 token 长度。
 */
export function resolveShapeSpec(
  library: MaterialShapeLibrary | undefined,
  kind: string
): MaterialShapeSpec | undefined {
  if (!library || library.length === 0) return undefined
  const normalized = normalizeShapeCategory(kind)
  if (!normalized) return undefined

  let best: MaterialShapeSpec | undefined
  let bestScore = -1
  for (const spec of library) {
    let score = -1
    if (spec.categories.some((category) => category === normalized)) {
      score = Number.MAX_SAFE_INTEGER
    } else {
      for (const token of spec.categoryTokens) {
        if (!token || !normalized.includes(token)) continue
        score = Math.max(score, spec.priority * 1000 + token.length)
      }
    }
    if (score > bestScore) {
      bestScore = score
      best = spec
    }
  }
  return bestScore >= 0 ? best : undefined
}

export function parseShapeLibrary(raw: unknown): MaterialShapeLibrary {
  if (!Array.isArray(raw)) return []
  const specs: MaterialShapeSpec[] = []
  for (const entry of raw) {
    const spec = parseShapeSpec(entry)
    if (spec) specs.push(spec)
  }
  return specs
}

function parseShapeSpec(raw: unknown): MaterialShapeSpec | undefined {
  if (!isRecord(raw)) return undefined
  const id = stringValue(raw.id)
  if (!id) return undefined
  const categories = stringList(raw.categories).map(normalizeShapeCategory)
  const categoryTokens = stringList(raw.categoryTokens).map(
    normalizeShapeCategory
  )
  if (categories.length === 0 && categoryTokens.length === 0) return undefined
  const parts: MaterialShapeSpecPart[] = []
  for (const part of Array.isArray(raw.parts) ? raw.parts : []) {
    const parsed = parseSpecPart(part)
    // 一条声明只要有画不出来的图元就整条弃用，宁可退回实心包围盒，
    // 也不要画出半台设备。
    if (!parsed) return undefined
    parts.push(parsed)
  }
  if (parts.length === 0) return undefined

  return {
    id,
    bundle: stringValue(raw.bundle) ?? 'unknown',
    displayName: stringValue(raw.displayName),
    categories,
    categoryTokens,
    priority: numberValue(raw.priority) ?? 0,
    envelopeMm: triple(raw.envelope),
    units: unitsValue(raw.units) ?? 'mm',
    shadow: shadowValue(raw.shadow),
    sort: raw.sort === 'rear-edge' ? 'rear-edge' : 'center',
    parts
  }
}

function parseSpecPart(raw: unknown): MaterialShapeSpecPart | undefined {
  if (!isRecord(raw)) return undefined
  const type = stringValue(raw.type)
  const styleToken = stringValue(raw.style) ?? 'plain'
  if (!type || !STYLES.has(styleToken)) return undefined
  const style = styleToken as MaterialShapeStyle
  const units = unitsValue(raw.units)
  const base = { style, ...(units ? { units } : {}) }

  switch (type) {
    case 'box':
    case 'edge': {
      const from = triple(raw.from)
      const to = triple(raw.to)
      if (!from || !to) return undefined
      return { ...base, type, from, to }
    }
    case 'slab': {
      const span = pair(raw.z)
      if (!span) return undefined
      return { ...base, type, z: span }
    }
    case 'cylinder': {
      const center = pair(raw.center)
      const span = pair(raw.z)
      const d = numberValue(raw.d)
      if (!center || !span || d === undefined) return undefined
      return { ...base, type, center, z: span, d }
    }
    case 'lathe': {
      const center = pair(raw.center)
      const span = pair(raw.z)
      const d = numberValue(raw.d)
      const rings = ringList(raw.rings)
      if (!center || !span || d === undefined || rings.length < 2) {
        return undefined
      }
      const cap = ringList(raw.cap)
      return {
        ...base,
        type,
        center,
        z: span,
        d,
        rings,
        ...(cap.length > 1 ? { cap } : {}),
        ribs: numberValue(raw.ribs) ?? 9,
        spout: raw.spout === true,
        mouth: raw.mouth === true,
        rim: raw.rim === true
      }
    }
    case 'disc': {
      const center = pair(raw.center)
      const z = numberValue(raw.z)
      const d = numberValue(raw.d)
      if (!center || z === undefined || d === undefined) return undefined
      return { ...base, type, center, z, d }
    }
    case 'rect': {
      const from = pair(raw.from)
      const to = pair(raw.to)
      const z = numberValue(raw.z)
      if (!from || !to || z === undefined) return undefined
      return {
        ...base,
        type,
        from,
        to,
        z,
        radius: numberValue(raw.radius) ?? 0
      }
    }
    case 'grid': {
      const count = pair(raw.count)
      const pitch = pair(raw.pitch)
      const part = parseSpecPart(raw.part)
      if (!count || !pitch || !part || part.type === 'grid') return undefined
      return { ...base, type, count, pitch, part }
    }
    case 'sites': {
      const generator = stringValue(raw.generator)
      if (!generator || !GENERATORS.has(generator)) return undefined
      return {
        ...base,
        type,
        generator: generator as MaterialShapeGenerator,
        boardThicknessMm: numberValue(raw.board_thickness),
        shelfThicknessMm: numberValue(raw.shelf_thickness),
        plateTopZ: numberValue(raw.plate_top_z),
        collarTopZ: numberValue(raw.collar_top_z)
      }
    }
    default:
      return undefined
  }
}

/** 把声明展开成本地 mm 图元：解归一、铺开网格阵列。 */
export function resolveShapePrimitives(
  spec: MaterialShapeSpec,
  envelope: MaterialShapeEnvelopeMm
): readonly MaterialShapePrimitive[] {
  const primitives: MaterialShapePrimitive[] = []
  for (const part of spec.parts) {
    appendPart(primitives, part, spec.units, envelope, 0, 0)
  }
  return primitives
}

function appendPart(
  out: MaterialShapePrimitive[],
  part: MaterialShapeSpecPart,
  shapeUnits: MaterialShapeUnits,
  envelope: MaterialShapeEnvelopeMm,
  offsetXMm: number,
  offsetYMm: number
): void {
  const scale = unitScale(part.units ?? shapeUnits, envelope)
  const x = (value: number): number => value * scale.x + offsetXMm
  const y = (value: number): number => value * scale.y + offsetYMm
  const z = (value: number): number => value * scale.z
  const radial = (value: number): number => value * scale.radial

  switch (part.type) {
    case 'box': {
      const [x0, y0, z0] = part.from as readonly [number, number, number]
      const [x1, y1, z1] = part.to as readonly [number, number, number]
      out.push({
        kind: 'box',
        style: part.style,
        from: [x(x0), y(y0), z(z0)],
        to: [x(x1), y(y1), z(z1)]
      })
      return
    }
    case 'edge': {
      const [x0, y0, z0] = part.from as readonly [number, number, number]
      const [x1, y1, z1] = part.to as readonly [number, number, number]
      out.push({
        kind: 'edge',
        style: part.style,
        from: [x(x0), y(y0), z(z0)],
        to: [x(x1), y(y1), z(z1)]
      })
      return
    }
    case 'slab': {
      const [z0, z1] = part.z as readonly [number, number]
      out.push({
        kind: 'slab',
        style: part.style,
        fromZMm: z(z0),
        toZMm: z(z1)
      })
      return
    }
    case 'cylinder': {
      const [cx, cy] = part.center as readonly [number, number]
      const [z0, z1] = part.z as readonly [number, number]
      out.push({
        kind: 'cylinder',
        style: part.style,
        centerXMm: x(cx),
        centerYMm: y(cy),
        radiusMm: radial(part.d ?? 0) / 2,
        fromZMm: z(z0),
        toZMm: z(z1)
      })
      return
    }
    case 'lathe': {
      const [cx, cy] = part.center as readonly [number, number]
      const [z0, z1] = part.z as readonly [number, number]
      out.push({
        kind: 'lathe',
        style: part.style,
        centerXMm: x(cx),
        centerYMm: y(cy),
        radiusMm: radial(part.d ?? 0) / 2,
        fromZMm: z(z0),
        toZMm: z(z1),
        rings: part.rings ?? [],
        ...(part.cap ? { cap: part.cap } : {}),
        ribs: part.ribs ?? 9,
        spout: part.spout === true,
        mouth: part.mouth === true,
        rim: part.rim === true
      })
      return
    }
    case 'disc': {
      const [cx, cy] = part.center as readonly [number, number]
      out.push({
        kind: 'disc',
        style: part.style,
        centerXMm: x(cx),
        centerYMm: y(cy),
        radiusMm: radial(part.d ?? 0) / 2,
        zMm: z(part.z as number)
      })
      return
    }
    case 'rect': {
      const [x0, y0] = part.from as readonly [number, number]
      const [x1, y1] = part.to as readonly [number, number]
      const left = x(Math.min(x0, x1))
      const bottom = y(Math.min(y0, y1))
      out.push({
        kind: 'rect',
        style: part.style,
        xMm: left,
        yMm: bottom,
        widthMm: Math.abs(x1 - x0) * scale.x,
        depthMm: Math.abs(y1 - y0) * scale.y,
        zMm: z(part.z as number),
        radiusMm: radial(part.radius ?? 0)
      })
      return
    }
    case 'grid': {
      const [countX, countY] = part.count as readonly [number, number]
      const [pitchX, pitchY] = part.pitch as readonly [number, number]
      const inner = part.part
      if (!inner) return
      for (let row = 0; row < Math.max(Math.round(countY), 1); row += 1) {
        for (let col = 0; col < Math.max(Math.round(countX), 1); col += 1) {
          appendPart(
            out,
            inner,
            part.units ?? shapeUnits,
            envelope,
            offsetXMm + col * pitchX * scale.x,
            offsetYMm + row * pitchY * scale.y
          )
        }
      }
      return
    }
    case 'sites': {
      switch (part.generator) {
        case 'open-rack':
          out.push({
            kind: 'open-rack',
            boardThicknessMm: part.boardThicknessMm
          })
          return
        case 'stack-shelves':
          out.push({
            kind: 'stack-shelves',
            shelfThicknessMm: part.shelfThicknessMm
          })
          return
        case 'site-holes':
          out.push({
            kind: 'site-holes',
            plateTopZMm:
              part.plateTopZ === undefined ? undefined : z(part.plateTopZ),
            collarTopZMm:
              part.collarTopZ === undefined ? undefined : z(part.collarTopZ)
          })
          return
        default:
          out.push({ kind: 'site-markers' })
          return
      }
    }
    default:
      return
  }
}

function unitScale(
  units: MaterialShapeUnits,
  envelope: MaterialShapeEnvelopeMm
): UnitScale {
  if (units !== 'ratio') return { x: 1, y: 1, z: 1, radial: 1 }
  return {
    x: envelope.widthMm,
    y: envelope.depthMm,
    z: envelope.heightMm,
    radial: Math.min(envelope.widthMm, envelope.depthMm)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function unitsValue(value: unknown): MaterialShapeUnits | undefined {
  return value === 'mm' || value === 'ratio' ? value : undefined
}

function shadowValue(value: unknown): MaterialShapeShadow {
  return value === 'round' || value === 'none' ? value : 'box'
}

function pair(value: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const first = numberValue(value[0])
  const second = numberValue(value[1])
  if (first === undefined || second === undefined) return undefined
  return [first, second]
}

function triple(
  value: unknown
): readonly [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined
  const parsed = value.slice(0, 3).map(numberValue)
  if (parsed.some((entry) => entry === undefined)) return undefined
  return parsed as [number, number, number]
}

function ringList(value: unknown): MaterialShapeRing[] {
  if (!Array.isArray(value)) return []
  const rings: MaterialShapeRing[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const z = numberValue(entry.z)
    const r = numberValue(entry.r)
    if (z === undefined || r === undefined) continue
    rings.push({ z, r })
  }
  return rings
}
