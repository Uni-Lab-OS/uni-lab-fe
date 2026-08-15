import { describe, expect, it } from 'vitest'

import { projectManagedLocalGraph } from './managed-local-graph'

describe('managed-local device graph projection', () => {
  it('maps the container PLC-Sim alias to the host loopback endpoint', () => {
    const source = Buffer.from(`${JSON.stringify({
      nodes: [{
        id: 'fixture_plc',
        config: {
          url: 'opc.tcp://plc-sim:4855/fixture_sim/',
          auto_connect: true
        }
      }]
    }, null, 2)}\n`)

    const projected = projectManagedLocalGraph(source, 14855)

    expect(projected.toString('utf8')).toContain(
      'opc.tcp://127.0.0.1:14855/fixture_sim/'
    )
    expect(source.toString('utf8')).toContain(
      'opc.tcp://plc-sim:4855/fixture_sim/'
    )
  })

  it.each([
    'opc.tcp://192.168.1.10:4840',
    'opc.tcp://127.0.0.1:4855'
  ])('does not rewrite a physical or already-local endpoint: %s', url => {
    const source = Buffer.from(JSON.stringify({
      nodes: [{ config: { url } }]
    }))

    expect(projectManagedLocalGraph(source, 14855)).toBe(source)
  })
})
