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
    outputSchema: { accepted: { type: 'boolean' } }
  }]
}

describe('device card authoring context', () => {
  it('creates a deterministic partial context from a neutral target', () => {
    const context = createDeviceCardAuthoringContext(target)

    expect(context).toMatchObject({
      deviceId: 'robot-01',
      deviceTypeId: 'robot-arm',
      sampleState: {
        current_position: 0,
        accepted: false,
        online: true
      }
    })
    expect(context.stateSchema.current_position).toMatchObject({
      status: 'unresolved',
      source: 'action-inferred'
    })
    expect(summarizeDeviceCardAuthoringTarget(target))
      .toMatchObject({ contextAvailability: 'partial', actionCount: 1 })
  })

  it('keeps an explicit OS state schema authoritative', () => {
    const context = createDeviceCardAuthoringContext({
      ...target,
      stateSchema: { temperature: { type: 'number', source: 'registry' } },
      sampleState: { temperature: 22 }
    })

    expect(context.stateSchema).toEqual({
      temperature: { type: 'number', source: 'registry' }
    })
    expect(summarizeDeviceCardAuthoringTarget({
      ...target,
      stateSchema: context.stateSchema
    }).contextAvailability).toBe('ready')
  })
})
