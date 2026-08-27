import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ManagedRuntimeInstallation,
  resolveManagedRuntimeDataDirectory
} from './managedRuntimeInstallation'

const temporaryDirectories: string[] = []
/** 把 Node 回调式进程执行接口转换为 Promise，供入口可执行性验收使用。 */
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(
    directory,
    { recursive: true, force: true }
  )))
})

describe('ManagedRuntimeInstallation', () => {
  it('keeps Constructor prefixes outside Electron paths with rejected characters', () => {
    const userDataDirectory = join(
      '/Users/lc',
      'Library',
      'Application Support',
      '@unilab',
      'workbench'
    )

    expect(resolveManagedRuntimeDataDirectory({
      platform: 'darwin',
      homeDirectory: '/Users/lc',
      userDataDirectory
    })).toBe('/Users/lc/.unilabos/workbench')
    expect(resolveManagedRuntimeDataDirectory({
      platform: 'linux',
      homeDirectory: '/home/lc',
      userDataDirectory: '/home/lc/.config/@unilab/workbench'
    })).toBe('/home/lc/.unilabos/workbench')
    expect(resolveManagedRuntimeDataDirectory({
      platform: 'win32',
      homeDirectory: 'C:\\Users\\lc',
      userDataDirectory: 'C:\\Users\\lc\\AppData\\Roaming\\@unilab\\workbench'
    })).toBe('C:\\Users\\lc\\.unilabos\\workbench')
  })

  it('verifies and installs the bundled Constructor payload once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unilab-managed-runtime-'))
    temporaryDirectories.push(root)
    const resourcesDirectory = join(root, 'resources')
    const dataDirectory = join(root, 'data')
    const payloadDirectory = join(resourcesDirectory, 'runtime-installer')
    const installerName = 'Uni-Lab-OS-0.11.3-linux-64.sh'
    const installerPath = join(payloadDirectory, installerName)
    const installerBytes = Buffer.from('offline-constructor-payload')
    await mkdir(payloadDirectory, { recursive: true })
    await mkdir(
      join(resourcesDirectory, 'default-workspace', 'deployment', 'graphs'),
      { recursive: true }
    )
    await writeFile(installerPath, installerBytes)
    await writeFile(join(payloadDirectory, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      runtimeVersion: '0.11.3',
      platform: 'linux-64',
      installerFile: installerName,
      sha256: createHash('sha256').update(installerBytes).digest('hex')
    }))
    await Promise.all([
      writeFile(
        join(resourcesDirectory, 'default-workspace', 'deployment', 'graphs', 'device.json'),
        '{}'
      ),
      writeFile(
        join(resourcesDirectory, 'default-workspace', 'deployment', 'local_config.py'),
        ''
      ),
      writeFile(
        join(resourcesDirectory, 'default-workspace', 'package.yaml'),
        'package:\n  name: bundled-reference\n'
      )
    ])

    const runner = vi.fn(async (_installerPath: string, prefix: string) => {
      await mkdir(join(prefix, 'bin'), { recursive: true })
      await Promise.all([
        writeFile(join(prefix, 'bin', 'python'), ''),
        writeFile(join(prefix, 'bin', 'unilab'), ''),
        writeFile(join(prefix, 'bin', 'unilab-supervisor'), '')
      ])
      await Promise.all([
        chmod(join(prefix, 'bin', 'python'), 0o755),
        chmod(join(prefix, 'bin', 'unilab'), 0o755),
        chmod(join(prefix, 'bin', 'unilab-supervisor'), 0o755)
      ])
    })
    const installation = new ManagedRuntimeInstallation({
      resourcesDirectory,
      dataDirectory,
      platform: 'linux',
      architecture: 'x64',
      runInstaller: runner,
      verifyInstallation: vi.fn(async () => undefined)
    })

    await expect(installation.getModeInfo()).resolves.toEqual({
      mode: 'managed',
      label: '内置 Runtime',
      runtimeVersion: '0.11.3',
      defaultLaunchConfig: {
        graphPath: join(
          resourcesDirectory,
          'default-workspace',
          'deployment',
          'graphs',
          'device.json'
        ),
        osProjectPath: '',
        szlabProjectPath: join(resourcesDirectory, 'default-workspace'),
        environmentPath: '',
        simulatorProjectPath: '',
        edgeCommandMode: 'generated',
        customEdgeCommand: {
          executable: '',
          workingDirectory: '{{workspace}}',
          args: [],
          environment: []
        }
      }
    })
    expect(runner).not.toHaveBeenCalled()

    const first = await installation.ensureInstalled()
    const second = await installation.ensureInstalled()

    expect(first).toEqual(second)
    expect(first.runtimeVersion).toBe('0.11.3')
    expect(first.platform).toBe('linux-64')
    expect(first.prefix).toContain(join('managed-runtime', 'versions'))
    expect(first.unilabExecutable).toBe(join(first.prefix, 'bin', 'unilab'))
    expect(first.supervisorExecutable).toBe(
      join(first.prefix, 'bin', 'unilab-supervisor')
    )
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner).toHaveBeenCalledWith(
      installerPath,
      first.prefix,
      expect.stringMatching(/managed-runtime\/logs\/constructor-install-/)
    )
  })

  it('downloads, verifies, caches and installs an online Constructor payload', async () => {
    const installerBytes = Buffer.from('online-constructor-payload')
    const fixture = await createInstallationFixture(installerBytes)
    const payloadDirectory = join(
      fixture.resourcesDirectory,
      'runtime-installer'
    )
    const installerName = 'Uni-Lab-OS-0.11.3-linux-64.sh'
    const installerPath = join(payloadDirectory, installerName)
    const digest = createHash('sha256').update(installerBytes).digest('hex')
    await rm(installerPath)
    await writeFile(join(payloadDirectory, 'manifest.json'), JSON.stringify({
      schemaVersion: 2,
      delivery: 'download',
      runtimeVersion: '0.11.3',
      platform: 'linux-64',
      installerFile: installerName,
      sha256: digest,
      downloadUrl:
        'https://github.com/Uni-Lab-OS/uni-lab-fe/releases/download/workbench-runtime-download-test-0.11.3/Uni-Lab-OS-0.11.3-linux-64.sh'
    }))
    const downloadInstaller = vi.fn(async (
      _url: string,
      destination: string
    ) => writeFile(destination, installerBytes))
    const runner = vi.fn(async (resolvedInstaller: string, prefix: string) => {
      expect(resolvedInstaller).toContain(join(
        'managed-runtime',
        'downloads',
        digest,
        installerName
      ))
      await writeLinuxRuntime(prefix)
    })
    const installation = new ManagedRuntimeInstallation({
      ...fixture,
      platform: 'linux',
      downloadInstaller,
      runInstaller: runner
    })

    await expect(installation.inspect()).resolves.toMatchObject({
      installed: false,
      delivery: 'download'
    })
    await installation.ensureInstalled()

    expect(downloadInstaller).toHaveBeenCalledTimes(1)
    expect(downloadInstaller).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\//u),
      expect.stringMatching(/\.download$/u)
    )
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('rejects a downloaded Constructor whose digest does not match', async () => {
    const installerBytes = Buffer.from('expected-online-constructor')
    const fixture = await createInstallationFixture(installerBytes)
    const payloadDirectory = join(
      fixture.resourcesDirectory,
      'runtime-installer'
    )
    const installerName = 'Uni-Lab-OS-0.11.3-linux-64.sh'
    await rm(join(payloadDirectory, installerName))
    await writeFile(join(payloadDirectory, 'manifest.json'), JSON.stringify({
      schemaVersion: 2,
      delivery: 'download',
      runtimeVersion: '0.11.3',
      platform: 'linux-64',
      installerFile: installerName,
      sha256: createHash('sha256').update(installerBytes).digest('hex'),
      downloadUrl:
        'https://github.com/Uni-Lab-OS/uni-lab-fe/releases/download/workbench-runtime-download-test-0.11.3/Uni-Lab-OS-0.11.3-linux-64.sh'
    }))
    const runner = vi.fn()
    const installation = new ManagedRuntimeInstallation({
      ...fixture,
      platform: 'linux',
      downloadInstaller: async (_url, destination) => {
        await writeFile(destination, 'tampered payload')
      },
      runInstaller: runner
    })

    await expect(installation.ensureInstalled()).rejects.toThrow(
      /Runtime 安装器校验失败.*日志：/u
    )
    expect(runner).not.toHaveBeenCalled()
  })

  it('classifies a persisted older managed Runtime as upgrade-required', async () => {
    const fixture = await createInstallationFixture()
    const previousPrefix = join(
      fixture.dataDirectory,
      'managed-runtime',
      'versions',
      `0.10.0-linux-64-${'b'.repeat(16)}`
    )
    await mkdir(previousPrefix, { recursive: true })
    await mkdir(join(fixture.dataDirectory, 'managed-runtime'), {
      recursive: true
    })
    await writeFile(
      join(fixture.dataDirectory, 'managed-runtime', 'active.json'),
      JSON.stringify({
        schemaVersion: 1,
        prefix: previousPrefix,
        runtimeVersion: '0.10.0',
        platform: 'linux-64',
        manifestSha256: 'b'.repeat(64)
      })
    )
    const installation = new ManagedRuntimeInstallation({
      ...fixture,
      platform: 'linux'
    })

    await expect(installation.inspect(previousPrefix)).resolves.toMatchObject({
      installed: false,
      selection: {
        kind: 'outdated-managed',
        path: previousPrefix,
        runtimeVersion: '0.10.0'
      }
    })
  })

  it('recognizes an older managed Runtime even when the bundled manifest is damaged', async () => {
    const fixture = await createInstallationFixture()
    const previousPrefix = join(
      fixture.dataDirectory,
      'managed-runtime',
      'versions',
      `0.10.0-linux-64-${'b'.repeat(16)}`
    )
    await mkdir(previousPrefix, { recursive: true })
    await writeFile(
      join(fixture.resourcesDirectory, 'runtime-installer', 'manifest.json'),
      '{damaged'
    )
    const installation = new ManagedRuntimeInstallation({
      ...fixture,
      platform: 'linux'
    })

    await expect(installation.classifySelection(previousPrefix)).resolves.toEqual({
      kind: 'outdated-managed',
      path: previousPrefix,
      runtimeVersion: '0.10.0'
    })
    await expect(installation.inspect(previousPrefix)).rejects.toThrow(
      'Runtime manifest 不是有效 JSON'
    )
  })

  it('keeps the previous managed Runtime and active receipt when upgrade installation fails', async () => {
    const fixture = await createInstallationFixture()
    const runtimeRoot = join(fixture.dataDirectory, 'managed-runtime')
    const previousPrefix = join(
      runtimeRoot,
      'versions',
      `0.10.0-linux-64-${'b'.repeat(16)}`
    )
    const marker = join(previousPrefix, 'previous-runtime.marker')
    const activePath = join(runtimeRoot, 'active.json')
    const activeReceipt = JSON.stringify({
      schemaVersion: 1,
      prefix: previousPrefix,
      runtimeVersion: '0.10.0',
      platform: 'linux-64',
      manifestSha256: 'b'.repeat(64)
    })
    await mkdir(previousPrefix, { recursive: true })
    await writeFile(marker, 'previous-runtime')
    await writeFile(activePath, activeReceipt)
    const installation = new ManagedRuntimeInstallation({
      ...fixture,
      platform: 'linux',
      runInstaller: vi.fn(async () => {
        throw new Error('upgrade failed')
      })
    })

    await expect(installation.ensureInstalled()).rejects.toThrow('upgrade failed')
    await expect(readFile(marker, 'utf8')).resolves.toBe('previous-runtime')
    await expect(readFile(activePath, 'utf8')).resolves.toBe(activeReceipt)
  })

  it('serializes concurrent installers that share one user data directory', async () => {
    const fixture = await createInstallationFixture()
    let releaseInstaller: (() => void) | null = null
    const installerCanFinish = new Promise<void>((resolvePromise) => {
      releaseInstaller = resolvePromise
    })
    const runner = vi.fn(async (_installerPath: string, prefix: string) => {
      await installerCanFinish
      await writeLinuxRuntime(prefix)
    })
    const first = new ManagedRuntimeInstallation({
      ...fixture,
      platform: 'linux',
      runInstaller: runner
    })
    const second = new ManagedRuntimeInstallation({
      ...fixture,
      platform: 'linux',
      runInstaller: runner
    })

    const firstInstall = first.ensureInstalled()
    const secondInstall = second.ensureInstalled()
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1))
    releaseInstaller!()

    await expect(Promise.all([firstInstall, secondInstall])).resolves.toEqual([
      expect.objectContaining({ runtimeVersion: '0.11.3' }),
      expect.objectContaining({ runtimeVersion: '0.11.3' })
    ])
    expect(runner).toHaveBeenCalledTimes(1)
  })

  /**
   * 验收公开返回的 Supervisor 入口可直接运行；Constructor 生成的入口会固化安装前缀，
   * 因而安装完成后不能再把整个 Runtime 改名到另一个目录。
   */
  it('keeps Constructor entrypoints executable at the returned prefix', async () => {
    const fixture = await createInstallationFixture()
    const runner = vi.fn(async (_installerPath: string, prefix: string) => {
      await mkdir(join(prefix, 'bin'), { recursive: true })
      await writeFile(
        join(prefix, 'bin', 'python3.11'),
        '#!/bin/sh\nprintf "supervisor-ready\\n"\n'
      )
      await writeFile(
        join(prefix, 'bin', 'python'),
        '#!/bin/sh\nexec "$(dirname "$0")/python3.11" "$@"\n'
      )
      await writeFile(
        join(prefix, 'bin', 'unilab'),
        `#!/bin/sh\nexec "${prefix}/bin/python3.11" "$@"\n`
      )
      await writeFile(
        join(prefix, 'bin', 'unilab-supervisor'),
        `#!/bin/sh\nexec "${prefix}/bin/python3.11" "$@"\n`
      )
      await Promise.all([
        'python3.11',
        'python',
        'unilab',
        'unilab-supervisor'
      ].map((name) => chmod(join(prefix, 'bin', name), 0o755)))
    })
    const installation = new ManagedRuntimeInstallation({
      ...fixture,
      platform: 'linux',
      runInstaller: runner
    })

    const installed = await installation.ensureInstalled()

    await expect(execFileAsync(
      installed.supervisorExecutable,
      ['--version']
    )).resolves.toMatchObject({ stdout: 'supervisor-ready\n' })
  })

  /**
   * 回归 macOS userData 常见的 Application Support 空格路径；安装器参数必须原样传递，
   * 不能经过 shell 字符串拼接后被拆成多个目录。
   */
  it('installs and runs from a user data path containing spaces', async () => {
    const installer = Buffer.from([
      '#!/bin/sh',
      'set -eu',
      'prefix=""',
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = "-p" ]; then prefix="$2"; shift 2; else shift; fi',
      'done',
      'mkdir -p "$prefix/bin"',
      'for name in python unilab unilab-supervisor; do',
      '  printf \'#!/bin/sh\\nprintf "runtime-space-ready\\n"\\n\' > "$prefix/bin/$name"',
      '  chmod 755 "$prefix/bin/$name"',
      'done',
      ''
    ].join('\n'))
    const fixture = await createInstallationFixture(installer)
    const dataDirectory = join(fixture.dataDirectory, '..', 'Application Support')
    const installation = new ManagedRuntimeInstallation({
      resourcesDirectory: fixture.resourcesDirectory,
      dataDirectory,
      platform: 'linux',
      architecture: 'x64'
    })

    const installed = await installation.ensureInstalled()

    expect(installed.prefix).toContain('Application Support')
    await expect(execFileAsync(
      installed.supervisorExecutable,
      ['--version']
    )).resolves.toMatchObject({ stdout: 'runtime-space-ready\n' })
  })

  /**
   * 验收 Constructor 非零退出时，调用者能看到原始 stderr 摘要，并可从用户目录读取日志。
   */
  it('preserves Constructor diagnostics when installation fails', async () => {
    const fixture = await createInstallationFixture(Buffer.from(
      '#!/bin/sh\nprintf "模拟安装失败：目标目录不可写\\n" >&2\nexit 1\n'
    ))
    const installation = new ManagedRuntimeInstallation({
      ...fixture,
      platform: 'linux'
    })

    await expect(installation.ensureInstalled()).rejects.toThrow(
      /Runtime 安装器执行失败.*模拟安装失败：目标目录不可写.*日志：/
    )
    const logDirectory = join(
      fixture.dataDirectory,
      'managed-runtime',
      'logs'
    )
    const logFiles = await readdir(logDirectory)

    expect(logFiles).toHaveLength(1)
    await expect(readFile(
      join(logDirectory, logFiles[0]!),
      'utf8'
    )).resolves.toContain('模拟安装失败：目标目录不可写')
  })

  /**
   * 验收旧桌面端留下的 staging 绝对路径会被识别为损坏，并触发一次原地修复安装。
   */
  it('repairs a legacy Runtime whose entrypoint targets staging', async () => {
    const fixture = await createInstallationFixture()
    const bootstrapRunner = vi.fn(async (
      _installerPath: string,
      prefix: string
    ) => writeLinuxRuntime(prefix))
    const bootstrap = new ManagedRuntimeInstallation({
      ...fixture,
      platform: 'linux',
      runInstaller: bootstrapRunner
    })
    const legacy = await bootstrap.ensureInstalled()
    await writeFile(
      legacy.supervisorExecutable,
      '#!/bin/sh\nexec "/tmp/.runtime.installing-old/bin/python3.11" "$@"\n'
    )
    const repairRunner = vi.fn(async (
      _installerPath: string,
      prefix: string
    ) => {
      await mkdir(join(prefix, 'bin'), { recursive: true })
      await Promise.all([
        writeFile(
          join(prefix, 'bin', 'python'),
          '#!/bin/sh\nprintf "python-ready\\n"\n'
        ),
        writeFile(
          join(prefix, 'bin', 'unilab'),
          '#!/bin/sh\nprintf "unilab-ready\\n"\n'
        ),
        writeFile(
          join(prefix, 'bin', 'unilab-supervisor'),
          '#!/bin/sh\nprintf "supervisor-repaired\\n"\n'
        )
      ])
      await Promise.all([
        'python',
        'unilab',
        'unilab-supervisor'
      ].map((name) => chmod(join(prefix, 'bin', name), 0o755)))
    })
    const repair = new ManagedRuntimeInstallation({
      ...fixture,
      platform: 'linux',
      runInstaller: repairRunner
    })

    const installed = await repair.ensureInstalled()

    expect(repairRunner).toHaveBeenCalledTimes(1)
    await expect(execFileAsync(
      installed.supervisorExecutable,
      ['--version']
    )).resolves.toMatchObject({ stdout: 'supervisor-repaired\n' })
  })
})

