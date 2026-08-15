import type {
  MaterialShapeGenerator,
  MaterialShapeLibrary,
  MaterialShapeRing,
  MaterialShapeShadow,
  MaterialShapeSpec,
  MaterialShapeSpecPart,
  MaterialShapeStyle,
  MaterialShapeUnits
} from './shapeSpecTypes'

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

export function normalizeShapeCategory(value: string): string {
  return value.trim().replaceAll('_', '-').toLowerCase()
}

/**
 * 选中最合适的一条声明：精确 category / shape id 胜过子串匹配；同为子串
 * 匹配时先看 priority（注粉瓶要赢过通用试剂瓶），再看 token 长度。资源模板
 * 身份可能是完整 Python FQID，因此注册 shape id 也可以作为稳定匹配词。
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
    const shapeId = normalizeShapeCategory(spec.id)
    if (
      spec.categories.some((category) => category === normalized) ||
      shapeId === normalized
    ) {
      score = Number.MAX_SAFE_INTEGER
    } else {
      for (const token of [...spec.categoryTokens, shapeId]) {
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

/**
 * 按 Backend 公共外形的复合稳定身份精确选择声明。
 *
 * @param library `/api/v1/material-shapes` 解析后的外形目录。
 * @param bundle 物料快照声明的设备包身份。
 * @param id 物料快照声明的包内外形身份。
 * @returns 复合身份完全一致的外形；目录缺失或未命中时返回 undefined。
 */
