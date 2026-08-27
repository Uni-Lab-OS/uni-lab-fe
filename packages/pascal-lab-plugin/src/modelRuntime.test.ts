import { Mesh, type Material } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDeviceXacro,
  loadLabDeviceModel,
  resolveModelDirectory,
  shouldInstantiateXacro
} from './modelRuntime'
import { LabDeviceNodeSchema } from './schema'

describe('Pascal model runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a single STL material renderable when applying a tint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(minimalBinaryStl()))
    )
    const node = LabDeviceNodeSchema.parse({
      id: 'plate',
      type: 'lab-device',
      materialNodeId: 'plate',
      model: {
        path: 'http://127.0.0.1/model.stl',
        format: 'stl',
        color: '#22c55e'
      }
    })

    const object = await loadLabDeviceModel(node)
    expect(object).toBeInstanceOf(Mesh)
    const material = (object as Mesh).material
    expect(Array.isArray(material)).toBe(false)
    expect(
      (material as Material & { color: { getHexString(): string } }).color
        .getHexString()
    ).toBe('22c55e')
  })

  it('uses the projected macro and model directory for packaged Xacro', () => {
    const source = buildDeviceXacro(
      'http://127.0.0.1:8014/api/v1/material-models/lab/device.xacro',
      'mixer robot',
      'szlab_mixer_robot',
      'http://127.0.0.1:8014/api/v1/material-models/lab/models'
    )

    expect(source).toContain('<xacro:szlab_mixer_robot')
    expect(source).toContain(
      'mesh_path="http://127.0.0.1:8014/api/v1/material-models/lab/models"'
    )
  })

  it('resolves a package-relative mesh directory against the Edge origin', () => {
    expect(
      resolveModelDirectory(
        'http://127.0.0.1:8014/api/v1/material-models/lab/models/device.xacro',
        '/api/v1/material-models/lab/models'
      )
    ).toBe('http://127.0.0.1:8014/api/v1/material-models/lab/models')
  })

  it('instantiates declared macros from packaged resource Xacro files', () => {
    expect(
      shouldInstantiateXacro(
        'http://127.0.0.1:8014/api/v1/material-models/lab/resources/beaker/models/resource.xacro',
        'szlab_beaker_500ml'
      )
    ).toBe(true)
    expect(
      shouldInstantiateXacro(
        'http://127.0.0.1:8014/api/v1/material-models/lab/resources/plain/models/resource.xacro'
      )
    ).toBe(false)
  })

  it('distinguishes packaged Xacro libraries from complete robot documents', () => {
    const packagedPath =
      'http://127.0.0.1:8014/api/v1/material-models/lab/devices/model.xacro'
    expect(
      shouldInstantiateXacro(
        packagedPath,
        undefined,
        '<robot xmlns:xacro="http://ros.org/wiki/xacro"><xacro:macro name="device"><link name="body" /></xacro:macro></robot>'
      )
    ).toBe(true)
    expect(
      shouldInstantiateXacro(
        packagedPath,
        undefined,
        '<robot xmlns:xacro="http://ros.org/wiki/xacro"><link name="body" /></robot>'
      )
    ).toBe(false)
  })
})

function minimalBinaryStl(): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + 50)
  const view = new DataView(buffer)
  view.setUint32(80, 1, true)
  const vertices = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0]
  ]
  vertices.forEach((vertex, vertexIndex) => {
    vertex.forEach((value, axisIndex) => {
      view.setFloat32(
        84 + 12 + vertexIndex * 12 + axisIndex * 4,
        value,
        true
      )
    })
  })
  return buffer
}
