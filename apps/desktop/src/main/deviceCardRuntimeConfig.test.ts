import { describe, expect, it } from 'vitest'

import type { DeviceCardManifest } from '@unilab/device-card-sdk'

import { buildDeviceCardRuntimeConfig } from './deviceCardRuntimeConfig'

function previewManifest(): DeviceCardManifest {
  return {
    schemaVersion: 1,
    id: 'community.test.preview.card',
    version: '0.1.0',
    title: 'Preview Arm',
    deviceTypes: ['community.test.preview'],
    sdkVersion: '^0.1.0',
    hostProtocolVersion: 1,
    authoringProfile: 'web-component-lite-v1',
    entry: 'src/index.ts',
    uiFeatures: ['core'],
    permissions: {
      state: ['online', 'jointState', 'actionBusy'],
      actions: ['moveJ', 'home', 'stop'],
      media: []
    },
    config: {
      version: 1,
      defaults: {
        branding: { title: 'Preview Arm' }
      },
      schema: { type: 'object' }
    }
  }
}

describe('buildDeviceCardRuntimeConfig', () => {
  it('合并 defaults 与 Host 收窄后的 allowedActions / allowedState', () => {
    expect(buildDeviceCardRuntimeConfig(previewManifest())).toEqual({
      branding: { title: 'Preview Arm' },
      allowedActions: ['moveJ', 'home', 'stop'],
      allowedState: ['online', 'jointState', 'actionBusy']
    })
  })
})
