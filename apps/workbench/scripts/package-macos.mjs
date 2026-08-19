import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as asar from '@electron/asar'
import {
  prepareRuntimePayloadFromEnvironment,
  validatePackagedRuntimeResources
} from '../../desktop/scripts/runtime-payload.mjs'
import {
  prepareBundledAgentPayload,
  validateBundledAgentPayload
} from './agent-payload.mjs'
import {
  requireWorkbenchUpdateUrl,
  selectMacosUpdateArtifacts
} from './update-publish.mjs'
import { resolveWorkbenchPackageMode } from './packaging-mode.mjs'
import { pruneDesktopDeployment } from './package-portable.mjs'
import {
  createPackagedResourceReport,
  logPackagedResourceReport
} from './package-size-report.mjs'

const MEBIBYTE = 1024 * 1024
const MIN_INSTALLER_BYTES = 50 * MEBIBYTE
export const NODE_RUNTIME_VERSION = '24.14.0'
export const NODE_RUNTIME_SHA256 =
  'a1a54f46a750d2523d628d924aab61758a51c9dad3e0238beb14141be9615dd3'
export const NODE_RUNTIME_SHA256_X64 =
  'f2879eb810e25993a0578e5d878930266fd2eafcffe9f2839b3d8db354d4879e'
const REQUIRED_SIGNING_ENVIRONMENT = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID'
]

const workbenchDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDirectory = resolve(workbenchDirectory, '../..')
const releaseDirectory = join(workbenchDirectory, 'release-macos')
const packagingDirectory = join(workbenchDirectory, '.packaging')
const desktopRuntimeDirectory = join(packagingDirectory, 'desktop-runtime')
const nodeRuntimeDirectory = join(packagingDirectory, 'node-runtime')
const runtimePayloadDirectory = join(packagingDirectory, 'runtime-installer')
const agentPayloadDirectory = join(packagingDirectory, 'agent-runtime')
const deviceCardBuilderDirectory = join(
  packagingDirectory,
  'device-card-builder'
)

export function assertMacosSigningEnvironment(environment = process.env) {
  const missing = REQUIRED_SIGNING_ENVIRONMENT.filter(
    name => !environment[name]?.trim()
  )
  if (missing.length > 0) {
    throw new Error(
      `签名凭据不完整，缺少：${missing.join(', ')}。正式 package:mac 不会降级为 unsigned。`
    )
  }
}

export function parseDeveloperIdIdentity(output) {
  const match = output.match(
    /^\s*\d+\)\s+[a-f0-9]+\s+"(Developer ID Application:[^"]+)"/imu
  )
  if (!match) {
    throw new Error('钥匙串中没有可用的 Developer ID Application 签名身份。')
  }
  return match[1]
}

export function electronBuilderIdentityName(identity) {
  return identity.replace(/^Developer ID Application:\s*/u, '')
}

export function validateMacosInstaller(installerPath) {
  if (!existsSync(installerPath)) {
    throw new Error(`macOS 安装包不存在：${installerPath}`)
  }
  const size = statSync(installerPath).size
  if (size < MIN_INSTALLER_BYTES) {
    throw new Error(
      `macOS 安装包不完整：${basename(installerPath)} 仅 ${formatMebibytes(size)} MiB`
    )
  }
  const signature = Buffer.alloc(4)
  const descriptor = openSync(installerPath, 'r')
  try {
    readSync(descriptor, signature, 0, signature.length, size - 512)
  } finally {
    closeSync(descriptor)
  }
  if (signature.toString('ascii') !== 'koly') {
    throw new Error(`macOS 安装包缺少有效 UDIF 尾部：${installerPath}`)
  }
  return { path: installerPath, size }
}

/**
 * 校验 macOS Workbench 成品包含所有外置运行资源。
 * @param {string} outputDirectory electron-builder 的输出目录。
 * @param {string} targetArchitecture 目标 CPU 架构。
 * @returns {string} 校验通过的应用程序路径。
 * @throws {Error} 任一必需运行资源缺失时抛出。
 */
