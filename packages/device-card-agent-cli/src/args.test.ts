import { describe, expect, it } from 'vitest'

import { parseAgentCommand } from './args'

describe('Device Card Agent CLI arguments', () => {
  it('maps bootstrap to the versioned bridge method', () => {
    const command = parseAgentCommand([
      'authoring',
      'bootstrap',
      '--device-id',
      'robot-01',
      '--profile',
      'vue',
      '--dir',
      './robot-card',
      '--json'
    ])
    expect(command).toMatchObject({
      method: 'authoring.session.prepare',
      json: true,
      params: {
        deviceId: 'robot-01',
        profile: 'vue'
      }
    })
    expect(command.params.projectDir).toMatch(/robot-card$/)
  })

  it('requires exactly one workspace locator', () => {
    expect(() => parseAgentCommand([
      'workspace', 'status', '--json'
    ])).toThrow('必须且只能提供')
    expect(() => parseAgentCommand([
      'workspace', 'status', '--project', '.', '--session-id', 'one'
    ])).toThrow('必须且只能提供')
  })

  it('rejects unknown arguments without partial execution', () => {
    expect(() => parseAgentCommand([
      'devices', 'list', '--token', 'secret'
    ])).toThrow('未知参数')
  })
})