export function resolveShapeSpecByIdentity(
  library: MaterialShapeLibrary | undefined,
  bundle: string,
  id: string
): MaterialShapeSpec | undefined {
  if (!library || library.length === 0) return undefined
  const normalizedBundle = bundle.trim()
  const normalizedId = id.trim()
  if (!normalizedBundle || !normalizedId) return undefined
  return library.find(
    (spec) =>
      spec.bundle === normalizedBundle && spec.id === normalizedId
  )
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

interface ShapePartBase {
  style: MaterialShapeStyle
  units?: MaterialShapeUnits
}

/** 先校验公共字段，再把图元类型分派给各自的小型解析器。 */
function parseSpecPart(raw: unknown): MaterialShapeSpecPart | undefined {
  if (!isRecord(raw)) return undefined
  const type = stringValue(raw.type)
  const styleToken = stringValue(raw.style) ?? 'plain'
  if (!type || !STYLES.has(styleToken)) return undefined
  const units = unitsValue(raw.units)
  const base: ShapePartBase = {
    style: styleToken as MaterialShapeStyle,
    ...(units ? { units } : {})
  }

  switch (type) {
    case 'box':
    case 'edge':
      return parseBoxLikePart(raw, type, base)
    case 'slab':
      return parseSlabPart(raw, base)
    case 'cylinder':
      return parseCylinderPart(raw, base)
    case 'lathe':
      return parseLathePart(raw, base)
    case 'disc':
      return parseDiscPart(raw, base)
    case 'rect':
      return parseRectPart(raw, base)
    case 'grid':
      return parseGridPart(raw, base)
    case 'sites':
      return parseSitesPart(raw, base)
    default:
      return undefined
  }
}

/** 解析共享三维起止坐标的盒体或棱边图元。 */
function parseBoxLikePart(
  raw: Record<string, unknown>,
  type: 'box' | 'edge',
  base: ShapePartBase
): MaterialShapeSpecPart | undefined {
  const from = triple(raw.from)
  const to = triple(raw.to)
  return from && to ? { ...base, type, from, to } : undefined
}

/** 解析仅包含 z 轴区间的层板图元。 */
function parseSlabPart(
  raw: Record<string, unknown>,
  base: ShapePartBase
): MaterialShapeSpecPart | undefined {
  const z = pair(raw.z)
  return z ? { ...base, type: 'slab', z } : undefined
}

/** 解析圆柱中心、直径和高度区间。 */
function parseCylinderPart(
  raw: Record<string, unknown>,
  base: ShapePartBase
): MaterialShapeSpecPart | undefined {
  const center = pair(raw.center)
  const z = pair(raw.z)
  const d = numberValue(raw.d)
  return center && z && d !== undefined
    ? { ...base, type: 'cylinder', center, z, d }
    : undefined
}

/** 解析带轮廓环、封口和可选细节的回转体图元。 */
function parseLathePart(
  raw: Record<string, unknown>,
  base: ShapePartBase
): MaterialShapeSpecPart | undefined {
  const center = pair(raw.center)
  const z = pair(raw.z)
  const d = numberValue(raw.d)
  const rings = ringList(raw.rings)
  if (!center || !z || d === undefined || rings.length < 2) return undefined
  const cap = ringList(raw.cap)
  return {
    ...base,
    type: 'lathe',
    center,
    z,
    d,
    rings,
    ...(cap.length > 1 ? { cap } : {}),
    ribs: numberValue(raw.ribs) ?? 9,
    spout: raw.spout === true,
    mouth: raw.mouth === true,
    rim: raw.rim === true
  }
}

/** 解析水平圆盘图元。 */
function parseDiscPart(
  raw: Record<string, unknown>,
  base: ShapePartBase
): MaterialShapeSpecPart | undefined {
  const center = pair(raw.center)
  const z = numberValue(raw.z)
  const d = numberValue(raw.d)
  return center && z !== undefined && d !== undefined
    ? { ...base, type: 'disc', center, z, d }
    : undefined
}

/** 解析带可选圆角的水平矩形图元。 */
function parseRectPart(
  raw: Record<string, unknown>,
  base: ShapePartBase
): MaterialShapeSpecPart | undefined {
  const from = pair(raw.from)
  const to = pair(raw.to)
  const z = numberValue(raw.z)
  if (!from || !to || z === undefined) return undefined
  return {
    ...base,
    type: 'rect',
    from,
    to,
    z,
    radius: numberValue(raw.radius) ?? 0
  }
}

/** 解析不可递归嵌套网格的阵列图元。 */
function parseGridPart(
  raw: Record<string, unknown>,
  base: ShapePartBase
): MaterialShapeSpecPart | undefined {
  const count = pair(raw.count)
  const pitch = pair(raw.pitch)
  const part = parseSpecPart(raw.part)
  if (!count || !pitch || !part || part.type === 'grid') return undefined
  return { ...base, type: 'grid', count, pitch, part }
}

/**
 * 解析由库位（Site）集合驱动的结构生成器。
 * @param raw 公共 Shape wire 中的一条 sites 图元。
 * @param base 已校验的样式与单位公共字段。
 * @returns 可绘制的 sites 图元；生成器或可选兜底无效时返回 undefined。
 */
function parseSitesPart(
  raw: Record<string, unknown>,
  base: ShapePartBase
): MaterialShapeSpecPart | undefined {
  const generator = stringValue(raw.generator)
  if (!generator || !GENERATORS.has(generator)) return undefined
  const hasFallback = raw.fallback !== undefined
  const fallback = hasFallback ? parseSiteFallback(raw.fallback) : undefined
  if (hasFallback && !fallback) return undefined
  if (fallback && generator !== 'site-holes') return undefined
  return {
    ...base,
    type: 'sites',
    generator: generator as MaterialShapeGenerator,
    boardThicknessMm: numberValue(raw.board_thickness),
    shelfThicknessMm: numberValue(raw.shelf_thickness),
    plateTopZ: numberValue(raw.plate_top_z),
    collarTopZ: numberValue(raw.collar_top_z),
    ...(fallback ? { fallback } : {})
  }
}

/**
 * 解析无真实库位（Site）时使用的毫米网格兜底。
 * @param raw sites 图元中的可疑 fallback 字段。
 * @returns 仅含矩形子图元的 grid；字段不完整或方向策略无效时返回 undefined。
 */
function parseSiteFallback(raw: unknown): MaterialShapeSpecPart | undefined {
  if (!isRecord(raw)) return undefined
  if (raw.orientation !== 'match-envelope') return undefined
  const fallback = parseSpecPart(raw)
  if (
    !fallback ||
    fallback.type !== 'grid' ||
    fallback.units !== 'mm' ||
    fallback.part?.type !== 'rect'
  ) {
    return undefined
  }
  return { ...fallback, orientation: 'match-envelope' }
}

/** 把声明展开成本地 mm 图元：解归一、铺开网格阵列。 */

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