export function validatePackagedWorkbench(
  outputDirectory,
  targetArchitecture = process.arch
) {
  const appPath = findPackagedApplication(outputDirectory)
  const resources = join(appPath, 'Contents', 'Resources')
  const required = [
    join(resources, 'app.asar'),
    join(resources, 'workbench', 'lib', 'backend', 'main.js'),
    join(resources, 'workbench', 'package.json'),
    join(resources, 'workbench', 'lib', 'frontend', 'index.html'),
    join(resources, 'workbench', 'lib', 'backend', 'native', 'watcher.node'),
    join(
      resources,
      'workbench',
      'lib',
      'prebuilds',
      `darwin-${targetArchitecture}`,
      'pty.node'
    ),
    join(resources, 'workbench', 'plugins'),
    join(resources, 'node-runtime', 'bin', 'node'),
    join(resources, 'desktop', 'out', 'main', 'index.js'),
    join(resources, 'desktop', 'out', 'preload', 'index.js'),
    join(
      resources,
      'desktop',
      'node_modules',
      '@unilab',
      'device-card-host',
      'dist',
      'index.cjs'
    ),
    join(resources, 'device-card-builder', 'esbuild'),
    join(resources, 'device-card-agent', 'cli.mjs'),
    join(resources, 'workspace-skills', 'manifest.json'),
    join(resources, 'workspace-skills', 'add-device', 'SKILL.md'),
    join(resources, 'workspace-skills', 'add-resource', 'SKILL.md'),
    join(resources, 'workspace-skills', 'add-workstation', 'SKILL.md'),
    join(resources, 'workspace-skills', 'create-device-package', 'SKILL.md'),
    join(resources, 'workspace-skills', 'create-device-skill', 'SKILL.md'),
    join(
      resources,
      'workspace-skills',
      'unilab-domain-repo-builder',
      'SKILL.md'
    ),
    join(resources, 'compatibility.json')
  ]
  const missing = required.filter(entry => !existsSync(entry))
  if (missing.length > 0) {
    throw new Error(`Workbench 安装包缺少运行资源：${missing.join(', ')}`)
  }
  return appPath
}

/**
 * 在当前 macOS 主机上组装、签名并验证 Workbench 的 DMG 发布介质。
 * @param {{signed: boolean, adhoc?: boolean, developerId?: boolean}} options 签名与验收模式。
 * @returns {{mode: string, applicationDirectory: string, releaseDirectory?: string}} 已校验的应用目录与可选发布目录。
 * @throws {Error} 主机不受支持、签名材料缺失或任一发布合同校验失败时抛出。
 */
