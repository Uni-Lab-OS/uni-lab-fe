import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { readCanonicalJson, sha256Hex } from './digest'
import { parseSpatialShadowSnapshot, SpatialShadowSnapshotParseError } from './parser'
import { createSpatialShadowFixtureText } from './testFixture'

describe('parseSpatialShadowSnapshot', () => {
  const eitSnapshotUrl = new URL(
    '../../../../pTLC_platformUI/.unilab/spatial-shadow/current.v0.json',
    import.meta.url
  )

  it.skipIf(!existsSync(fileURLToPath(eitSnapshotUrl)))(
    'accepts the current hash-bound EIT snapshot in the integrated workspace',
    () => {
      const snapshot = parseSpatialShadowSnapshot(
        readFileSync(eitSnapshotUrl, 'utf8')
      )

      expect(snapshot.sample_id).toBe('eit-ptlc-historical-v1')
      expect(snapshot.summary).toMatchObject({
        state_count: 15,
        segment_count: 14,
        sampled_segment_count: 4,
        excluded_segment_count: 10,
        link_count: 7
      })
    }
  )

  it('accepts one internally consistent, hash-bound shadow snapshot', () => {
    const snapshot = parseSpatialShadowSnapshot(createSpatialShadowFixtureText())

    expect(snapshot.summary).toMatchObject({
      state_count: 15,
      segment_count: 14,
      sampled_segment_count: 4,
      excluded_segment_count: 10,
      link_count: 7
    })
    expect(snapshot.decision).toBe('unknown')
    expect(snapshot.effect).toBe('none')
    expect(snapshot.not_workcell_activation).toBe(true)
  })

  it('fails closed when content changes without updating snapshot_digest', () => {
    const tampered = createSpatialShadowFixtureText().replace(
      'robot.tank.pick',
      'robot.tank.drop'
    )

    expect(() => parseSpatialShadowSnapshot(tampered)).toThrowError(
      /snapshot_digest: 摘要不匹配/
    )
  })

  it('requires raw JSON text because parsed objects lose Python number lexemes', () => {
    expect(() =>
      parseSpatialShadowSnapshot(JSON.parse(createSpatialShadowFixtureText()))
    ).toThrowError(SpatialShadowSnapshotParseError)
  })

  it('rejects declared counts that differ from the actual segments', () => {
    const parsed = JSON.parse(createSpatialShadowFixtureText()) as Record<string, unknown>
    const summary = parsed.summary as Record<string, unknown>
    summary.segment_count = 13
    delete parsed.snapshot_digest
    const canonical = readCanonicalJson(JSON.stringify(parsed)).canonical
    parsed.snapshot_digest = sha256Hex(`${canonical}\n`)

    expect(() => parseSpatialShadowSnapshot(JSON.stringify(parsed))).toThrowError(
      /summary\.segment_count: 声明为 13，实际为 14/
    )
  })

  it('rejects reordered CR5 joints before array positions can drive the wrong axes', () => {
    const parsed = JSON.parse(createSpatialShadowFixtureText()) as Record<string, unknown>
    const playback = parsed.playback as Record<string, unknown>
    const kinematics = playback.kinematics as Record<string, unknown>
    kinematics.joint_ids = ['J2', 'J1', 'J3', 'J4', 'J5', 'J6']
    delete parsed.snapshot_digest
    const canonical = readCanonicalJson(JSON.stringify(parsed)).canonical
    parsed.snapshot_digest = sha256Hex(`${canonical}\n`)

    expect(() => parseSpatialShadowSnapshot(JSON.stringify(parsed))).toThrowError(
      /必须严格按 J1, J2, J3, J4, J5, J6 排列/
    )
  })
})
