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

const { deviceTypes: _legacyDeviceTypes, ...VALID_MANIFEST_BASE } = VALID_MANIFEST
const VALID_PACKAGE_MANIFEST = {
  ...VALID_MANIFEST_BASE,
  schemaVersion: 2,
  targets: [{
    definitionFqid: 'community.szlab_poly_studio.szlab_mixer_robot',
    authoredAgainst: {
      definitionVersion: '1.0.0',
      definitionContentHash: `sha256:${'1'.repeat(64)}`,
      packageCatalogDigest: `sha256:${'2'.repeat(64)}`
    }
  }]
} satisfies Record<string, unknown>

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

  it('接受带规范设备定义与软件包目录证据的 v2 Manifest', () => {
    /** 证明新卡片用 definition FQID 和 authored-against 摘要持久化目标。 */
    const manifest = parseDeviceCardManifest(VALID_PACKAGE_MANIFEST)
    expect(manifest.schemaVersion).toBe(2)
    if (manifest.schemaVersion !== 2) throw new Error('预期 v2 Manifest')
    expect(manifest.targets[0]?.definitionFqid)
      .toBe('community.szlab_poly_studio.szlab_mixer_robot')
  })

  it('拒绝在 v2 Manifest 中回退到 deviceTypes', () => {
    /** 证明新卡片不能用短类型或运行时实例身份绕过 definition FQID。 */
    const diagnostics = validateDeviceCardManifest({
      ...VALID_PACKAGE_MANIFEST,
      targets: [],
      deviceTypes: ['szlab_mixer_robot']
    })
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'manifest.targets' }),
      expect.objectContaining({ code: 'manifest.deviceTypes_legacy' })
    ]))
  })

  it('拒绝缺少或伪造 authored-against 摘要的定义目标', () => {
    /** 证明卡片生成证据不接受普通字符串或不完整摘要。 */
    const diagnostics = validateDeviceCardManifest({
      ...VALID_PACKAGE_MANIFEST,
      targets: [{
        definitionFqid: 'community.szlab_poly_studio.szlab_mixer_robot',
        authoredAgainst: {
          definitionVersion: '1.0.0',
          definitionContentHash: 'not-a-digest',
          packageCatalogDigest: ''
        }
      }]
    })
    expect(diagnostics.filter(item => item.code === 'manifest.definition_digest'))
      .toHaveLength(2)
  })
})