export function packageMacos({ signed, adhoc = false, developerId = false }) {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
    throw new Error(`macOS Workbench 不支持当前主机：${process.platform}/${process.arch}`)
  }
  const targetArchitecture = process.arch
  const targetPlatform = targetArchitecture === 'arm64'
    ? 'osx-arm64'
    : 'osx-64'
  const esbuildPackage = `darwin-${targetArchitecture}`
  const esbuildBinary = join(
    repositoryDirectory,
    'node_modules',
    '.pnpm',
    `@esbuild+${esbuildPackage}@0.21.5`,
    'node_modules',
    '@esbuild',
    esbuildPackage,
    'bin',
    'esbuild'
  )
  if ([signed, adhoc, developerId].filter(Boolean).length > 1) {
    throw new Error('正式签名、Developer ID RC 与 ad-hoc 临时签名不能同时启用。')
  }
  if (signed) assertMacosSigningEnvironment()
  const packageMode = resolveWorkbenchPackageMode(
    process.env['UNILAB_WORKBENCH_PACKAGE_MODE']
  )
  if (packageMode === 'prepackaged') {
    throw new Error('macOS 暂不支持从预构建应用目录生成发布介质。')
  }
  const updateUrl = requireWorkbenchUpdateUrl()
  const developerIdIdentity = developerId
    ? findDeveloperIdIdentity()
    : undefined

  const outputDirectory = mkdtempSync(join(tmpdir(), 'unilab-workbench-macos-'))
  rmSync(packagingDirectory, { recursive: true, force: true })
  mkdirSync(packagingDirectory, { recursive: true })
  try {
    runCommand(process.execPath, [
      join(workbenchDirectory, 'scripts', 'build-desktop-launcher.mjs')
    ], workbenchDirectory)
    copyFileSync(
      join(workbenchDirectory, 'package.json'),
      join(packagingDirectory, 'workbench-package.json')
    )
    prepareRuntimePayloadFromEnvironment(
      runtimePayloadDirectory,
      targetPlatform
    )
    preparePinnedNodeRuntime(targetArchitecture)
    const sharedNodeExecutable = join(nodeRuntimeDirectory, 'bin', 'node')
    process.env['UNILAB_AGENT_NODE_BINARY'] = sharedNodeExecutable
    const agentPayload = prepareBundledAgentPayload(agentPayloadDirectory, {
      sourcePath: process.env['UNILAB_AGENT_DISTRIBUTION'],
      platform: 'darwin',
      architecture: targetArchitecture,
      sharedNodeExecutable,
      sharedNodeVersion: NODE_RUNTIME_VERSION
    })
    runCommand(process.execPath, [
      fileURLToPath(new URL('./verify-agent-runtime.mjs', import.meta.url)),
      '--resources',
      agentPayloadDirectory,
      '--executable',
      agentPayload.executable,
      '--platform',
      'darwin',
      '--architecture',
      targetArchitecture
    ])
    mkdirSync(deviceCardBuilderDirectory, { recursive: true })
    copyFileSync(esbuildBinary, join(deviceCardBuilderDirectory, 'esbuild'))
    chmodSync(join(deviceCardBuilderDirectory, 'esbuild'), 0o755)
    runCommand('pnpm', [
      '--config.node-linker=hoisted',
      '--filter',
      '@unilab/desktop',
      'deploy',
      '--prod',
      '--legacy',
      '--prefer-offline',
      desktopRuntimeDirectory
    ], repositoryDirectory)
    const desktopMetrics = pruneDesktopDeployment(desktopRuntimeDirectory)
    console.log(
      `桌面端生产依赖已收敛：删除 ${desktopMetrics.removedFiles} 个构建文件，${desktopMetrics.removedBytes} bytes`
    )

    const builderArgs = [
      '--mac',
      ...(packageMode === 'directory' ? ['--dir'] : ['dmg', 'zip']),
      `--${targetArchitecture}`,
      '--publish',
      'never',
      `--config.directories.output=${outputDirectory}`
    ]
    const builderEnvironment = {
      ...process.env,
      UNILAB_WORKBENCH_UPDATE_URL: updateUrl
    }
    if (signed) {
      // GitHub Release 会把资产名中的空格规范化为点号，正式 DMG/ZIP
      // 从源头使用安全名称，确保 latest-mac.yml 指向真实发布资产。
      builderArgs.push(
        '--config.mac.artifactName=UniLab.Workbench-${version}-${arch}.${ext}',
        '--config.dmg.artifactName=UniLab.Workbench-${version}-${arch}.${ext}'
      )
    }
    if (!signed && !developerId) {
      builderEnvironment['CSC_IDENTITY_AUTO_DISCOVERY'] = 'false'
      builderArgs.push(
        '--config.mac.identity=null',
        '--config.mac.notarize=false'
      )
      if (adhoc) {
        builderEnvironment['UNILAB_WORKBENCH_ADHOC_SIGN'] = '1'
        builderArgs.push(
          '--config.mac.artifactName=${productName}-${version}-rc-adhoc-${arch}.${ext}',
          '--config.dmg.artifactName=${productName}-${version}-rc-adhoc-${arch}.${ext}'
        )
      } else {
        builderArgs.push(
          '--config.mac.artifactName=${productName}-${version}-unsigned-development-${arch}.${ext}',
          '--config.dmg.artifactName=${productName}-${version}-unsigned-development-${arch}.${ext}'
        )
      }
    }
    if (developerId) {
      builderEnvironment['CSC_NAME'] = electronBuilderIdentityName(
        developerIdIdentity
      )
      builderArgs.push(
        '--config.mac.notarize=false',
        '--config.mac.artifactName=${productName}-${version}-rc-developer-id-${arch}.${ext}',
        '--config.dmg.artifactName=${productName}-${version}-rc-developer-id-${arch}.${ext}'
      )
    }
    runCommand(
      process.execPath,
      [
        join(
          workbenchDirectory,
          'node_modules',
          'electron-builder',
          'out',
          'cli',
          'cli.js'
        ),
        ...builderArgs
      ],
      workbenchDirectory,
      builderEnvironment
    )

    const appPath = validatePackagedWorkbench(
      outputDirectory,
      targetArchitecture
    )
    validatePackagedRuntimeResources(
      join(appPath, 'Contents', 'Resources'),
      targetPlatform
    )
    validateBundledAgentPayload(
      join(appPath, 'Contents', 'Resources'),
      'darwin',
      targetArchitecture
    )
    const resourceReport = createPackagedResourceReport(
      join(appPath, 'Contents', 'Resources')
    )
    logPackagedResourceReport(resourceReport)
    verifyPackagedLauncher(appPath)
    if (packageMode === 'directory') {
      console.log(`macOS Workbench 非压缩应用目录已通过校验：${appPath}`)
      return { mode: packageMode, applicationDirectory: appPath }
    }
    let installer = findInstaller(outputDirectory)
    if (signed) {
      notarizeAndStapleDiskImage(installer.path)
      installer = findInstaller(outputDirectory)
      verifySignedAndNotarized(appPath, installer.path)
    }
    if (developerId) {
      installer = signAndVerifyDeveloperIdCandidate(
        appPath,
        installer.path,
        developerIdIdentity
      )
    }
    if (adhoc) installer = signAndVerifyAdHocCandidate(installer.path)
    publishMacosArtifacts(outputDirectory)
    const distribution = signed
      ? 'Developer ID signed and Apple notarized'
      : developerId
        ? 'RC Developer ID signed (not notarized)'
        : adhoc ? 'RC ad-hoc signed' : 'unsigned'
    console.log(
      `macOS ${distribution} 安装包已发布：${join(releaseDirectory, basename(installer.path))}（${formatMebibytes(installer.size)} MiB）`
    )
    return {
      mode: packageMode,
      applicationDirectory: appPath,
      releaseDirectory
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
    rmSync(packagingDirectory, { recursive: true, force: true })
  }
}

