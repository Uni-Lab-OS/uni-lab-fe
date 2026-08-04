import { describe, expect, it } from 'vitest'

import {
  createDeviceCardAuthoringContext,
  summarizeDeviceCardAuthoringTarget
} from './context'

const target = {
  deviceId: 'robot-01',
  deviceTypeId: 'robot-arm',
  title: 'Robot',
  online: true,
  actions: [{
    action: 'set_position',
    label: 'Set position',
    inputSchema: { position: { type: 'number' } },
    outputSchema: { accepted: { type: 'boolean' } },
    riskLevel: 'dangerous' as const
  }]
}

describe('device card authoring context', () => {
  it('creates a deterministic partial context from a neutral target', () => {
    const context = createDeviceCardAuthoringContext(target)

    expect(context).toMatchObject({
      deviceId: 'robot-01',
      deviceTypeId: 'robot-arm',
      sampleState: {
        online: true,
        actionBusy: { set_position: false }
      }
    })
    expect(context.stateSchema.current_position).toBeUndefined()
    expect(context.actions[0]?.riskLevel).toBe('dangerous')
    expect(summarizeDeviceCardAuthoringTarget(target))
      .toMatchObject({ contextAvailability: 'partial', actionCount: 1 })
  })

  it('keeps an explicit OS state schema authoritative', () => {
    const context = createDeviceCardAuthoringContext({
      ...target,
      stateSchema: {
        temperature: {
          type: 'number',
          source: 'driver',
          status: 'resolved'
        }
      },
      sampleState: { temperature: 22 }
    })

    expect(context.stateSchema).toEqual({
      temperature: {
        type: 'number',
        source: 'driver',
        status: 'resolved'
      },
      online: {
        type: 'boolean',
        source: 'host',
        status: 'resolved'
      },
      actionBusy: {
        type: 'object',
        source: 'host',
        status: 'resolved'
      }
    })
    expect(summarizeDeviceCardAuthoringTarget({
      ...target,
      stateSchema: context.stateSchema
    }).contextAvailability).toBe('ready')
  })
})
