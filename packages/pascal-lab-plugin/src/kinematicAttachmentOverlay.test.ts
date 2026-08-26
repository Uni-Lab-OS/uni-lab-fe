import type { MaterialAggregate } from '@unilab/material/domain'
import type { KinematicAttachmentFrame } from '@unilab/scene-runtime'
import { describe, expect, it } from 'vitest'

import { attachmentFramesToRuntimePlacements } from './kinematicAttachmentOverlay'

const aggregate = (id: string): MaterialAggregate => ({
  material: {
    id,
    sourceTemplateId: `template-${id}`,
    code: id,
    name: id,
    config: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  placement: { kind: 'unplaced' },
  sites: [],
  revision: 1
})

const frame = (
  childRef: string,
  parentRef: string,
  overrides: Partial<KinematicAttachmentFrame> = {}
): KinematicAttachmentFrame => ({
  carrierMaterialId: 'robot',
  deviceId: 'robot-main',
  kind: 'material_payload',
  childRef,
  parentRef,
  anchor: { kind: 'link', linkName: 'grasp_frame' },
  localPose: { xyzM: [0, 0, 0.08], orientationXyzw: [0, 0, 0, 1] },
  state: 'attached',
  evidence: 'observed',
  attachmentGeneration: 1,
  contextDigest: 'a'.repeat(64),
  bootId: 'boot-1',
  sequence: 1,
  acceptedRef: 'sha256:1',
  observedAt: 1,
  staleAfterSeconds: 2,
  stale: false,
  source: 'robot-runtime',
  materialRevisionAtAttach: 1,
  ...overrides
})

describe('运动学附着 MaterialPlacement 运行时覆盖', () => {
  it('支持 robot→mesh tool→URDF payload 多级单节点链', () => {
    const placements = attachmentFramesToRuntimePlacements({
      tool: frame('tool', 'robot', {
        kind: 'tool',
        anchor: { kind: 'link', linkName: 'tool0' }
      }),
      payload: frame('payload', 'tool')
    }, [aggregate('robot'), aggregate('tool'), aggregate('payload')])
    expect(placements.tool).toMatchObject({ parentId: 'robot' })
    expect(placements.payload).toMatchObject({
      parentId: 'tool',
      localPose: { positionMm: [0, 0, 80] }
    })
  })

  it('stale/uncertain 保持姿态，detached 立即交还当前库存库位', () => {
    const aggregates = [aggregate('robot'), aggregate('payload')]
    expect(attachmentFramesToRuntimePlacements({
      payload: frame('payload', 'robot', {
        state: 'uncertain', evidence: 'none', stale: true
      })
    }, aggregates).payload).toBeDefined()
    expect(attachmentFramesToRuntimePlacements({
      payload: frame('payload', 'robot', { state: 'detached' })
    }, aggregates).payload).toBeUndefined()
  })
})
