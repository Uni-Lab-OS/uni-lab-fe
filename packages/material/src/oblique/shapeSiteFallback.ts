import type {
  MaterialShapeEnvelopeMm,
  MaterialShapeFallbackMarker,
  MaterialShapeSpecPart
} from './shapeSpecTypes'

/**
 * 把 site-holes 的可选毫米网格兜底展开成无库存身份的内部矩形标记。
 * @param fallback 已通过公共 wire 解析的可选 fallback grid。
 * @param envelope 当前物料实例外包尺寸。
 * @param canonicalEnvelope Shape 声明的标准外包尺寸。
 * @returns 可安全绘制的内部标记；声明不完整或方向无法确认时返回空集合。
 */
export function resolveSiteFallbackMarkers(
  fallback: MaterialShapeSpecPart | undefined,
  envelope: MaterialShapeEnvelopeMm,
  canonicalEnvelope: readonly [number, number, number] | undefined
): readonly MaterialShapeFallbackMarker[] {
  if (!fallback || fallback.units !== 'mm' || fallback.part?.type !== 'rect') {
    return []
  }
  const transpose = fallbackNeedsTranspose(
    fallback,
    envelope,
    canonicalEnvelope
  )
  if (transpose === undefined) return []

  const [countX, countY] = fallback.count ?? []
  const [pitchX, pitchY] = fallback.pitch ?? []
  const [fromX, fromY] = fallback.part.from ?? []
  const [toX, toY] = fallback.part.to ?? []
  const zMm = fallback.part.z
  if (
    !isFiniteNumber(countX) ||
    !isFiniteNumber(countY) ||
    !isFiniteNumber(pitchX) ||
    !isFiniteNumber(pitchY) ||
    !isFiniteNumber(fromX) ||
    !isFiniteNumber(fromY) ||
    !isFiniteNumber(toX) ||
    !isFiniteNumber(toY) ||
    !isFiniteNumber(zMm)
  ) {
    return []
  }

  const markers: MaterialShapeFallbackMarker[] = []
  const columns = Math.max(Math.round(countX), 1)
  const rows = Math.max(Math.round(countY), 1)
  const widthMm = Math.abs(toX - fromX)
  const depthMm = Math.abs(toY - fromY)
  const firstXMm = Math.min(fromX, toX)
  const firstYMm = Math.min(fromY, toY)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const xMm = firstXMm + column * pitchX
      const yMm = firstYMm + row * pitchY
      markers.push({
        style: fallback.part.style,
        xMm: transpose ? yMm : xMm,
        yMm: transpose ? xMm : yMm,
        widthMm: transpose ? depthMm : widthMm,
        depthMm: transpose ? widthMm : depthMm,
        zMm,
        radiusMm: fallback.part.radius ?? 0
      })
    }
  }
  return markers
}

/**
 * 判断外部 Shape 数值是否为可计算的有限数。
 * @param value 可疑 wire 数值。
 * @returns 值是有限 number 时为 true。
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 根据标准外包与实例外包的宽深比判断兜底网格是否应交换 X/Y。
 * @param fallback 已校验的 fallback grid 声明。
 * @param envelope 当前物料实例外包尺寸。
 * @param canonicalEnvelope Shape 声明的标准外包尺寸。
 * @returns true 表示转置，false 表示保持；比例偏差超过 2% 时返回 undefined。
 */
function fallbackNeedsTranspose(
  fallback: MaterialShapeSpecPart,
  envelope: MaterialShapeEnvelopeMm,
  canonicalEnvelope: readonly [number, number, number] | undefined
): boolean | undefined {
  if (fallback.orientation !== 'match-envelope' || !canonicalEnvelope) {
    return undefined
  }
  const [canonicalWidth, canonicalDepth] = canonicalEnvelope
  const { widthMm, depthMm } = envelope
  if (
    canonicalWidth <= 0 ||
    canonicalDepth <= 0 ||
    widthMm <= 0 ||
    depthMm <= 0
  ) {
    return undefined
  }
  const actualRatio = widthMm / depthMm
  const canonicalRatio = canonicalWidth / canonicalDepth
  const directError = Math.abs(Math.log(actualRatio / canonicalRatio))
  const swappedError = Math.abs(Math.log(actualRatio * canonicalRatio))
  if (Math.min(directError, swappedError) > Math.log(1.02)) return undefined
  return swappedError < directError
}
