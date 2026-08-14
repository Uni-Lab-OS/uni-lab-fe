import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  DeviceCardAuthoringContextV2,
  DeviceCardManifestV2
} from '@unilab/device-card-sdk'

import {
  isPathInsideRoot,
  isSafeArchivePath,
  scanSource,
  validatePermissionsAgainstContext
} from './security'

describe('device card source policy', () => {
  it('rejects direct network access', () => {
    expect(scanSource('await fetch("/secret")', 'src/card.ts'))
      .toContainEqual(expect.objectContaining({
        code: 'source.network_fetch'
      }))
  })

  it('accepts bridge-only source', () => {
    expect(scanSource(
      'const result = await bridge.callAction("start")',
      'src/card.ts'
    )).toEqual([])
  })

  it('does not treat PointSet global.arm.* refs as Node global', () => {
    expect(scanSource(
      "const home = catalog.find(point => point.target_ref === 'global.arm.home')",
      'src/card.ts'
    )).toEqual([])
  })

  it('still rejects Node globalThis', () => {
    expect(scanSource('const g = globalThis.process', 'src/card.ts'))
      .toContainEqual(expect.objectContaining({
        code: 'source.node_runtime'
      }))
  })

  it('rejects unsafe archive paths', () => {
    expect(isSafeArchivePath('../escape.ts')).toBe(false)
    expect(isSafeArchivePath('/absolute.ts')).toBe(false)
    expect(isSafeArchivePath('src/card.ts')).toBe(true)
  })

  it('does not treat a sibling directory as inside the project', () => {
    const projectDir = join(tmpdir(), 'unilab-card-project')
    const frameworkFile = join(tmpdir(), 'node_modules', 'vue', 'index.js')

    expect(isPathInsideRoot(projectDir, join(projectDir, 'src', 'card.vue'))).toBe(true)
    expect(isPathInsideRoot(projectDir, frameworkFile)).toBe(false)
  })

  it('does not treat a different Windows drive as inside the project', () => {
    if (process.platform !== 'win32') return
    expect(isPathInsideRoot('C:\\tmp\\card-project', 'F:\\repo\\node_modules\\vue\\index.js'))
      .toBe(false)
  })

  it('rejects v2 authored-against evidence from another package generation', () => {
    const context = authoringContext()
    const manifest = manifestV2(context)
    manifest.targets[0].authoredAgainst.packageCatalogDigest =
      `sha256:${'9'.repeat(64)}`

    expect(validatePermissionsAgainstContext(manifest, context))
      .toContainEqual(expect.objectContaining({
        code: 'context.definition_provenance'
      }))
  })
})

/**
 * 构造带完整 PackageCatalog 来源的 v2 开发上下文。
 *
 * @returns 可用于构建权限校验的设备卡开发上下文。
 */
function authoringContext(): DeviceCardAuthoringContextV2 {
  return {
    schemaVersion: 'device-card-authoring-context/v2',
    deviceId: 'robot-1',
    deviceTypeId: 'community.robot_lab.robot',
    definition: {
      fqid: 'community.robot_lab.robot',
      version: '1.0.0',
      contentHash: `sha256:${'1'.repeat(64)}`,
      sourceIdentity: 'robot_lab.devices.robot:Robot',
      title: 'Robot',
      description: '',
      category: ['robot'],
      manufacturer: 'Uni-Lab',
      packageCatalog: {
        schemaVersion: '1',
        distribution: {
          name: 'robot-lab',
          normalizedName: 'robot_lab',
          version: '0.1.0'
        },
        importPackage: 'robot_lab',
        namespace: 'community.robot_lab',
        contentDigest: `sha256:${'2'.repeat(64)}`,
        catalogDigest: `sha256:${'3'.repeat(64)}`
      }
    },
    title: 'Robot',
    actions: [],
    stateSchema: {},
    sampleState: {},
    media: []
  }
}

/**
 * 生成与指定开发上下文完全一致的 v2 Manifest。
 *
 * @param context 当前 OS 设备定义开发上下文。
 * @returns 以该定义版本和摘要为 authored-against 证据的 Manifest。
 */
function manifestV2(context: DeviceCardAuthoringContextV2): DeviceCardManifestV2 {
  return {
    schemaVersion: 2,
    id: 'robot.card',
    version: '0.1.0',
    title: 'Robot card',
    targets: [{
      definitionFqid: context.definition.fqid,
      authoredAgainst: {
        definitionVersion: context.definition.version,
        definitionContentHash: context.definition.contentHash,
        packageCatalogDigest: context.definition.packageCatalog.catalogDigest
      }
    }],
    sdkVersion: '^0.1.0',
    hostProtocolVersion: 1,
    authoringProfile: 'web-component-lite-v1',
    entry: 'src/card.ts',
    uiFeatures: [],
    permissions: { state: [], actions: [], media: [] }
  }
}
