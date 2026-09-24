const TWO_PI = 2 * Math.PI

/** 取与 reference 等价且最近的角（弧度），跨 ±π 时保持连续。 */
export function unwrapAngleRad(value: number, reference: number): number {
  if (!Number.isFinite(reference)) return value
  return reference +
    ((((value - reference) + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI -
    Math.PI
}
