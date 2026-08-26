import { describe, expect, it } from 'vitest'

import { inferModelFormat } from './modelFormat'

describe('Pascal model format', () => {
  it('honors an explicit URDF declaration for legacy .xacro documents', () => {
    expect(inferModelFormat('/models/device.xacro', 'urdf')).toBe('urdf')
  })

  it('infers the format from the extension when no format is declared', () => {
    expect(inferModelFormat('/models/device.xacro', undefined)).toBe('xacro')
    expect(inferModelFormat('/models/device.glb', undefined)).toBe('gltf')
  })
})
