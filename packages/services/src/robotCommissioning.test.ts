import { describe, expect, it, vi } from 'vitest'

import { createRobotCommissioningService } from './robotCommissioning'

describe('RobotCommissioningService', () => {
  it('uses only the OS robot-commissioning API and binds encoded identities', async () => {
    const request = vi.fn().mockResolvedValue({})
    const service = createRobotCommissioningService({ request })

    await service.open('robot/a', 'device-card:test', 'simulation')
    await service.snapshot('robot/a', 'session/1')
    await service.execute('robot/a', 'session/1', {
      schema_version: 2,
      command_id: 'command-1',
      type: 'joint_jog',
      joint_ref: 'cr5_joint_1',
      direction: 'positive',
      step_si: 0.01,
      velocity_scale: 0.1,
      acceleration_scale: 0.1
    })
    await service.close('robot/a', 'session/1')

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/robot-commissioning/robot%2Fa/sessions',
      '/api/v1/robot-commissioning/robot%2Fa/sessions/session%2F1/snapshot',
      '/api/v1/robot-commissioning/robot%2Fa/sessions/session%2F1/commands',
      '/api/v1/robot-commissioning/robot%2Fa/sessions/session%2F1'
    ])
    expect(request.mock.calls[0][1].body).toContain(
      '"requested_deployment_mode":"simulation"'
    )
    expect(request.mock.calls[2][1].body).toContain('joint_jog')
    expect(request.mock.calls[2][1].timeoutMs).toBe(300_000)
    expect(request.mock.calls[3][1]).toEqual({ method: 'DELETE' })
  })
})
