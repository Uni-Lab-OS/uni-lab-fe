import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  allowsOversizePackagingBenchmark,
  resolveWindowsPrecompressedProfile,
  resolveWorkbenchPackageMode,
  resolveWorkbenchReleaseChannel,
  supportsWorkbenchUpdates,
  WINDOWS_PRECOMPRESSED_PROFILES,
  WORKBENCH_PACKAGE_MODES,
  WORKBENCH_RELEASE_CHANNELS
} from './packaging-mode.mjs'

describe('Workbench packaging modes', () => {
  /** 验证日常校验、完整介质与预构建介质三种模式使用封闭集合。 */
  it('accepts only supported packaging modes', () => {
    assert.deepEqual(WORKBENCH_PACKAGE_MODES, [
      'full',
      'directory',
      'prepackaged'
    ])
    assert.equal(resolveWorkbenchPackageMode(undefined), 'full')
    assert.equal(resolveWorkbenchPackageMode(' directory '), 'directory')
    assert.equal(resolveWorkbenchPackageMode('prepackaged'), 'prepackaged')
    assert.throws(
      () => resolveWorkbenchPackageMode('benchmark'),
      /不支持的 Workbench 介质生成模式/u
    )
  })

  /** 验证热更新测试通道与普通测试包显式分离，缺省值仍失败关闭。 */
  it('accepts isolated update-test release channels', () => {
    assert.deepEqual(WORKBENCH_RELEASE_CHANNELS, [
      'production',
      'update-test',
      'test'
    ])
    assert.equal(resolveWorkbenchReleaseChannel(undefined), 'test')
    assert.equal(resolveWorkbenchReleaseChannel(' test '), 'test')
    assert.equal(resolveWorkbenchReleaseChannel('update-test'), 'update-test')
    assert.equal(supportsWorkbenchUpdates('production'), true)
    assert.equal(supportsWorkbenchUpdates('update-test'), true)
    assert.equal(supportsWorkbenchUpdates('test'), false)
    assert.throws(
      () => resolveWorkbenchReleaseChannel('staging'),
      /不支持的 Workbench 发布通道/u
    )
  })

  /** 验证 Windows 只允许基线和 EXE 已压缩资源两个可比较档位。 */
  it('accepts only named Windows precompressed profiles', () => {
    assert.deepEqual(WINDOWS_PRECOMPRESSED_PROFILES, {
      none: [],
      exe: ['.exe']
    })
    assert.deepEqual(resolveWindowsPrecompressedProfile(undefined), {
      name: 'none',
      extensions: []
    })
    assert.deepEqual(resolveWindowsPrecompressedProfile('exe'), {
      name: 'exe',
      extensions: ['.exe']
    })
    assert.throws(
      () => resolveWindowsPrecompressedProfile('all'),
      /不支持的 Windows 已压缩资源配置/u
    )
  })

  /** 验证超预算豁免只在隔离基准显式启用，正式包默认严格失败。 */
  it('requires an explicit oversize benchmark opt-in', () => {
    assert.equal(allowsOversizePackagingBenchmark({}), false)
    assert.equal(allowsOversizePackagingBenchmark({
      UNILAB_WORKBENCH_ALLOW_OVERSIZE_BENCHMARK: '0'
    }), false)
    assert.equal(allowsOversizePackagingBenchmark({
      UNILAB_WORKBENCH_ALLOW_OVERSIZE_BENCHMARK: '1'
    }), true)
  })
})
