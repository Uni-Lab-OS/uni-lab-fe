import type { MaterialAggregate } from '@unilab/material/domain'
import { describe, expect, it } from 'vitest'

import { inspectMaterialAggregateScene } from './materialSceneInspection'

describe('Material scene inspection', () => {
  it('reports stable identities, rotated bounds, Sites and visibility', () => {
    const device = aggregate('device', {
      positionMm: [100, 200, 0],
      rotationDegXYZ: [0, 0, 90],
      dimensionsMm: [200, 400, 100]
    })
    device.sites = [{
      id: 'site-a',
      ownerMaterialId: 'device',
      key: 'a',
      name: 'A',
      anchor: { kind: 'root' },
      poseInAnchor: {
        positionMm: [50, 0, 0],
        rotationDegXYZ: [0, 0, 0]
      },
      sizeMm: [20, 30, 40],
      capacity: 1,
      allowedTemplateIds: ['plate'],
      occupiedMaterialIds: []
    }]

    const scene = inspectMaterialAggregateScene([device], {
      viewMode: '3d',
      showSites: true,
      showMaterialTransfers: false,
      selectedMaterialIds: ['device'],
      sourceIdentity: {
        sourceId: 'local:test',
        authority: 'local',
        workspacePath: '/workspace',
        backendUrl: 'http://127.0.0.1:9000',
        rendererGeneration: 'renderer-1'
      }
    })

    expect(scene.schemaVersion).toBe('unilab-material-scene/v1')
    expect(scene.layoutRevision).toMatch(/^fnv1a32:/u)
    expect(scene.templateRevision).toMatch(/^fnv1a32:/u)
    expect(scene.counts).toEqual({
      materials: 1,
      visibleMaterials: 1,
      sites: 1,
      visibleSites: 1
    })
    expect(scene.bounds?.sizeMm[0]).toBeCloseTo(400)
    expect(scene.bounds?.sizeMm[1]).toBeCloseTo(200)
    expect(scene.nodes[0]).toMatchObject({
      materialId: 'device',
      sourceNodeId: 'source-device',
      sceneObjectId: 'lab-device',
      selected: true,
      visible: true,
      sites: [{ siteId: 'site-a', visible: true }]
    })
    expect(scene.nodes[0].sites[0].worldPose.positionMm).toEqual([100, 250, 0])
  })

  it('keeps hidden nodes inspectable while excluding them from scene bounds', () => {
    const scene = inspectMaterialAggregateScene([
      aggregate('visible', { positionMm: [0, 0, 0] }),
      aggregate('hidden', { positionMm: [10_000, 0, 0] })
    ], {
      viewMode: '2d',
      showSites: false,
      showMaterialTransfers: false,
      hiddenMaterialIds: ['hidden'],
      sourceIdentity: {
        sourceId: 'backend:test',
        authority: 'backend',
        workspacePath: '/workspace',
        backendUrl: 'http://127.0.0.1:8080',
        rendererGeneration: 'renderer-2'
      }
    })

    expect(scene.counts.visibleMaterials).toBe(1)
    expect(scene.nodes.find(node => node.materialId === 'hidden')?.visible)
      .toBe(false)
    expect(scene.bounds!.maximumMm[0]).toBeLessThan(1000)
  })
})

function aggregate(
  id: string,
  options: {
    positionMm: [number, number, number]
    rotationDegXYZ?: [number, number, number]
    dimensionsMm?: [number, number, number]
  }
): MaterialAggregate {
  return {
    material: {
      id,
      sourceTemplateId: `template-${id}`,
      code: id,
      name: id,
      config: {
        sourceIdentity: `source-${id}`,
        rendering: {
          kind: 'device',
          dimensionsMm: options.dimensionsMm ?? [100, 100, 100]
        }
      },
      createdAt: '2026-08-13T00:00:00Z',
      updatedAt: '2026-08-13T00:00:00Z'
    },
    placement: {
      kind: 'world',
      pose: {
        positionMm: options.positionMm,
        rotationDegXYZ: options.rotationDegXYZ ?? [0, 0, 0]
      }
    },
    sites: [],
    revision: 3
  }
}
