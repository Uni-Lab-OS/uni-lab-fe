import { describe, expect, it } from 'vitest'

import {
  parseDeviceCardManifest,
  validateDeviceCardManifest
} from './manifest'

const VALID_MANIFEST = {
  schemaVersion: 1,
  id: 'demo.centrifuge.card',
  version: '0.1.0',
  title: '离心机',
  deviceTypes: ['centrifuge'],
  sdkVersion: '^1.0.0',
  hostProtocolVersion: 1,
  authoringProfile: 'vue-web-component-v1',
  entry: 'src/card.vue',
  uiFeatures: ['core'],
  permissions: {
    state: ['status'],
    actions: ['start'],
    media: []
  }
}

describe('device card manifest', () => {
  it('accepts a valid Vue profile manifest', () => {
    expect(parseDeviceCardManifest(VALID_MANIFEST).id)
      .toBe('demo.centrifuge.card')
  })

  it('rejects profile and entry mismatches', () => {
    const diagnostics = validateDeviceCardManifest({
      ...VALID_MANIFEST,
      authoringProfile: 'react-web-component-v1',
      entry: 'src/card.vue'
    })
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'manifest.entry_extension',
      severity: 'error'
    }))
  })

  it('rejects duplicate permissions', () => {
    const diagnostics = validateDeviceCardManifest({
      ...VALID_MANIFEST,
      permissions: {
        ...VALID_MANIFEST.permissions,
        state: ['status', 'status']
      }
    })
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'manifest.permissions.state'
    }))
  })
})
