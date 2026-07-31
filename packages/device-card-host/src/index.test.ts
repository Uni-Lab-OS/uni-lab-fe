import { describe, expect, it } from 'vitest'

import { artifactKey, verifyArtifactKey } from './index'

const record = {
  key: 'demo.card:0.1.0:abc',
  id: 'demo.card',
  version: '0.1.0',
  title: 'Demo',
  deviceTypes: ['demo'],
  authoringProfile: 'web-component-lite-v1' as const,
  installedAt: '2026-07-30T00:00:00.000Z',
  artifactDir: '/tmp/demo',
  metadata: {
    schemaVersion: 'device-card-artifact/v1' as const,
    builderVersion: '0.1.0',
    cardId: 'demo.card',
    cardVersion: '0.1.0',
    elementName: 'ulcard-demo',
    manifest: {
      schemaVersion: 1 as const,
      id: 'demo.card',
      version: '0.1.0',
      title: 'Demo',
      deviceTypes: ['demo'],
      sdkVersion: '^0.1.0',
      hostProtocolVersion: 1 as const,
      authoringProfile: 'web-component-lite-v1' as const,
      entry: 'src/card.ts',
      uiFeatures: [],
      permissions: { state: [], actions: [], media: [] }
    },
    sourceHash: 'abc',
    builtAt: '2026-07-30T00:00:00.000Z'
  }
}

describe('device card artifact identity', () => {
  it('uses card, version and source hash', () => {
    expect(artifactKey(record.metadata)).toBe(record.key)
  })

  it('compares opaque keys', () => {
    expect(verifyArtifactKey(record, record.key)).toBe(true)
    expect(verifyArtifactKey(record, 'other')).toBe(false)
  })
})