export function verifyPackagedLauncher(appPath) {
  const archive = join(
    appPath,
    'Contents',
    'Resources',
    'app.asar'
  )
  const launcher = asar.extractFile(archive, 'desktop/main.cjs').toString('utf8')
  const requiredMarkers = [
    'require("original-fs")',
    'UNILAB_WORKBENCH_PACKAGE_SMOKE_OK'
  ]
  const missing = requiredMarkers.filter(marker => !launcher.includes(marker))
  if (missing.length > 0) {
    throw new Error(
      `打包 Electron launcher 不是最新构建，缺少：${missing.join(', ')}`
    )
  }
  console.log('打包 Electron launcher bundle smoke 通过')
}

function preparePinnedNodeRuntime(targetArchitecture) {
  const archiveName =
    `node-v${NODE_RUNTIME_VERSION}-darwin-${targetArchitecture}.tar.gz`
  const expectedSha256 = targetArchitecture === 'arm64'
    ? NODE_RUNTIME_SHA256
    : NODE_RUNTIME_SHA256_X64
  const cacheDirectory = join(
    homedir(),
    'Library',
    'Caches',
    'UniLab Workbench',
    'downloads'
  )
  const archivePath = join(cacheDirectory, archiveName)
  mkdirSync(cacheDirectory, { recursive: true })
  if (!hasExpectedSha256(archivePath, expectedSha256)) {
    rmSync(archivePath, { force: true })
    runCommand('curl', [
      '-fL',
      '--retry',
      '3',
      `https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/${archiveName}`,
      '-o',
      archivePath
    ])
  }
  if (!hasExpectedSha256(archivePath, expectedSha256)) {
    throw new Error(`Node ${NODE_RUNTIME_VERSION} runtime SHA-256 校验失败。`)
  }

  const binaryDirectory = join(nodeRuntimeDirectory, 'bin')
  mkdirSync(binaryDirectory, { recursive: true })
  runCommand('tar', [
    '-xzf',
    archivePath,
    '-C',
    binaryDirectory,
    '--strip-components=2',
    `node-v${NODE_RUNTIME_VERSION}-darwin-${targetArchitecture}/bin/node`
  ])
}

function hasExpectedSha256(filePath, expected) {
  if (!existsSync(filePath)) return false
  const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex')
  return actual === expected
}

function findPackagedApplication(outputDirectory) {
  for (const directory of readdirSync(outputDirectory, { withFileTypes: true })) {
    if (!directory.isDirectory() || !directory.name.startsWith('mac')) continue
    const app = readdirSync(join(outputDirectory, directory.name), {
      withFileTypes: true
    }).find(entry => entry.isDirectory() && entry.name.endsWith('.app'))
    if (app) return join(outputDirectory, directory.name, app.name)
  }
  throw new Error(`macOS .app 不存在：${outputDirectory}`)
}

function findInstaller(outputDirectory) {
  const installers = readdirSync(outputDirectory)
    .filter(name => name.endsWith('.dmg'))
    .map(name => join(outputDirectory, name))
  if (installers.length !== 1) {
    throw new Error(`预期 1 个 DMG，实际 ${installers.length} 个。`)
  }
  return validateMacosInstaller(installers[0])
}

