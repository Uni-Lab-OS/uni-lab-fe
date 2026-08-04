import type {
  MaterialAggregate,
  MaterialPlacement,
  MaterialSite
} from '@unilab/material/domain'
import { describe, expect, it } from 'vitest'

import {
  materialAggregatesToSceneGraph,
  sceneGraphToMaterialMoves
} from './materialAggregateSceneBridge'
import { isLabDeviceNode } from './schema'

describe('Material Aggregate / Pascal bridge', () => {
  it('projects the instance rendering snapshot without copying the entity', () => {
    const robot = aggregate('robot', {
      config: {
        rendering: {
          kind: 'robot',
          dimensionsMm: [500, 700, 400],
          model: {
            path: '/assets/robot.xacro',
            macro: 'szlab_mixer_robot',
            meshDir: '/assets/robot/models',
            attachPoints: [{ link: 'tool0' }]
          }
        }
      },
      placement: {
        kind: 'world',
        pose: {
          positionMm: [100, 200, 300],
          rotationDegXYZ: [10, 20, 30]
        }
      }
    })

    const scene = materialAggregatesToSceneGraph([robot], {
      fitSceneRevision: 7
    })
    const node = scene.nodes['lab-robot']

    expect(isLabDeviceNode(node)).toBe(true)
    if (!isLabDeviceNode(node)) return
    expectTupleCloseTo(node.position, [0.1, 0.3, -0.2])
    expect(node.model).toMatchObject({
      path: '/assets/robot.xacro',
      format: 'xacro',
      macro: 'szlab_mixer_robot',
      meshDir: '/assets/robot/models'
    })
    expect(node.model.attachPoints.map((point) => point.link)).toEqual([
      'tool0'
    ])
    expect(node).not.toHaveProperty('material')
    expect(node).not.toHaveProperty('config')
    const site = scene.nodes.site_unilab as {
      fitSceneRevision?: number
    }
    expect(site.fitSceneRevision).toBe(7)
    expect(site).not.toHaveProperty('camera')
    expect(scene.nodes.level_unilab).not.toHaveProperty('camera')
    expect(sceneGraphToMaterialMoves(scene, [robot])).toEqual([])
  })

  it('turns a world-space Pascal drag into a canonical placement command', () => {
    const robot = aggregate('robot', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [100, 200, 300],
          rotationDegXYZ: [10, 20, 30]
        }
      }
    })
    const scene = materialAggregatesToSceneGraph([robot])
    const node = scene.nodes['lab-robot']
    if (!isLabDeviceNode(node)) throw new Error('Expected lab device')
    scene.nodes['lab-robot'] = {
      ...node,
      position: [0.2, node.position[1], node.position[2]]
    }

    const [move] = sceneGraphToMaterialMoves(scene, [robot])
    expect(move.materialId).toBe('robot')
    expect(move.placement.kind).toBe('world')
    if (move.placement.kind !== 'world') return
    expectTupleCloseTo(
      move.placement.pose.positionMm,
      [200, 200, 300]
    )
    expectTupleCloseTo(
      move.placement.pose.rotationDegXYZ,
      [10, 20, 30]
    )
  })

  it('composes a link Site for rendering and recovers its offset', () => {
    const site: MaterialSite = {
      id: 'site-tool',
      ownerMaterialId: 'robot',
      key: 'tool',
      name: 'Tool',
      anchor: { kind: 'link', linkName: 'tool0' },
      poseInAnchor: {
        positionMm: [100, 0, 0],
        rotationDegXYZ: [0, 0, 90]
      },
      sizeMm: [30, 30, 30],
      capacity: 1,
      allowedTemplateIds: [],
      occupiedMaterialIds: ['gripper']
    }
    const robot = aggregate('robot', { sites: [site] })
    const gripper = aggregate('gripper', {
      placement: {
        kind: 'site',
        parentId: 'robot',
        siteId: 'site-tool',
        offsetPose: {
          positionMm: [0, 50, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    const scene = materialAggregatesToSceneGraph([robot, gripper])
    const node = scene.nodes['lab-gripper']
    if (!isLabDeviceNode(node)) throw new Error('Expected lab device')

    expectTupleCloseTo(node.position, [0.05, 0, 0])
    expectTupleCloseTo(node.rotation, [0, 0, Math.PI / 2])
    expect(node.attach).toEqual({
      parentDeviceId: 'lab-robot',
      parentLinkName: 'tool0',
      mountPoint: 'site-tool'
    })
    expect(node.placementRef).toMatchObject({
      kind: 'site',
      parentMaterialId: 'robot',
      siteId: 'site-tool',
      anchorKind: 'link',
      anchorLinkName: 'tool0'
    })

    scene.nodes['lab-gripper'] = {
      ...node,
      position: [0.06, 0, 0]
    }
    const [move] = sceneGraphToMaterialMoves(scene, [robot, gripper])
    expect(move.placement.kind).toBe('site')
    if (move.placement.kind !== 'site') return
    expectTupleCloseTo(
      move.placement.offsetPose.positionMm,
      [0, 40, 0]
    )
  })

  it('projects visible site models from exact material-local coordinates', () => {
    const tipSite: MaterialSite = {
      id: 'tip-a1',
      ownerMaterialId: 'rack',
      key: 'A1',
      name: 'A1',
      anchor: { kind: 'root' },
      poseInAnchor: {
        positionMm: [10, 20, 3],
        rotationDegXYZ: [0, 0, 0]
      },
      sizeMm: [5, 5, 95],
      capacity: 1,
      allowedTemplateIds: [],
      occupiedMaterialIds: [],
      kind: 'tip-spot',
      visible: true,
      visual: {
        state: 'tip-present',
        fillFraction: 1
      }
    }
    const rack = aggregate('rack', {
      sites: [tipSite],
      config: {
        rendering: {
          kind: 'tip_rack',
          model: {
            path: '/assets/rack.stl',
            instances: {
              path: '/assets/tip.stl',
              format: 'stl',
              color: '#22c55e',
              siteKinds: ['tip-spot'],
              visibleStates: ['tip-present'],
              rotation: [-Math.PI / 2, 0, 0]
            }
          }
        }
      }
    })

    const scene = materialAggregatesToSceneGraph([rack])
    const node = scene.nodes['lab-rack']
    if (!isLabDeviceNode(node)) throw new Error('Expected lab device')
    expect(node.floorplanSnapshot?.sites).toHaveLength(0)
    expect(node.model.instances?.items).toHaveLength(1)
    expectTupleCloseTo(
      node.model.instances?.items[0]?.position ?? [],
      [0.01, 0.003, -0.02]
    )
    expect(node.model.instances?.rotation[0]).toBeCloseTo(
      -Math.PI / 2,
      8
    )

    const hiddenScene = materialAggregatesToSceneGraph([rack], {
      showSites: false
    })
    const hiddenNode = hiddenScene.nodes['lab-rack']
    if (!isLabDeviceNode(hiddenNode)) {
      throw new Error('Expected hidden lab device')
    }
    expect(hiddenNode.floorplanSnapshot?.sites).toEqual([])
    expect(hiddenNode.model.instances?.items).toHaveLength(1)
  })

  it('projects a logical mount as site bounds without a device body', () => {
    const mountSite: MaterialSite = {
      id: 'mount-site-1',
      ownerMaterialId: 'logical-warehouse',
      key: 'S041',
      name: 'S041',
      anchor: { kind: 'root' },
      poseInAnchor: {
        positionMm: [90, 80, 150],
        rotationDegXYZ: [0, 0, 0]
      },
      sizeMm: [86, 86, 120],
      capacity: 1,
      allowedTemplateIds: [],
      occupiedMaterialIds: [],
      kind: 'site',
      visible: true
    }
    const warehouse = aggregate('logical-warehouse', {
      sites: [mountSite],
      config: {
        logical_mount: true,
        rendering: {
          kind: 'process-warehouse',
          dimensionsMm: [710, 780, 359]
        }
      }
    })

    const scene = materialAggregatesToSceneGraph([warehouse])
    const node = scene.nodes['lab-logical-warehouse']
    if (!isLabDeviceNode(node)) throw new Error('Expected lab device')

    expect(node.renderBody).toBe(false)
    expect(node.floorplanSnapshot?.sites).toHaveLength(1)
  })

  it('flattens a static root-anchored child into world space', () => {
    const parent = aggregate('table', {
      config: { rendering: { kind: 'table' } },
      placement: {
        kind: 'world',
        pose: {
          positionMm: [500, 100, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const child = aggregate('reader', {
      placement: {
        kind: 'parent',
        parentId: 'table',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [100, 200, 300],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    const scene = materialAggregatesToSceneGraph([parent, child])
    const node = scene.nodes['lab-reader']
    if (!isLabDeviceNode(node)) throw new Error('Expected lab device')
    expect(node.attach).toEqual({
      parentDeviceId: null,
      parentLinkName: null,
      mountPoint: null
    })
    expectTupleCloseTo(node.position, [0.6, 0.3, -0.3])
    expect(sceneGraphToMaterialMoves(scene, [parent, child])).toEqual([])
  })
})

function aggregate(
  id: string,
  options: {
    config?: Record<string, unknown>
    placement?: MaterialPlacement
    sites?: readonly MaterialSite[]
  } = {}
): MaterialAggregate {
  return {
    material: {
      id,
      sourceTemplateId: `template-${id}`,
      code: id,
      name: id,
      config: options.config ?? {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    placement: options.placement ?? {
      kind: 'world',
      pose: {
        positionMm: [0, 0, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    },
    sites: options.sites ?? [],
    revision: 1
  }
}

function expectTupleCloseTo(
  actual: readonly number[],
  expected: readonly number[]
): void {
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index], 8)
  }
}
