import { it, expect } from 'vitest'
import { parseSiteRotation } from './materialBackendGraphCodec'
it('accepts only complete finite numeric XYZ objects or legacy tuples', () => {
    expect(parseSiteRotation({ x: 10, y: -20, z: 288 }, 'rotation')).toEqual([10, -20, 288])
    expect(parseSiteRotation([10, -20, 288], 'rotation')).toEqual([10, -20, 288])
    for (const value of [{ x: 0, y: 0 }, { x: 0, y: null, z: 0 }, { x: 0, y: '2', z: 0 },
      { x: 0, y: 0, z: Infinity }, { x: 0, y: 0, z: 0, w: 0 }, [0, 0], [0, NaN, 0], [0, null, 0]]) {
      expect(() => parseSiteRotation(value, 'rotation')).toThrow('three finite numbers')
    }
  })
