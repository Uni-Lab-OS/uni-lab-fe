import type {
  MaterialShapeEnvelopeMm,
  MaterialShapePrimitive,
  MaterialShapeSpec,
  MaterialShapeSpecPart,
  MaterialShapeUnits
} from './shapeSpecTypes'
import { resolveSiteFallbackMarkers } from './shapeSiteFallback'

export * from './shapeSpecTypes'
export {
  normalizeShapeCategory,
  parseShapeLibrary,
  resolveShapeSpec,
  resolveShapeSpecByIdentity
} from './shapeSpecParser'

interface UnitScale {
  x: number
  y: number
  z: number
  radial: number
}

/**
 * 把一份公共 Shape 声明按物料实例外包展开为毫米图元。
 * @param spec 已通过公共 wire 解析的外形声明。
 * @param envelope 当前物料实例的毫米外包尺寸。
 * @returns 按声明顺序展开且可直接渲染的只读图元集合。
 */
export function resolveShapePrimitives(
  spec: MaterialShapeSpec,
  envelope: MaterialShapeEnvelopeMm
): readonly MaterialShapePrimitive[] {
  const primitives: MaterialShapePrimitive[] = []
  for (const part of spec.parts) {
    appendPart(
      primitives,
      part,
      spec.units,
      envelope,
      spec.envelopeMm,
      0,
      0
    )
  }
  return primitives
}

/**
 * 展开一条声明图元，并把结果追加到同一 Shape 输出集合。
 * @param out 当前 Shape 的可变毫米图元集合。
 * @param part 待解释的声明图元。
 * @param shapeUnits Shape 根声明的默认单位。
 * @param envelope 当前物料实例外包尺寸。
 * @param canonicalEnvelope Shape 声明的可选标准外包，用于安全识别 XY 转置。
 * @param offsetXMm 网格递归累积的 X 偏移。
 * @param offsetYMm 网格递归累积的 Y 偏移。
 * @returns 无；成功时只向 out 追加图元。
 */
function appendPart(
  out: MaterialShapePrimitive[],
  part: MaterialShapeSpecPart,
  shapeUnits: MaterialShapeUnits,
  envelope: MaterialShapeEnvelopeMm,
  canonicalEnvelope: readonly [number, number, number] | undefined,
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
      appendGridPart(
        out,
        part,
        shapeUnits,
        envelope,
        canonicalEnvelope,
        scale,
        offsetXMm,
        offsetYMm
      )
      return
    }
    case 'sites': {
      appendSitePart(
        out,
        part,
        z,
        envelope,
        canonicalEnvelope
      )
      return
    }
    default:
      return
  }
}

/**
 * 将网格声明递归展开为带相对偏移的毫米图元。
 * @param out 当前 Shape 的可变毫米图元集合。
 * @param part 已校验的 grid 声明。
 * @param shapeUnits Shape 根声明的默认单位。
 * @param envelope 当前物料实例外包尺寸。
 * @param canonicalEnvelope Shape 声明的可选标准外包。
 * @param scale 当前网格单位到毫米的缩放。
 * @param offsetXMm 上层网格累积的 X 偏移。
 * @param offsetYMm 上层网格累积的 Y 偏移。
 * @returns 无；按行列顺序向 out 追加展开后的子图元。
 */
function appendGridPart(
  out: MaterialShapePrimitive[],
  part: MaterialShapeSpecPart,
  shapeUnits: MaterialShapeUnits,
  envelope: MaterialShapeEnvelopeMm,
  canonicalEnvelope: readonly [number, number, number] | undefined,
  scale: UnitScale,
  offsetXMm: number,
  offsetYMm: number
): void {
  const [countX, countY] = part.count as readonly [number, number]
  const [pitchX, pitchY] = part.pitch as readonly [number, number]
  if (!part.part) return
  for (let row = 0; row < Math.max(Math.round(countY), 1); row += 1) {
    for (let col = 0; col < Math.max(Math.round(countX), 1); col += 1) {
      appendPart(
        out,
        part.part,
        part.units ?? shapeUnits,
        envelope,
        canonicalEnvelope,
        offsetXMm + col * pitchX * scale.x,
        offsetYMm + row * pitchY * scale.y
      )
    }
  }
}

/**
 * 把库位（Site）生成器声明投影成专用结构图元。
 * @param out 当前 Shape 的可变毫米图元集合。
 * @param part 已校验的 sites 声明。
 * @param z 当前 sites 图元的 Z 坐标换算函数。
 * @param envelope 当前物料实例外包尺寸。
 * @param canonicalEnvelope Shape 声明的可选标准外包。
 * @returns 无；向 out 追加一个专用结构图元。
 */
function appendSitePart(
  out: MaterialShapePrimitive[],
  part: MaterialShapeSpecPart,
  z: (value: number) => number,
  envelope: MaterialShapeEnvelopeMm,
  canonicalEnvelope: readonly [number, number, number] | undefined
): void {
  switch (part.generator) {
    case 'open-rack':
      out.push({ kind: 'open-rack', boardThicknessMm: part.boardThicknessMm })
      return
    case 'stack-shelves':
      out.push({ kind: 'stack-shelves', shelfThicknessMm: part.shelfThicknessMm })
      return
    case 'site-holes': {
      const fallbackMarkers = resolveSiteFallbackMarkers(
        part.fallback,
        envelope,
        canonicalEnvelope
      )
      out.push({
        kind: 'site-holes',
        plateTopZMm: optionalZ(part.plateTopZ, z),
        collarTopZMm: optionalZ(part.collarTopZ, z),
        ...(fallbackMarkers.length > 0 ? { fallbackMarkers } : {})
      })
      return
    }
    default:
      out.push({ kind: 'site-markers' })
  }
}

/** 仅在声明提供高度时应用 z 轴单位换算。 */
function optionalZ(
  value: number | undefined,
  z: (coordinate: number) => number
): number | undefined {
  return value === undefined ? undefined : z(value)
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
