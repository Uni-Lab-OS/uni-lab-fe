import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseRuntimeRestoreArguments,
  parseSha256Manifest,
  restoreVersionedRuntime
} from './restore-runtime-release.mjs'

/**
 * 为 Runtime Release 单元测试创建按 URL 返回固定响应的网络替身。
 * @param {Map<string, Response>} responses URL 到响应对象的映射。
 * @returns {typeof fetch} 与原生 fetch 兼容的测试替身。
 */
function createFetchFixture(responses) {
  return async url => {
    const response = responses.get(String(url))
    return response ? response.clone() : new Response('', { status: 404 })
  }
}

describe('versioned Runtime release restore', () => {
  /** 验证缺少 Release 时安全回退，不创建伪造 Runtime 文件。 */
  it('returns a cache miss when the immutable release does not exist', async () => {
    const destination = join(tmpdir(), `missing-runtime-${process.pid}`)
    const result = await restoreVersionedRuntime({
      repository: 'Uni-Lab-OS/uni-lab-fe',
      tag: 'workbench-runtime-test',
      assetName: 'runtime.exe',
      destination,
      fetchImpl: async () => new Response('', { status: 404 })
    })
    assert.deepEqual(result, {
      restored: false,
      reason: 'missing-release'
    })
  })

  /** 验证生产 CI 能鉴权读取不展示在公开 Releases 页面中的 Draft Runtime。 */
  it('restores an authenticated Draft Runtime hidden from the tag endpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'draft-runtime-release-test-'))
    const destination = join(directory, 'runtime.exe')
    const payload = Buffer.from('trusted hidden runtime fixture')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    const releaseUrl =
      'https://api.github.com/repos/Uni-Lab-OS/uni-lab-fe/releases/tags/workbench-runtime-test'
    const releasesUrl =
      'https://api.github.com/repos/Uni-Lab-OS/uni-lab-fe/releases?per_page=100'
    const installerUrl = 'https://api.github.test/assets/draft-installer'
    const checksumUrl = 'https://api.github.test/assets/draft-checksum'
    const fetchImpl = createFetchFixture(new Map([
      [releaseUrl, new Response('', { status: 404 })],
      [releasesUrl, Response.json([{
        tag_name: 'workbench-runtime-test',
        draft: true,
        assets: [
          { name: 'runtime.exe', url: installerUrl },
          { name: 'runtime.exe.sha256', url: checksumUrl }
        ]
      }])],
      [installerUrl, new Response(payload)],
      [checksumUrl, new Response(`${sha256}  runtime.exe\n`)]
    ]))
    try {
      const result = await restoreVersionedRuntime({
        repository: 'Uni-Lab-OS/uni-lab-fe',
        tag: 'workbench-runtime-test',
        assetName: 'runtime.exe',
        destination,
        token: 'test-token',
        fetchImpl
      })
      assert.deepEqual(result, {
        restored: true,
        reason: 'release',
        sha256
      })
      assert.deepEqual(await readFile(destination), payload)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  /** 验证 Release 资产只有在文件名和 SHA-256 都匹配时才进入打包输入。 */
  it('streams and verifies an immutable runtime asset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'runtime-release-test-'))
    const destination = join(directory, 'runtime.exe')
    const payload = Buffer.from('trusted runtime fixture')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    const releaseUrl =
      'https://api.github.com/repos/Uni-Lab-OS/uni-lab-fe/releases/tags/workbench-runtime-test'
    const installerUrl = 'https://api.github.test/assets/1'
    const checksumUrl = 'https://api.github.test/assets/2'
    const fetchImpl = createFetchFixture(new Map([
      [releaseUrl, Response.json({ assets: [
        { name: 'runtime.exe', url: installerUrl },
        { name: 'runtime.exe.sha256', url: checksumUrl }
      ] })],
      [installerUrl, new Response(payload)],
      [checksumUrl, new Response(`${sha256}  runtime.exe\n`)]
    ]))
    try {
      const result = await restoreVersionedRuntime({
        repository: 'Uni-Lab-OS/uni-lab-fe',
        tag: 'workbench-runtime-test',
        assetName: 'runtime.exe',
        destination,
        fetchImpl
      })
      assert.deepEqual(result, {
        restored: true,
        reason: 'release',
        sha256
      })
      assert.deepEqual(await readFile(destination), payload)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  /** 验证摘要不一致时失败关闭，并清理临时下载文件。 */
  it('rejects a runtime asset with a mismatched digest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'runtime-release-test-'))
    const destination = join(directory, 'runtime.exe')
    const releaseUrl =
      'https://api.github.com/repos/Uni-Lab-OS/uni-lab-fe/releases/tags/workbench-runtime-test'
    const installerUrl = 'https://api.github.test/assets/1'
    const checksumUrl = 'https://api.github.test/assets/2'
    const fetchImpl = createFetchFixture(new Map([
      [releaseUrl, Response.json({ assets: [
        { name: 'runtime.exe', url: installerUrl },
        { name: 'runtime.exe.sha256', url: checksumUrl }
      ] })],
      [installerUrl, new Response('tampered runtime')],
      [checksumUrl, new Response(`${'0'.repeat(64)}  runtime.exe\n`)]
    ]))
    try {
      await assert.rejects(
        restoreVersionedRuntime({
          repository: 'Uni-Lab-OS/uni-lab-fe',
          tag: 'workbench-runtime-test',
          assetName: 'runtime.exe',
          destination,
          fetchImpl
        }),
        /SHA-256 不一致/u
      )
      await assert.rejects(readFile(destination), /ENOENT/u)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  /** 验证 CLI 参数和摘要清单必须绑定精确资产名。 */
  it('parses strict command arguments and checksum manifests', () => {
    assert.deepEqual(parseRuntimeRestoreArguments([
      '--repository', 'Uni-Lab-OS/uni-lab-fe',
      '--tag', 'runtime-v1',
      '--asset', 'runtime.exe',
      '--destination', 'dist/runtime.exe'
    ]), {
      repository: 'Uni-Lab-OS/uni-lab-fe',
      tag: 'runtime-v1',
      assetName: 'runtime.exe',
      destination: 'dist/runtime.exe'
    })
    assert.equal(
      parseSha256Manifest(`${'A'.repeat(64)}  runtime.exe\n`, 'runtime.exe'),
      'a'.repeat(64)
    )
    assert.throws(
      () => parseSha256Manifest(`${'a'.repeat(64)}  other.exe`, 'runtime.exe'),
      /清单无效/u
    )
  })

  /** 验证 Runtime 发布流水线保持手动、版本化、跨平台且不可原地覆盖。 */
  it('publishes an immutable cross-platform Runtime release', async () => {
    const workflow = await readFile(
      new URL('../../../.github/workflows/package-workbench-runtime.yml', import.meta.url),
      'utf8'
    )

    const windowsJob = workflow.slice(
      workflow.indexOf('  build-windows-runtime:'),
      workflow.indexOf('  build-macos-runtime:')
    )
    const windowsCheckoutPath = windowsJob.match(
      /repository: Uni-Lab-OS\/Uni-Lab-OS[\s\S]*?^\s+path: (\S+)$/mu
    )?.[1]
    assert.ok(windowsCheckoutPath, 'Windows Runtime 必须声明 OS 源码检出目录')
    const longestGeneratedHeader = [
      'D:\\a\\uni-lab-fe\\uni-lab-fe',
      windowsCheckoutPath,
      'output\\bld\\rattler-build_ros-humble-unilabos-msgs_1234567890',
      'work\\build\\rosidl_generator_cpp\\unilabos_msgs\\action\\detail',
      'reaction_station_liquid_feed_vials_non_titration__rosidl_typesupport_fastrtps_cpp.hpp'
    ].join('\\')
    assert.ok(
      longestGeneratedHeader.length <= 240,
      `Windows ROS 生成路径超过安全预算: ${longestGeneratedHeader.length}`
    )
    assert.match(windowsJob, new RegExp(`working-directory: ${windowsCheckoutPath.replace('.', '\\.')}`, 'u'))

    assert.match(workflow, /^name: Publish Versioned Workbench Runtime$/mu)
    assert.match(workflow, /^\s+workflow_dispatch:$/mu)
    assert.doesNotMatch(workflow, /^\s+push:$/mu)
    assert.match(
      workflow,
      /UNILAB_RUNTIME_RELEASE_TAG: workbench-runtime-0\.11\.3-9623b51c/u
    )
    assert.match(
      workflow,
      /UNILAB_RUNTIME_SOURCE_REF: 9623b51c6304dfd44f283a4353425d9592f7934f/u
    )
    assert.doesNotMatch(workflow, /UNILAB_RUNTIME_OPCUA_FIX_REF/u)
    assert.doesNotMatch(workflow, /UNILAB_RUNTIME_BUILD_PIN_REF/u)
    assert.match(workflow, /runs-on: windows-2022/u)
    assert.match(workflow, /runs-on: macos-14/u)
    assert.match(workflow, /actions\/cache\/restore@v6/u)
    assert.match(workflow, /actions\/cache\/save@v6/u)
    assert.match(workflow, /rattler-build/u)
    assert.match(workflow, /recipes\/msgs\/recipe\.yaml/u)
    assert.match(workflow, /\.conda\/environment\/recipe\.yaml/u)
    assert.match(workflow, /\.conda\/vendor\/opcua\/recipe\.yaml/u)
    assert.match(workflow, /\.conda\/base\/recipe\.yaml/u)
    assert.match(workflow, /UNILABOS_INSTALLER_CHANNEL/u)
    assert.match(workflow, /import opcua; import unilabos\.workspace_host\.host/u)
    assert.match(workflow, /unilab-supervisor/u)
    assert.match(workflow, /Uni-Lab-OS-\$env:UNILAB_RUNTIME_VERSION-win-64\.exe/u)
    assert.match(workflow, /Uni-Lab-OS-\$UNILAB_RUNTIME_VERSION-osx-arm64\.sh/u)
    assert.match(workflow, /sha256sum --check/u)
    assert.match(workflow, /releases\?per_page=100/u)
    assert.doesNotMatch(workflow, /gh release view/u)
    assert.match(workflow, /gh release create/u)
    assert.match(workflow, /--draft/u)
    assert.doesNotMatch(workflow, /gh release upload/u)
  })
})
