import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  parseStableWorkbenchVersion,
  readWorkbenchUpdateMetadataVersion,
  requireWorkbenchUpdateUrl,
  selectNextWorkbenchVersion,
  selectMacosUpdateArtifacts,
  selectPortableUpdateArtifacts
} from './update-publish.mjs'

describe('Workbench update publish URL', () => {
  it('accepts a credential-free HTTPS directory', () => {
    assert.equal(requireWorkbenchUpdateUrl({
      UNILAB_WORKBENCH_UPDATE_URL:
        'https://updates.example.com/workbench/stable/'
    }), 'https://updates.example.com/workbench/stable')
  })

  it('rejects missing, insecure or credential-bearing endpoints', () => {
    assert.throws(() => requireWorkbenchUpdateUrl({}), /缺少/u)
    assert.throws(() => requireWorkbenchUpdateUrl({
      UNILAB_WORKBENCH_UPDATE_URL:
        'http://updates.example.com/workbench/stable'
    }), /HTTPS/u)
    assert.throws(() => requireWorkbenchUpdateUrl({
      UNILAB_WORKBENCH_UPDATE_URL:
        'https://user:secret@updates.example.com/workbench/stable'
    }), /无凭据/u)
  })

  it('increments the published patch without rewriting the source version', () => {
    assert.deepEqual(parseStableWorkbenchVersion('0.1.12'), [0, 1, 12])
    assert.equal(selectNextWorkbenchVersion('0.1.1', '0.1.1'), '0.1.2')
    assert.equal(selectNextWorkbenchVersion('0.1.1', '0.1.9'), '0.1.10')
    assert.equal(selectNextWorkbenchVersion('0.2.0', '0.1.9'), '0.2.0')
    assert.equal(selectNextWorkbenchVersion('1.0.0', '0.9.9'), '1.0.0')
    assert.equal(selectNextWorkbenchVersion('0.9.9', '1.0.0'), '1.0.1')
    assert.equal(selectNextWorkbenchVersion('0.1.1'), '0.1.1')
  })

  it('reads only stable versions from update metadata', () => {
    assert.equal(readWorkbenchUpdateMetadataVersion([
      'version: 0.1.9',
      'files:',
      '  - url: UniLab.Workbench-0.1.9-x64-setup.exe'
    ].join('\n')), '0.1.9')
    assert.equal(readWorkbenchUpdateMetadataVersion("version: '1.2.3'\n"), '1.2.3')
    assert.throws(
      () => readWorkbenchUpdateMetadataVersion('files: []\n'),
      /缺少 version/u
    )
    assert.throws(
      () => selectNextWorkbenchVersion('0.1.1-beta.1', '0.1.0'),
      /稳定版本/u
    )
    assert.throws(
      () => selectNextWorkbenchVersion('0.1.1', '0.1.0-beta.1'),
      /稳定版本/u
    )
  })

  it('selects a complete Windows update bundle and rejects missing blockmaps', () => {
    const names = [
      'UniLab Workbench-0.1.1-x64-setup.exe',
      'UniLab Workbench-0.1.1-x64-setup.exe.blockmap',
      'latest.yml',
      'builder-debug.yml'
    ]
    assert.deepEqual(selectPortableUpdateArtifacts(names, 'win-64'), names.slice(0, 3))
    assert.throws(() => selectPortableUpdateArtifacts([
      names[0],
      names[2]
    ], 'win-64'), /blockmap/u)
  })

  it('selects complete Linux and macOS update bundles', () => {
    assert.deepEqual(selectPortableUpdateArtifacts([
      'UniLab Workbench-0.1.1-x64.AppImage',
      'UniLab Workbench-0.1.1-x64.AppImage.blockmap',
      'latest-linux.yml'
    ], 'linux-64'), [
      'UniLab Workbench-0.1.1-x64.AppImage',
      'UniLab Workbench-0.1.1-x64.AppImage.blockmap',
      'latest-linux.yml'
    ])
    assert.deepEqual(selectMacosUpdateArtifacts([
      'UniLab Workbench-0.1.1-arm64.dmg',
      'UniLab Workbench-0.1.1-arm64.zip',
      'UniLab Workbench-0.1.1-arm64.zip.blockmap',
      'latest-mac.yml'
    ]), [
      'UniLab Workbench-0.1.1-arm64.dmg',
      'UniLab Workbench-0.1.1-arm64.zip',
      'UniLab Workbench-0.1.1-arm64.zip.blockmap',
      'latest-mac.yml'
    ])
  })
})
