import { describe, expect, it } from 'vitest'

import {
  normalizeTimeseries,
  timeseriesPath
} from './series'

describe('device card timeseries', () => {
  it('normalizes numeric samples and drops invalid points', () => {
    expect(normalizeTimeseries([
      4,
      8,
      { x: Number.NaN, y: 3 },
      { x: 4, y: 12 }
    ])).toEqual([
      { x: 0, y: 4 },
      { x: 1, y: 8 },
      { x: 4, y: 12 }
    ])
  })

  it('builds a bounded SVG path', () => {
    expect(timeseriesPath(
      [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      100,
      50
    )).toBe('M8.00,42.00 L92.00,8.00')
  })
})
