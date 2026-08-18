import type {
  MaterialAggregate,
  MaterialPlacement,
  MaterialSite
} from '@unilab/material/domain'
import { describe, expect, it } from 'vitest'

import {
  materialAggregatesToSceneGraph,
  projectMaterialTransferSceneLayer,
  sceneGraphToMaterialMoves
} from './materialAggregateSceneBridge'
import { readMaterialRendering } from './materialRenderingSnapshot'
import {
  isLabDeviceNode,
  isLabMaterialTransferLayerNode
} from './schema'

describe('Material Aggregate / Pascal bridge', () => {
  it('projects Backend floor-plane sizes into Pascal dimensions', () => {
    const deck = aggregate('deck', {
      config: {
        size_x: 3634,
        size_y: 1674,
        size_z: 20
      }
    })

    const rendering = readMaterialRendering(deck)

    expect(rendering.dimensionsMm).toEqual([3634, 20, 1674])
    expect(rendering.footprintMm).toEqual([3634, 1674])
  })

  it('keeps explicit rendering dimensions ahead of Backend size fields', () => {
    const deck = aggregate('deck', {
      config: {
        size_x: 3634,
        size_y: 1674,
        size_z: 20,
        rendering: {
          kind: 'deck',
          dimensionsMm: [1000, 50, 800]
        }
      }
    })

    expect(readMaterialRendering(deck).dimensionsMm).toEqual([
      1000,
      50,
      800
    ])
  })

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
      fitSceneRevision: 7,
      fitSceneView: 'top'
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
      fitSceneView?: string
    }
    expect(site.fitSceneRevision).toBe(7)
    expect(site.fitSceneView).toBe('top')
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
    expect(node.floorplanSnapshot?.showSites).toBe(true)
    expect(node.floorplanSnapshot?.sites).toHaveLength(1)
    expect(node.floorplanSnapshot?.sites[0]?.occupied).toBe(false)

    const hoverOnlyScene = materialAggregatesToSceneGraph([warehouse], {
      showSites: false
    })
    const hoverOnlyNode = hoverOnlyScene.nodes['lab-logical-warehouse']
    if (!isLabDeviceNode(hoverOnlyNode)) {
      throw new Error('Expected hover-only lab device')
    }
    expect(hoverOnlyNode.floorplanSnapshot?.showSites).toBe(false)
    expect(hoverOnlyNode.floorplanSnapshot?.sites).toHaveLength(1)
  })

  it('links a colocated legacy child to its matching Site helper', () => {
    const rackSite = site(
      'tip-rack',
      'site-l2c3',
      'L2C3',
      [6, 298, 260]
    )
    const rack = aggregate('tip-rack', {
      sites: [{
        ...rackSite,
        sizeMm: [128, 86, 136],
        allowedTemplateIds: ['template-tip-box']
      }]
    })
    const tipBox = aggregate('tip-box', {
      config: {
        rendering: {
          kind: 'tip_box',
          dimensionsMm: [128, 136, 86]
        }
      },
      placement: {
        kind: 'parent',
        parentId: 'tip-rack',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [6, 298, 260],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    const scene = materialAggregatesToSceneGraph([rack, tipBox])
    const node = scene.nodes['lab-tip-rack']
    if (!isLabDeviceNode(node)) throw new Error('Expected lab device')

    expect(node.floorplanSnapshot?.sites[0]).toMatchObject({
      id: 'site-l2c3',
      occupied: false,
      occupantSceneObjectId: 'lab-tip-box'
    })
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

  it('resolves workflow transfer Sites into one Pascal route layer', () => {
    const source = aggregate('source-warehouse', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [100, 200, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      sites: [site('source-warehouse', 'source-site', 'L1B1', [20, 30, 100])]
    })
    const target = aggregate('target-warehouse', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [900, 600, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      sites: [site('target-warehouse', 'target-site', 'S0721', [50, 70, 120])]
    })
    const routes = [{
      id: 'route-1',
      workflowNodeUuid: 'node-1',
      label: '烧杯搬到 S07',
      source: {
        ownerMaterialId: 'source-warehouse',
        siteKey: 'L1B1'
      },
      target: {
        ownerMaterialId: 'target-warehouse',
        siteKey: 'S0721'
      },
      executorId: 'szlab_mixer_robot',
      status: 'running' as const,
      selected: true
    }]

    const projected = projectMaterialTransferSceneLayer(
      [source, target],
      routes
    )
    expect(projected.unresolvedRouteIds).toEqual([])
    expect(projected.routes[0]).toMatchObject({
      sourceSiteId: 'source-site',
      targetSiteId: 'target-site',
      status: 'running',
      materialRole: 'unclassified',
      materialLineageKey: 'route-1',
      accent: '#6657c7',
      selected: true
    })
    expect(projected.routes[0]?.points).toHaveLength(6)
    expectTupleCloseTo(projected.routes[0]?.points[0] ?? [], [
      0.14,
      0.15,
      -0.25
    ])

    const scene = materialAggregatesToSceneGraph([source, target], {
      materialTransferRoutes: routes,
      showMaterialTransfers: true
    })
    const level = scene.nodes.level_unilab as {
      children: string[]
      materialTransferLayer?: unknown
    }
    const layer = level.materialTransferLayer
    expect(isLabMaterialTransferLayerNode(layer)).toBe(true)
    expect(level.children).not.toContain('lab-material-transfer-layer-unilab')
  })

  it('anchors an unassigned transfer endpoint at its warehouse', () => {
    const source = aggregate('source-warehouse', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [200, 300, 400],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const target = aggregate('target-warehouse', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [900, 600, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      sites: [site('target-warehouse', 'target-site', 'S0721')]
    })

    const projected = projectMaterialTransferSceneLayer([source, target], [{
      id: 'route-warehouse-source',
      workflowNodeUuid: 'node-warehouse-source',
      label: '未分配源库位',
      source: {
        ownerMaterialId: 'source-warehouse',
        siteKey: null
      },
      target: {
        ownerMaterialId: 'target-warehouse',
        siteKey: 'S0721'
      },
      executorId: 'robot',
      status: 'planned'
    }])

    expect(projected.unresolvedRouteIds).toEqual([])
    expect(projected.routes[0]).toMatchObject({
      sourceAnchorKind: 'warehouse',
      sourceAnchorId: 'source-warehouse',
      sourceOwnerMaterialId: 'source-warehouse',
      sourceSiteId: null,
      sourceSiteKey: null,
      targetAnchorKind: 'site',
      targetAnchorId: 'target-site'
    })
    expectTupleCloseTo(projected.routes[0]?.points[0] ?? [], [0.2, 0.4, -0.3])
  })

  it('rejects a transfer route when either Site identity is unresolved', () => {
    const source = aggregate('source-warehouse', {
      sites: [site('source-warehouse', 'source-site', 'L1B1')]
    })
    const projected = projectMaterialTransferSceneLayer([source], [{
      id: 'route-missing-target',
      workflowNodeUuid: 'node-1',
      label: 'unresolved',
      source: {
        ownerMaterialId: 'source-warehouse',
        siteKey: 'L1B1'
      },
      target: {
        ownerMaterialId: 'missing-warehouse',
        siteKey: 'S0721'
      },
      executorId: 'robot',
      status: 'planned'
    }])

    expect(projected.routes).toEqual([])
    expect(projected.unresolvedRouteIds).toEqual(['route-missing-target'])
  })

  /**
   * 验证物料转运端点只接受物料（Material）UUID 或后端发布的 `sourceIdentity`。
   * 输入故意只匹配 ROS 展示身份；返回值必须失败关闭且不产生路线。
   */
  it('does not resolve a transfer owner through ROS or display aliases', () => {
    const source = aggregate('source-material-uuid', {
      config: { rosDeviceName: 'source-warehouse-alias' },
      sites: [site('source-material-uuid', 'source-site', 'L1B1')]
    })
    const target = aggregate('target-material-uuid', {
      sites: [site('target-material-uuid', 'target-site', 'S0721')]
    })

    const projected = projectMaterialTransferSceneLayer([source, target], [{
      id: 'route-ros-alias',
      workflowNodeUuid: 'node-ros-alias',
      label: '不得按 ROS 名称匹配',
      source: {
        ownerMaterialId: 'source-warehouse-alias',
        siteKey: 'L1B1'
      },
      target: {
        ownerMaterialId: 'target-material-uuid',
        siteKey: 'S0721'
      },
      executorId: 'robot',
      status: 'planned'
    }])

    expect(projected.routes).toEqual([])
    expect(projected.unresolvedRouteIds).toEqual(['route-ros-alias'])
  })

  /**
   * 验证库位（Site）显示名称不是空间端点身份。
   * 输入只匹配 `name` 而不匹配 UUID/`key`；返回值必须保持未解析。
   */
  it('does not resolve a Site through its display name', () => {
    const sourceSite = {
      ...site('source-material-uuid', 'source-site-uuid', 'source-site-key'),
      name: 'L1B1'
    }
    const source = aggregate('source-material-uuid', { sites: [sourceSite] })
    const target = aggregate('target-material-uuid', {
      sites: [site('target-material-uuid', 'target-site', 'S0721')]
    })

    const projected = projectMaterialTransferSceneLayer([source, target], [{
      id: 'route-site-name',
      workflowNodeUuid: 'node-site-name',
      label: '不得按库位显示名称匹配',
      source: {
        ownerMaterialId: 'source-material-uuid',
        siteKey: 'L1B1'
      },
      target: {
        ownerMaterialId: 'target-material-uuid',
        siteKey: 'S0721'
      },
      executorId: 'robot',
      status: 'planned'
    }])

    expect(projected.routes).toEqual([])
    expect(projected.unresolvedRouteIds).toEqual(['route-site-name'])
  })

  /**
   * 验证全部端点不可解析时仍保留图层摘要中的路线身份。
   * 输入为一个缺失目标仓库的路线；场景输出应保留未解析计数而不渲染路径。
   */
  it('keeps unresolved route identities when no route can render', () => {
    const source = aggregate('source-material-uuid', {
      sites: [site('source-material-uuid', 'source-site', 'L1B1')]
    })
    const scene = materialAggregatesToSceneGraph([source], {
      showMaterialTransfers: true,
      materialTransferRoutes: [{
        id: 'route-unresolved-only',
        workflowNodeUuid: 'node-unresolved-only',
        label: '缺少目标仓库',
        source: {
          ownerMaterialId: 'source-material-uuid',
          siteKey: 'L1B1'
        },
        target: {
          ownerMaterialId: 'missing-target',
          siteKey: 'S0721'
        },
        executorId: 'robot',
        status: 'planned'
      }]
    })
    const level = scene.nodes.level_unilab as {
      materialTransferLayer?: unknown
    }

    expect(isLabMaterialTransferLayerNode(level.materialTransferLayer)).toBe(true)
    expect(level.materialTransferLayer).toMatchObject({
      routes: [],
      unresolvedRouteIds: ['route-unresolved-only']
    })
  })
})

function site(
  ownerMaterialId: string,
  id: string,
  key: string,
  positionMm: readonly [number, number, number] = [0, 0, 0]
): MaterialSite {
  return {
    id,
    ownerMaterialId,
    key,
    name: key,
    anchor: { kind: 'root' },
    poseInAnchor: {
      positionMm,
      rotationDegXYZ: [0, 0, 0]
    },
    sizeMm: [40, 40, 100],
    capacity: 1,
    allowedTemplateIds: [],
    occupiedMaterialIds: []
  }
}

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