/**
 * 创建最小 Runtime 安装资源与用户目录；installerBytes 是待校验并执行的载荷内容。
 */
async function createInstallationFixture(
  installerBytes = Buffer.from('offline-constructor-payload')
): Promise<{
  resourcesDirectory: string
  dataDirectory: string
  architecture: string
  verifyInstallation: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'unilab-managed-runtime-lock-'))
  temporaryDirectories.push(root)
  const resourcesDirectory = join(root, 'resources')
  const dataDirectory = join(root, 'data')
  const payloadDirectory = join(resourcesDirectory, 'runtime-installer')
  const installerName = 'Uni-Lab-OS-0.11.3-linux-64.sh'
  await mkdir(payloadDirectory, { recursive: true })
  await writeFile(join(payloadDirectory, installerName), installerBytes)
  await writeFile(join(payloadDirectory, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    runtimeVersion: '0.11.3',
    platform: 'linux-64',
    installerFile: installerName,
    sha256: createHash('sha256').update(installerBytes).digest('hex')
  }))
  return {
    resourcesDirectory,
    dataDirectory,
    architecture: 'x64',
    verifyInstallation: async () => undefined
  }
}

async function writeLinuxRuntime(prefix: string): Promise<void> {
  await mkdir(join(prefix, 'bin'), { recursive: true })
  const executables = ['python', 'unilab', 'unilab-supervisor'].map(
    (name) => join(prefix, 'bin', name)
  )
  await Promise.all(executables.map((path) => writeFile(path, '')))
  await Promise.all(executables.map((path) => chmod(path, 0o755)))
}
