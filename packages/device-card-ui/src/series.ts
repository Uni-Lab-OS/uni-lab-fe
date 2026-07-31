export interface TimeseriesPoint {
  x: number
  y: number
}

export function normalizeTimeseries(
  input: readonly (number | TimeseriesPoint)[]
): TimeseriesPoint[] {
  return input
    .map((point, index) => typeof point === 'number'
      ? { x: index, y: point }
      : point
    )
    .filter((point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y)
    )
}

export function timeseriesPath(
  points: readonly TimeseriesPoint[],
  width: number,
  height: number,
  padding = 8
): string {
  if (points.length === 0) return ''
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const xSpan = maxX - minX || 1
  const ySpan = maxY - minY || 1
  return points.map((point, index) => {
    const x = padding + ((point.x - minX) / xSpan) * (width - padding * 2)
    const y = height - padding -
      ((point.y - minY) / ySpan) * (height - padding * 2)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}
