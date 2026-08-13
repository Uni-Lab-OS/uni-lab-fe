import { Mesh, type Material } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDeviceXacro,
  createDeviceXacroLoader,
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

  it('eagerly resolves nested YAML-backed Xacro properties', () => {
    const loader = createDeviceXacroLoader(new Map([
      ['http://fixture.local/joint_limit.yaml', { joint_limits: {} }]
    ]))

    // xacro-parser 0.3.x otherwise leaves a chain such as
    // load_yaml -> joint_limits -> joint -> lower deferred as strings. The
    // final URDF then receives empty limits and clamps every joint to zero.
    expect(
      (loader as unknown as { localProperties?: boolean }).localProperties
    ).toBe(false)
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
