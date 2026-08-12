import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
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
  parseDeveloperIdIdentity
} from './package-macos.mjs'

describe('Workbench macOS distribution gate', () => {
  it('publishes the formal UniLab Workbench identity at version 0.1.1', async () => {
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

    assert.equal(packageManifest.version, '0.1.1')
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
    assert.match(builderConfiguration, /^publish:\n  provider: generic$/mu)
    assert.match(builderConfiguration, /UNILAB_WORKBENCH_UPDATE_URL/u)
    assert.match(builderConfiguration, /target: zip/u)
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

  it('builds the ZIP and copies complete macOS updater metadata', async () => {
    const packagingScript = await readFile(
      new URL('./package-macos.mjs', import.meta.url),
      'utf8'
    )

    assert.match(packagingScript, /'--mac',\s*'dmg',\s*'zip'/u)
    assert.match(packagingScript, /selectMacosUpdateArtifacts/u)
    assert.match(packagingScript, /requireWorkbenchUpdateUrl/u)
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

  /** 验证 macOS 在打包前收敛生产依赖，并使用系统兼容的快速 DMG 压缩。 */
  it('bounds deployment copying and uses LZFSE DMG compression', async () => {
    const packagingScript = await readFile(
      new URL('./package-macos.mjs', import.meta.url),
      'utf8'
    )
    const builderConfiguration = await readFile(
      new URL('../electron-builder.yml', import.meta.url),
      'utf8'
    )

    assert.match(packagingScript, /'--config\.node-linker=hoisted'/u)
    const deployIndex = packagingScript.indexOf("'deploy'")
    const removalIndex = packagingScript.indexOf(
      'removeDesktopDeploymentSelfLink(desktopRuntimeDirectory)'
    )
    const builderIndex = packagingScript.indexOf("'electron-builder'")
    assert.ok(deployIndex >= 0)
    assert.ok(deployIndex < removalIndex)
    assert.ok(removalIndex < builderIndex)
    assert.match(builderConfiguration, /minimumSystemVersion: '13\.0'/u)
    assert.match(builderConfiguration, /^\s+format: ULFO$/mu)
    assert.match(builderConfiguration, /^\s+writeUpdateInfo: false$/mu)
  })

  /** 验证 macOS 基准工作流固定原生依赖并输出可比较的耗时与体积指标。 */
  it('benchmarks the complete macOS arm64 build in GitHub Actions', async () => {
    const workflow = await readFile(
      new URL('../../../.github/workflows/package-macos.yml', import.meta.url),
      'utf8'
    )

    assert.match(workflow, /^name: Benchmark macOS Workbench Packaging$/mu)
    assert.match(workflow, /^\s+runs-on: macos-14$/mu)
    assert.match(workflow, /ci\/macos-packaging-benchmark/u)
    assert.match(
      workflow,
      /UNILAB_RUNTIME_SOURCE_REF: b09c0c048f6de1e5027deb1733da439598c577cf/u
    )
    assert.match(workflow, /AIONUI_VERSION: 2\.1\.53/u)
    assert.match(workflow, /AIONUI_MACOS_SHA512: [a-f0-9]{128}/u)
    assert.match(workflow, /--platform osx-arm64/u)
    assert.match(workflow, /AionUi-\$AIONUI_VERSION-mac-arm64\.dmg/u)
    assert.match(workflow, /build:desktop:production/u)
    assert.match(workflow, /package-macos\.mjs --unsigned/u)
    assert.match(workflow, /macos-packaging-metrics\.json/u)
    assert.match(workflow, /hdiutil verify/u)
    assert.match(workflow, /compression-level: 0/u)
  })
})
