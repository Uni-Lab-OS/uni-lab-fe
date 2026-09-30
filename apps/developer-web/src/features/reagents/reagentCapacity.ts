import type { CapacityInput, CapacityLimits } from '@unilab-fe/core'

const VOLUME_UNITS: Readonly<Record<string, number>> = {
  uL: 1,
  mL: 1000,
  L: 1_000_000,
}

const MASS_UNITS: Readonly<Record<string, number>> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
}

/** 单位本身已经决定了维度，因此表单只需要选单位，不必再单独选体积/质量。 */
export const CAPACITY_UNIT_OPTIONS: readonly string[] = [
  ...Object.keys(VOLUME_UNITS),
  ...Object.keys(MASS_UNITS),
]

/**
 * 把表单填写的上限换算成 OS 的单一维度。OS 只接受 `max_volume_ul` 或
 * `max_mass_g` 之一，维度由所选单位推断。
 */
export function toCapacityInput(value: number, unit: string): CapacityInput {
  const volumeFactor = VOLUME_UNITS[unit]
  if (volumeFactor != null) return { maxVolumeUl: value * volumeFactor }
  const massFactor = MASS_UNITS[unit]
  if (massFactor != null) return { maxMassG: value * massFactor }
  throw new Error(`未知装料上限单位 ${unit}`)
}

/** 按数量单位给出默认上限单位，液体按体积、粉末按质量。 */
export function defaultCapacityUnit(quantityUnit: string | null): string {
  if (quantityUnit && Object.keys(MASS_UNITS).includes(quantityUnit)) return quantityUnit
  if (quantityUnit && Object.keys(VOLUME_UNITS).includes(quantityUnit)) return quantityUnit
  return 'mL'
}

/** 以可读单位展示 OS 返回的生效上限；未声明时明确说明未提供。 */
export function formatCapacity(capacity: CapacityLimits | null): string {
  if (!capacity) return '未提供'
  if (capacity.maxVolumeUl != null) {
    const ul = capacity.maxVolumeUl
    if (ul >= 1_000_000) return `${trim(ul / 1_000_000)} L`
    if (ul >= 1000) return `${trim(ul / 1000)} mL`
    return `${trim(ul)} uL`
  }
  if (capacity.maxMassG != null) {
    const g = capacity.maxMassG
    if (g >= 1000) return `${trim(g / 1000)} kg`
    if (g < 1) return `${trim(g * 1000)} mg`
    return `${trim(g)} g`
  }
  return '未提供'
}

function trim(value: number): string {
  return String(Number(value.toFixed(4)))
}
