import { describe, expect, it } from 'vitest'
import type { CapacityLimits } from '@unilab-fe/core'
import { defaultCapacityUnit, formatCapacity, toCapacityInput } from './reagentCapacity'

const capacity = (value: Partial<CapacityLimits>): CapacityLimits => ({
  maxVolumeUl: null,
  maxMassG: null,
  raw: {},
  ...value,
})

describe('reagent capacity helpers', () => {
  it('converts volume and mass units into the OS dimensions', () => {
    expect(toCapacityInput(1.5, 'mL')).toEqual({ maxVolumeUl: 1500 })
    expect(toCapacityInput(2, 'kg')).toEqual({ maxMassG: 2000 })
  })

  it('rejects units outside the supported capacity dimensions', () => {
    expect(() => toCapacityInput(1, 'mol')).toThrow('未知装料上限单位 mol')
  })

  it('keeps a declared quantity dimension and falls back to mL when absent', () => {
    expect(defaultCapacityUnit('mg')).toBe('mg')
    expect(defaultCapacityUnit('uL')).toBe('uL')
    expect(defaultCapacityUnit(null)).toBe('mL')
    expect(defaultCapacityUnit('unknown')).toBe('mL')
  })

  it.each([
    [null, '未提供'],
    [capacity({ maxVolumeUl: 1_000_000 }), '1 L'],
    [capacity({ maxVolumeUl: 1250.5 }), '1.2505 mL'],
    [capacity({ maxVolumeUl: 12.3456 }), '12.3456 uL'],
    [capacity({ maxMassG: 2_000 }), '2 kg'],
    [capacity({ maxMassG: 0.25 }), '250 mg'],
    [capacity({ maxMassG: 12.3456 }), '12.3456 g'],
    [capacity({}), '未提供'],
  ] as const)('formats %j as %s', (capacity, expected) => {
    expect(formatCapacity(capacity)).toBe(expected)
  })
})
