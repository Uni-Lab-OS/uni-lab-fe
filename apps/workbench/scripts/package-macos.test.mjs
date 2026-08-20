import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import { removePackagedDesktopSelfLink } from '../../desktop/scripts/after-pack.mjs'
import {
  assertMacosSigningEnvironment,
  electronBuilderIdentityName,
  NODE_RUNTIME_SHA256,
  NODE_RUNTIME_SHA256_X64,
  NODE_RUNTIME_VERSION,
  notarizeInstaller,
  parseDeveloperIdIdentity
} from './package-macos.mjs'

describe('Workbench macOS distribution gate', () => {
  it('publishes the formal UniLab Workbench identity at version 0.1.0', async () => {
    const packageManifest = JSON.parse(await readFile(
      new URL('../package.json', import.meta.url),
      'utf8'
    ))
    const theiaManifest = JSON.parse(await readFile(
      new URL('../../../packages/workbench-theia/package.json', import.meta.url),
      'utf8'
    ))
    const builderConfiguration = await readFile(
      new URL('../electron-builder.yml', import.meta.url),
      'utf8'
    )
    const welcomeDocument = await readFile(
      new URL('../desktop/welcome.html', import.meta.url),
      'utf8'
    )
    const welcomeScript = await readFile(
      new URL('../desktop/welcome.js', import.meta.url),
      'utf8'
    )

    assert.equal(packageManifest.version, '0.1.0')
    assert.match(packageManifest.description, /UniLab 调试工作台/u)
    assert.equal(packageManifest.theia.frontend.config.defaultLocale, 'zh-cn')
    assert.match(
      packageManifest.theiaPlugins[
        'MS-CEINTL.vscode-language-pack-zh-hans'
      ],
      /vscode-language-pack-zh-hans\/1\.108\.0/u
    )
    assert.match(builderConfiguration, /^productName: UniLab Workbench$/mu)
    assert.match(builderConfiguration, /^appId: com\.bohrium\.unilab$/mu)
    assert.match(welcomeDocument, /<title>UniLab 调试工作台<\/title>/u)
    assert.match(welcomeDocument, /id="install-runtime"/u)
    assert.match(welcomeScript, /managedRuntime/u)
    assert.match(welcomeScript, /unilab -h/u)
    assert.equal(
      theiaManifest.theiaExtensions[0].frontendPreload,
      'lib/browser/unilab-workbench-frontend-preload-module'
    )
    assert.equal(
      theiaManifest.theiaExtensions[1].frontend,
      'lib/browser/unilab-workbench-frontend-module'
    )
    assert.doesNotMatch(JSON.stringify(theiaManifest), /prototype/iu)
  })

  it('never silently downgrades the formal release to unsigned', () => {
    assert.throws(
      () => assertMacosSigningEnvironment({}),
      /CSC_LINK.*APPLE_TEAM_ID/
    )
  })

  it('keeps the temporary ad-hoc acceptance build separate from formal release', async () => {
    const packageManifest = JSON.parse(await readFile(
      new URL('../package.json', import.meta.url),
      'utf8'
    ))

    assert.match(packageManifest.scripts['package:mac'], /--signed$/u)
    assert.match(packageManifest.scripts['package:mac:adhoc'], /--adhoc$/u)
    assert.doesNotMatch(packageManifest.scripts['package:mac:adhoc'], /--signed/u)
    assert.match(
      packageManifest.scripts['package:mac:developer-id'],
      /--developer-id$/u
    )
  })

  it('selects an imported Developer ID Application identity for the RC', () => {
    const identity = parseDeveloperIdIdentity(
      '  1) 626E4454304940747A59C50AD496ACDBDF5A0558 "Developer ID Application: Example Corp (TEAM123)"\n'
    )
    assert.equal(identity, 'Developer ID Application: Example Corp (TEAM123)')
    assert.equal(
      electronBuilderIdentityName(identity),
      'Example Corp (TEAM123)'
    )
    assert.throws(
      () => parseDeveloperIdIdentity('0 valid identities found'),
      /没有可用的 Developer ID Application/u
    )
  })

  it('binds Developer ID signing to an isolated keychain when provided', async () => {
    const packagingScript = await readFile(
      new URL('./package-macos.mjs', import.meta.url),
      'utf8'
    )

    assert.match(packagingScript, /process\.env\['CSC_KEYCHAIN'\]/u)
    assert.match(packagingScript, /\['--keychain', process\.env\['CSC_KEYCHAIN'\]\]/u)
  })

  it('labels the unsigned build as development-only', async () => {
    const packagingScript = await readFile(
      new URL('./package-macos.mjs', import.meta.url),
      'utf8'
    )

    assert.match(
      packagingScript,
      /\$\{version\}-unsigned-development-\$\{arch\}\.\$\{ext\}/u
    )
    assert.match(
      packagingScript,
      /if \(adhoc\) \{[^]*UNILAB_WORKBENCH_ADHOC_SIGN[^]*\} else \{[^]*unsigned-development/u
    )
  })

  it('removes the deploy-only broken desktop self-link before signing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'unilab-packaged-app-'))
    const link = path.join(
      root,
      'Contents',
      'Resources',
      'desktop',
      'node_modules',
      '.pnpm',
      'node_modules',
      '@unilab',
      'desktop'
    )
    try {
      await mkdir(path.dirname(link), { recursive: true })
      await symlink('/missing/deploy-only-workspace-package', link)

      await removePackagedDesktopSelfLink(root)

      await assert.rejects(lstat(link), error => error?.code === 'ENOENT')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts the complete electron-builder signing contract', () => {
    assert.doesNotThrow(() => assertMacosSigningEnvironment({
      CSC_LINK: '/secure/developer-id.p12',
      CSC_KEY_PASSWORD: 'redacted',
      APPLE_ID: 'release@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'redacted',
      APPLE_TEAM_ID: 'TEAM123'
    }))
  })

  it('submits and staples the DMG before validating its notarization ticket', () => {
    const calls = []
    notarizeInstaller('/tmp/UniLab Workbench.dmg', {
      APPLE_ID: 'release@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
      APPLE_TEAM_ID: 'TEAM123'
    }, (command, args) => calls.push([command, args]))

    assert.deepEqual(calls, [
      ['xcrun', [
        'notarytool',
        'submit',
        '/tmp/UniLab Workbench.dmg',
        '--apple-id',
        'release@example.com',
        '--password',
        'app-password',
        '--team-id',
        'TEAM123',
        '--wait'
      ]],
      ['xcrun', [
        'stapler',
        'staple',
        '/tmp/UniLab Workbench.dmg'
      ]]
    ])
  })

  it('pins the portable backend runtime and its supply-chain digest', () => {
    assert.equal(NODE_RUNTIME_VERSION, '24.14.0')
    assert.match(NODE_RUNTIME_SHA256, /^[a-f0-9]{64}$/u)
    assert.match(NODE_RUNTIME_SHA256_X64, /^[a-f0-9]{64}$/u)
  })

  it('defers copied runtime execution until installation acceptance', async () => {
    const packagingScript = await readFile(
      new URL('./package-macos.mjs', import.meta.url),
      'utf8'
    )

    assert.doesNotMatch(
      packagingScript,
      /spawnSync\(binaryPath, \['--version'\]/u
    )
    assert.doesNotMatch(packagingScript, /verify-packaged-backend\.mjs/u)
    assert.match(packagingScript, /verifyPackagedLauncher\(appPath\)/u)
    assert.match(packagingScript, /asar\.extractFile\(archive, 'desktop\/main\.cjs'\)/u)
  })

  it('ships the desktop Workspace welcome surface inside the application', async () => {
    const builderConfiguration = await readFile(
      new URL('../electron-builder.yml', import.meta.url),
      'utf8'
    )

    assert.match(builderConfiguration, /desktop\/welcome\.html/u)
    assert.match(builderConfiguration, /desktop\/welcome\.css/u)
    assert.match(builderConfiguration, /desktop\/welcome\.js/u)
    assert.match(builderConfiguration, /\.packaging\/runtime-installer/u)
    assert.match(builderConfiguration, /to: runtime-installer/u)
    assert.match(builderConfiguration, /to: default-workspace/u)
    assert.match(builderConfiguration, /\.packaging\/device-card-builder/u)
    assert.match(builderConfiguration, /to: agent-runtime/u)
    assert.match(builderConfiguration, /to: workspace-skills/u)
  })

  it('uses the packaged Agent runtime instead of requiring a separate AionUi install', async () => {
    const launcher = await readFile(
      new URL('../desktop/main.mjs', import.meta.url),
      'utf8'
    )
    const compatibility = JSON.parse(await readFile(
      new URL('../compatibility.json', import.meta.url),
      'utf8'
    ))

    assert.match(launcher, /resources\.agentRuntime/u)
    assert.doesNotMatch(launcher, /UNILAB_AIONUI_APP.*\/Applications\/AionUi\.app/u)
    assert.equal(compatibility.components.agentRuntime, 'aioncore@2.1.53')
    assert.equal(
      compatibility.contracts.agent,
      'bundled-managed-local-with-external-agent-clis'
    )
  })

  it('prefers the current bundled Runtime over a persisted older environment', async () => {
    const launcher = await readFile(
      new URL('../desktop/main.mjs', import.meta.url),
      'utf8'
    )
    const managedLookup = launcher.indexOf(
      "process.env['UNILAB_MANAGED_RUNTIME_PREFIX']"
    )
    const persistedLookup = launcher.indexOf(
      'if (persisted)',
      managedLookup
    )

    assert.ok(managedLookup >= 0)
    assert.ok(persistedLookup > managedLookup)
  })

  it('launch-smokes the packaged Electron app and checks the Agent archive through original-fs', async () => {
    const launcher = await readFile(
      new URL('../desktop/main.mjs', import.meta.url),
      'utf8'
    )
    const packagingScript = await readFile(
      new URL('./package-macos.mjs', import.meta.url),
      'utf8'
    )
    const launcherBuild = await readFile(
      new URL('./build-desktop-launcher.mjs', import.meta.url),
      'utf8'
    )

    assert.match(launcher, /from 'original-fs'/u)
    assert.match(launcher, /originalFsPromises\.access\(resources\.agentAsar\)/u)
    assert.match(launcher, /UNILAB_WORKBENCH_PACKAGE_SMOKE/u)
    assert.match(packagingScript, /verifyPackagedLauncher\(appPath\)/u)
    assert.match(packagingScript, /build-desktop-launcher\.mjs/u)
    assert.match(packagingScript, /verify-agent-runtime\.mjs/u)
    assert.match(packagingScript, /agentPayload\.executable/u)
    assert.doesNotMatch(packagingScript, /agentPayload\.sourceExecutable/u)
    assert.match(launcherBuild, /external: \['electron', 'original-fs'\]/u)
  })

  it('allows the build host to fill missing pnpm metadata while keeping the packaged app offline-capable', async () => {
    const packagingScript = await readFile(
      new URL('./package-macos.mjs', import.meta.url),
      'utf8'
    )

    assert.match(packagingScript, /'--prefer-offline'/u)
    assert.doesNotMatch(packagingScript, /\n\s*'--offline',?\n/u)
  })

  it('builds the current branch macOS test DMG without release access', async () => {
    const workflow = await readFile(
      new URL('../../../.github/workflows/package-macos.yml', import.meta.url),
      'utf8'
    )

    assert.match(
      workflow,
      /run-name: 生物领域包Workbench macOS测试/u
    )
    assert.match(workflow, /^  workflow_dispatch:$/mu)
    assert.match(
      workflow,
      /push:\s+branches:\s+- codex\/dev-model-runtime-validation-fix\s+paths:\s+- \.github\/workflows\/package-macos\.yml/u
    )
    assert.match(workflow, /permissions:\s+contents: read/u)
    assert.doesNotMatch(workflow, /contents: write/u)
    assert.match(workflow, /runs-on: macos-14/u)
    assert.match(workflow, /AIONUI_VERSION: 2\.1\.53/u)
    assert.match(
      workflow,
      /UNILAB_OS_SOURCE_REF: f329e4cf3e935d985299e572c5a4a5b476321e9b/u
    )
    assert.match(workflow, /package:mac/u)
    assert.match(workflow, /Verify macOS packaging safeguards/u)
    assert.match(
      workflow,
      /name: 生物领域包Workbench macOS测试/u
    )
    assert.match(workflow, /actions\/upload-artifact@v6/u)
    assert.doesNotMatch(
      workflow,
      /gh release|latest-mac\.yml|\.zip\.blockmap/u
    )
  })

  it('raises the macOS file descriptor limit before signing the packaged app', async () => {
    const workflow = await readFile(
      new URL('../../../.github/workflows/package-macos.yml', import.meta.url),
      'utf8'
    )

    assert.match(
      workflow,
      /Build signed and notarized macOS DMG[^]*?ulimit -S -n 65536[^]*?package:mac/u
    )
  })

  it('bounds macOS signing traversal under a low file descriptor limit', async () => {
    const requireFromTest = createRequire(import.meta.url)
    const electronBuilderEntry = requireFromTest.resolve('electron-builder')
    const osxSignEntry = createRequire(electronBuilderEntry).resolve(
      '@electron/osx-sign'
    )
    const probe = [
      "const Module = require('node:module')",
      'const originalLoad = Module._load',
      'const children = Array.from({ length: 96 }, (_, index) => `file-${index}`)',
      'let activeDescriptors = 0',
      'Module._load = function (request) {',
      "  if (request === 'fs-extra') return {",
      '    readdir: async () => children,',
      '    stat: async () => ({',
      '      isFile: () => true,',
      '      isDirectory: () => false,',
      '      isSymbolicLink: () => false',
      '    }),',
      '    remove: async () => undefined',
      '  }',
      "  if (request === 'isbinaryfile') return {",
      '    isBinaryFile: async () => {',
      '      activeDescriptors += 1',
      '      if (activeDescriptors > 64) {',
      "        const error = new Error('too many open files')",
      "        error.code = 'EMFILE'",
      '        throw error',
      '      }',
      '      await new Promise(resolve => setTimeout(resolve, 2))',
      '      activeDescriptors -= 1',
      '      return false',
      '    }',
      '  }',
      '  return originalLoad.apply(this, arguments)',
      '}',
      'const { walkAsync } = require(process.argv[1])',
      "walkAsync('/simulated-app/Contents')",
      "  .then(() => process.stdout.write('walk-ok\\n'))",
      '  .catch(error => { console.error(error); process.exitCode = 1 })'
    ].join('\n')
    const result = spawnSync(process.execPath, [
      '-e',
      probe,
      osxSignEntry
    ], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /walk-ok/u)
  })
})