function publishMacosArtifacts(outputDirectory) {
  const names = selectMacosUpdateArtifacts(readdirSync(outputDirectory))
  rmSync(releaseDirectory, { recursive: true, force: true })
  mkdirSync(releaseDirectory, { recursive: true })
  for (const name of names) {
    copyFileSync(join(outputDirectory, name), join(releaseDirectory, name))
  }
}

function notarizeAndStapleDiskImage(installerPath) {
  runCommand('xcrun', [
    'notarytool',
    'submit',
    installerPath,
    '--apple-id',
    process.env['APPLE_ID'],
    '--password',
    process.env['APPLE_APP_SPECIFIC_PASSWORD'],
    '--team-id',
    process.env['APPLE_TEAM_ID'],
    '--wait'
  ])
  runCommand('xcrun', ['stapler', 'staple', installerPath])
}

function verifySignedAndNotarized(appPath, installerPath) {
  runCommand('codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    appPath
  ])
  runCommand('spctl', [
    '--assess',
    '--type',
    'execute',
    '--verbose=2',
    appPath
  ])
  runCommand('xcrun', ['stapler', 'validate', appPath])
  runCommand('xcrun', ['stapler', 'validate', installerPath])
  runCommand('spctl', [
    '--assess',
    '--type',
    'open',
    '--context',
    'context:primary-signature',
    '--verbose=2',
    installerPath
  ])
}

function findDeveloperIdIdentity() {
  const args = ['find-identity', '-v', '-p', 'codesigning']
  if (process.env['CSC_KEYCHAIN']) {
    args.push(process.env['CSC_KEYCHAIN'])
  }
  const result = spawnSync(
    'security',
    args,
    { encoding: 'utf8' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`security find-identity 执行失败，退出码 ${result.status}`)
  }
  return parseDeveloperIdIdentity(result.stdout)
}

function signAndVerifyDeveloperIdCandidate(
  appPath,
  installerPath,
  identity
) {
  const keychainArgs = process.env['CSC_KEYCHAIN']
    ? ['--keychain', process.env['CSC_KEYCHAIN']]
    : []
  runCommand('codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    appPath
  ])
  runCommand('codesign', [
    '--force',
    '--sign',
    identity,
    ...keychainArgs,
    '--timestamp',
    installerPath
  ])
  runCommand('codesign', ['--verify', '--verbose=2', installerPath])
  runCommand('hdiutil', ['verify', installerPath])
  return validateMacosInstaller(installerPath)
}

function signAndVerifyAdHocCandidate(installerPath) {
  runCommand('codesign', ['--force', '--sign', '-', '--timestamp=none', installerPath])
  runCommand('codesign', ['--verify', '--verbose=2', installerPath])
  runCommand('hdiutil', ['verify', installerPath])
  const mountPoint = realpathSync(
    mkdtempSync(join(tmpdir(), 'unilab-workbench-adhoc-mount-'))
  )
  const verificationDirectory = realpathSync(
    mkdtempSync(join(tmpdir(), 'unilab-workbench-adhoc-verify-'))
  )
  try {
    runCommand('hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      mountPoint,
      installerPath
    ])
    const app = readdirSync(mountPoint, { withFileTypes: true })
      .find(entry => entry.isDirectory() && entry.name.endsWith('.app'))
    if (!app) throw new Error('ad-hoc DMG 内缺少 Workbench .app。')
    const mountedApplication = realpathSync(join(mountPoint, app.name))
    const copiedApplication = join(verificationDirectory, app.name)
    runCommand('ditto', [mountedApplication, copiedApplication])
    runCommand('codesign', [
      '--display',
      '--verbose=4',
      copiedApplication
    ])
  } finally {
    spawnSync('hdiutil', ['detach', mountPoint, '-force'], { stdio: 'inherit' })
    rmSync(mountPoint, { recursive: true, force: true })
    rmSync(verificationDirectory, { recursive: true, force: true })
  }
  return validateMacosInstaller(installerPath)
}

function runCommand(command, args, cwd = workbenchDirectory, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${basename(command)} 执行失败，退出码 ${result.status}`)
  }
}

function formatMebibytes(bytes) {
  return (bytes / MEBIBYTE).toFixed(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (!['--signed', '--developer-id', '--adhoc', '--unsigned'].includes(mode)) {
    console.error(
      '用法：package-macos.mjs --signed|--developer-id|--adhoc|--unsigned'
    )
    process.exitCode = 1
  } else {
    try {
      packageMacos({
        signed: mode === '--signed',
        developerId: mode === '--developer-id',
        adhoc: mode === '--adhoc'
      })
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}
