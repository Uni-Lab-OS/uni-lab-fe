import { describe, expect, it, vi } from 'vitest'

import { DeviceCardRobotCommissioningController } from './deviceCardRobotCommissioningController'

describe('DeviceCardRobotCommissioningController', () => {
  it('treats close before open as an idempotent lifecycle operation', async () => {
    const service = {
      open: vi.fn(),
      snapshot: vi.fn(),
      execute: vi.fn(),
      close: vi.fn()
    }
    const controller = new DeviceCardRobotCommissioningController(service)

    const run = await controller.execute({
      requestId: 'close-1',
      sessionKey: 'host-key',
      deviceId: 'robot',
      runtimeMode: 'mock',
      operation: 'close'
    })

    expect(run).toEqual({ requestId: 'close-1', status: 'DONE', result: {} })
    expect(service.close).not.toHaveBeenCalled()
  })

  it('keeps OS session identity in Host and reuses it for commands', async () => {
    const service = {
      open: vi.fn().mockResolvedValue({ session_id: 'os-session' }),
      snapshot: vi.fn().mockResolvedValue({ online: true }),
      execute: vi.fn().mockResolvedValue({ result: { state: 'succeeded' } }),
      close: vi.fn().mockResolvedValue(undefined)
    }
    const controller = new DeviceCardRobotCommissioningController(service)

    await controller.execute({
      requestId: '1',
      sessionKey: 'host-key',
      deviceId: 'robot',
      runtimeMode: 'mock',
      operation: 'open'
    })
    expect(service.open).toHaveBeenCalledWith(
      'robot',
      'device-card:host-key',
      'simulation'
    )
    const run = await controller.execute({
      requestId: '2',
      sessionKey: 'host-key',
      deviceId: 'robot',
      runtimeMode: 'mock',
      operation: 'execute',
      command: {
        schema_version: 2,
        command_id: 'jog-1',
        type: 'joint_jog',
        joint_ref: 'cr5_joint_1',
        direction: 'positive',
        step_si: 0.01,
        velocity_scale: 0.1,
        acceleration_scale: 0.1
      }
    })

    expect(run.status).toBe('DONE')
    expect(service.execute).toHaveBeenCalledWith(
      'robot',
      'os-session',
      expect.objectContaining({ type: 'joint_jog' })
    )
    expect(JSON.stringify(run)).not.toContain('os-session')
  })

  it('does not report DONE when OS returns a rejected motion result', async () => {
    const service = {
      open: vi.fn().mockResolvedValue({ session_id: 'os-session' }),
      snapshot: vi.fn(),
      execute: vi.fn().mockResolvedValue({
        result: { state: 'rejected', message: 'simulation joint limit' }
      }),
      close: vi.fn()
    }
    const controller = new DeviceCardRobotCommissioningController(service)
    await controller.execute({
      requestId: 'open', sessionKey: 'host-key', deviceId: 'robot',
      runtimeMode: 'mock', operation: 'open'
    })

    const run = await controller.execute({
      requestId: 'execute', sessionKey: 'host-key', deviceId: 'robot',
      runtimeMode: 'mock', operation: 'execute',
      command: {
        schema_version: 2,
        command_id: 'jog-1',
        type: 'joint_jog',
        joint_ref: 'cr5_joint_1',
        direction: 'positive',
        step_si: 0.01,
        velocity_scale: 0.1,
        acceleration_scale: 0.1
      }
    })

    expect(run).toMatchObject({ status: 'ERROR', error: 'simulation joint limit' })
  })

  it('closes the previous device session before opening a replacement', async () => {
    let releaseClose!: () => void
    const closePending = new Promise<void>(resolve => {
      releaseClose = resolve
    })
    const service = {
      open: vi.fn()
        .mockResolvedValueOnce({ session_id: 'old-session' })
        .mockResolvedValueOnce({ session_id: 'new-session' }),
      snapshot: vi.fn(),
      execute: vi.fn(),
      close: vi.fn().mockReturnValue(closePending)
    }
    const controller = new DeviceCardRobotCommissioningController(service)
    await controller.execute({
      requestId: 'open-old', sessionKey: 'old-key', deviceId: 'robot',
      runtimeMode: 'mock', operation: 'open'
    })

    const closing = controller.execute({
      requestId: 'close-old', sessionKey: 'old-key', deviceId: 'robot',
      runtimeMode: 'mock', operation: 'close'
    })
    const opening = controller.execute({
      requestId: 'open-new', sessionKey: 'new-key', deviceId: 'robot',
      runtimeMode: 'mock', operation: 'open'
    })
    await vi.waitFor(() => expect(service.close).toHaveBeenCalledTimes(1))

    expect(service.open).toHaveBeenCalledTimes(1)
    releaseClose()
    await expect(closing).resolves.toMatchObject({ status: 'DONE' })
    await expect(opening).resolves.toMatchObject({ status: 'DONE' })
    expect(service.open).toHaveBeenCalledTimes(2)
  })
})
