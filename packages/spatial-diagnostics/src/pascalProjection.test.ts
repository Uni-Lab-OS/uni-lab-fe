import { describe, expect, it } from 'vitest'

import { parseSpatialShadowSnapshot } from './parser'
import {
  projectSpatialShadowToPascal,
  spatialTargetToPascalMatrix,
  transformSpatialPoint
} from './pascalProjection'
import { createSpatialShadowFixtureText } from './testFixture'

describe('spatial Shadow to Pascal projection', () => {
  it('maps target Z-up metres into Pascal Y-up after inverse registration', () => {
    const identity = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ] as const
    const matrix = spatialTargetToPascalMatrix(identity)

    expect(transformSpatialPoint(matrix, [1, 2, 3])).toEqual([1, 3, -2])
  })

  it('applies the inverse source-to-target translation before basis conversion', () => {
    const sourceToTarget = [
      [1, 0, 0, 10],
      [0, 1, 0, -2],
      [0, 0, 1, 4],
      [0, 0, 0, 1]
    ] as const
    const matrix = spatialTargetToPascalMatrix(sourceToTarget)

    expect(transformSpatialPoint(matrix, [10, -2, 4])).toEqual([0, 0, 0])
  })

  it('projects environment, links, corridor, attachments, path and contact evidence', () => {
    const snapshot = parseSpatialShadowSnapshot(createSpatialShadowFixtureText())
    const overlay = projectSpatialShadowToPascal(snapshot, 3)

    expect(overlay.registrationQualified).toBe(false)
    expect(overlay.decision).toBe('unknown')
    expect(overlay.effect).toBe('none')
    expect(overlay.segmentIndex).toBe(3)
    expect(overlay.boxes.some(box => box.role === 'environment')).toBe(true)
    expect(overlay.boxes.filter(box => box.role === 'robot-link')).toHaveLength(7)
    expect(overlay.boxes.some(box => box.role === 'tool')).toBe(true)
    expect(overlay.l1Capsules.length).toBeGreaterThan(0)
    expect(overlay.l1Capsules.every(capsule => capsule.radius > 0)).toBe(true)
    expect(overlay.trajectory.length).toBeGreaterThan(0)
    expect(overlay.contacts.some(contact => contact.role === 'first-contact')).toBe(true)
    expect(overlay.boxes.every(box => box.matrix.length === 16)).toBe(true)
  })
})
