import { describe, expect, it } from 'vitest'
import {
  HISTORY_EVENT_LABELS,
  LOOKUP_TITLES,
  PHYSICAL_STATE_OPTIONS,
  historyEventLabel,
  isChineseName,
  physicalStateLabel,
  readCapacity,
  readObservedAt,
  text,
} from './reagentModalShared'

describe('reagent modal domain helpers', () => {
  it('keeps known history and physical state labels stable while preserving unknown values', () => {
    expect(historyEventLabel('add')).toBe('增加')
    expect(historyEventLabel('future_event')).toBe('future_event')
    expect(physicalStateLabel('liquid')).toBe('液体')
    expect(physicalStateLabel(null)).toBe('未提供')
    expect(physicalStateLabel('plasma')).toBe('plasma')
    expect(Object.keys(HISTORY_EVENT_LABELS)).toEqual(
      expect.arrayContaining(['add', 'remove', 'adjust', 'dispense_source', 'dispense_target']),
    )
    expect(Object.keys(LOOKUP_TITLES)).toEqual(
      expect.arrayContaining(['registered', 'ok', 'not_found', 'unavailable']),
    )
    expect(PHYSICAL_STATE_OPTIONS).toEqual(
      expect.arrayContaining([{ value: 'solid', label: '固体' }]),
    )
  })

  it('omits an unchanged capacity and converts explicit values', () => {
    expect(readCapacity({ capacityValue: '' })).toBeUndefined()
    expect(readCapacity({ capacityValue: null })).toBeUndefined()
    expect(readCapacity({ capacityValue: 2, capacityUnit: 'mL' })).toEqual({ maxVolumeUl: 2000 })
    expect(readCapacity({ capacityValue: '3', capacityUnit: 'kg' })).toEqual({ maxMassG: 3000 })
  })

  it('normalizes observed timestamps and free text at the form boundary', () => {
    expect(readObservedAt(null)).toBeUndefined()
    expect(readObservedAt({ toISOString: () => '2026-10-01T00:00:00.000Z' })).toBe(
      '2026-10-01T00:00:00.000Z',
    )
    expect(text('  乙醇  ')).toBe('乙醇')
    expect(text('   ')).toBeUndefined()
    expect(text(null)).toBeUndefined()
    expect(isChineseName('乙醇')).toBe(true)
    expect(isChineseName('ethanol')).toBe(false)
  })
})
