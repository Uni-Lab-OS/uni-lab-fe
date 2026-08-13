import { describe, expect, it } from 'vitest'

import type {
  DeviceCardRuntimeSnapshot,
  DeviceDefinitionReference
} from '@unilab/device-card-sdk'

import {
  assertDeviceCardRuntimeCapabilities,
  type RuntimeCardRecord
} from './deviceCardRuntimeValidation'

/**
 * 验证 Live 只接受精确 FQID 且带领域设备包来源的 v2 卡片。
 *
 * @returns 无；断言失败时由 Vitest 报告。
 */
function verifiesPackageDefinitionLiveBinding(): void {
  expect(() => assertDeviceCardRuntimeCapabilities(
    runtimeRecord(),
    {
      key: 'robot.card:0.1.0:hash',
      bounds: { x: 0, y: 0, width: 640, height: 480 },
      context: runtimeContext('live'),
      availableActions: [],
      availableState: ['online', 'actionBusy'],
      availableMedia: []
    }
  )).not.toThrow()
}

/**
 * 验证 v1 遗留卡片即使短类型匹配也不能进入 Live。
 *
 * @returns 无；断言失败时由 Vitest 报告。
 */
function rejectsLegacyLiveBinding(): void {
  const record = runtimeRecord()
  record.definitionTargets = []
  record.legacyDeviceTypes = [definition().fqid]
  record.metadata.manifest = {
    ...record.metadata.manifest,
    schemaVersion: 1,
    deviceTypes: [definition().fqid]
  }
  delete (record.metadata.manifest as { targets?: unknown }).targets

  expect(() => assertDeviceCardRuntimeCapabilities(record, {
    key: 'robot.card:0.1.0:hash',
    bounds: { x: 0, y: 0, width: 640, height: 480 },
    context: runtimeContext('live')
  })).toThrow('v1 遗留卡片仅可用于 Mock')
}

/**
 * 注册领域设备包运行时验证测试。
 *
 * @returns 无；断言失败时由 Vitest 报告。
 */
function registerRuntimeValidationTests(): void {
  it('允许规范 v2 卡片绑定完整设备定义', verifiesPackageDefinitionLiveBinding)
  it('拒绝 v1 遗留卡片进入 Live', rejectsLegacyLiveBinding)
}

describe('设备卡领域包运行时验证', registerRuntimeValidationTests)

/**
 * 构造符合 Core #147 的当前设备定义。
 *
 * @returns 带 PackageCatalog 来源证据的设备定义引用。
 */
function definition(): DeviceDefinitionReference {
  return {
    fqid: 'community.robot_lab.robot',
    version: '1.0.0',
    contentHash: `sha256:${'1'.repeat(64)}`,
    sourceIdentity: 'robot_lab.devices.robot:Robot',
    title: 'Robot',
    description: 'Robot device',
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
  }
}

/**
 * 构造设备卡 Host 的 Live/Mock 快照。
 *
 * @param mode 预览模式。
 * @returns 指向规范设备定义的运行时快照。
 */
function runtimeContext(mode: 'mock' | 'live'): DeviceCardRuntimeSnapshot {
  const current = definition()
  return {
    mode,
    device: {
      deviceId: mode === 'live' ? 'robot-1' : null,
      definitionFqid: current.fqid,
      definition: current,
      deviceTypeId: current.fqid,
      title: current.title
    },
    state: {},
    config: {},
    theme: 'light',
    locale: 'zh-CN'
  }
}

/**
 * 构造按当前设备定义开发的 v2 卡片运行时记录。
 *
 * @returns 可由 Electron 权威校验的卡片记录。
 */
function runtimeRecord(): RuntimeCardRecord {
  const current = definition()
  const target = {
    definitionFqid: current.fqid,
    authoredAgainst: {
      definitionVersion: current.version,
      definitionContentHash: current.contentHash,
      packageCatalogDigest: current.packageCatalog.catalogDigest
    }
  }
  return {
    id: 'robot.card',
    definitionTargets: [target],
    legacyDeviceTypes: [],
    artifactDir: '/tmp/robot-card',
    metadata: {
      schemaVersion: 'device-card-artifact/v1',
      builderVersion: '0.1.0',
      contextAuthority: 'host',
      cardId: 'robot.card',
      cardVersion: '0.1.0',
      elementName: 'ulcard-robot',
      manifest: {
        schemaVersion: 2,
        id: 'robot.card',
        version: '0.1.0',
        title: 'Robot card',
        targets: [target],
        sdkVersion: '^0.1.0',
        hostProtocolVersion: 1,
        authoringProfile: 'web-component-lite-v1',
        entry: 'src/card.ts',
        uiFeatures: [],
        permissions: {
          state: ['online', 'actionBusy'],
          actions: [],
          media: []
        }
      },
      sourceHash: 'hash',
      builtAt: '2026-08-13T00:00:00.000Z'
    }
  }
}
