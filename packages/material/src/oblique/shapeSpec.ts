import type {
  MaterialShapeEnvelopeMm,
  MaterialShapePrimitive,
  MaterialShapeSpec,
  MaterialShapeSpecPart,
  MaterialShapeUnits
} from './shapeSpecTypes'

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
      appendGridPart(out, part, shapeUnits, envelope, scale, offsetXMm, offsetYMm)
      return
    }
    case 'sites': {
      appendSitePart(out, part, z)
      return
    }
    default:
      return
  }
}

/** 将网格声明递归展开为带相对偏移的毫米图元。 */
function appendGridPart(
  out: MaterialShapePrimitive[],
  part: MaterialShapeSpecPart,
  shapeUnits: MaterialShapeUnits,
  envelope: MaterialShapeEnvelopeMm,
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
        offsetXMm + col * pitchX * scale.x,
        offsetYMm + row * pitchY * scale.y
      )
    }
  }
}

/** 把库位（Site）生成器声明投影成专用结构图元。 */
function appendSitePart(
  out: MaterialShapePrimitive[],
  part: MaterialShapeSpecPart,
  z: (value: number) => number
): void {
  switch (part.generator) {
    case 'open-rack':
      out.push({ kind: 'open-rack', boardThicknessMm: part.boardThicknessMm })
      return
    case 'stack-shelves':
      out.push({ kind: 'stack-shelves', shelfThicknessMm: part.shelfThicknessMm })
      return
    case 'site-holes':
      out.push({
        kind: 'site-holes',
        plateTopZMm: optionalZ(part.plateTopZ, z),
        collarTopZMm: optionalZ(part.collarTopZ, z)
      })
      return
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
