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
  parseDeveloperIdIdentity,
  selectMacosReleaseArtifacts
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
    assert.match(builderConfiguration, /target: dmg/u)
    assert.match(builderConfiguration, /target: zip/u)
    assert.match(welcomeDocument, /<title>UniLab 调试工作台<\/title>/u)
    assert.match(welcomeDocument, /id="install-runtime"/u)
    assert.match(welcomeDocument, /id="choose-runtime"/u)
    assert.match(welcomeScript, /managedRuntime/u)
    assert.match(welcomeScript, /chooseEnvironment/u)
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
      /CSC_LINK.*CSC_KEY_PASSWORD.*APPLE_ID.*APPLE_APP_SPECIFIC_PASSWORD.*APPLE_TEAM_ID/
    )
  })

  it('uses GitHub-safe macOS artifact names', async () => {
    const packagingScript = await readFile(
      new URL('./package-macos.mjs', import.meta.url),
      'utf8'
    )

    assert.match(
      packagingScript,
      /UniLab\.Workbench-\$\{version\}-\$\{arch\}\.\$\{ext\}/u
    )
    assert.match(
      packagingScript,
      /UniLab\.Workbench\.Test-\$\{version\}-\$\{arch\}\.\$\{ext\}/u
    )
    assert.match(
      packagingScript,
      /UniLab\.Workbench\.UpdateTest-\$\{version\}-\$\{arch\}\.\$\{ext\}/u
    )
    assert.match(packagingScript, /resolveWorkbenchReleaseChannel/u)
  })

  it('keeps ordinary tests DMG-only and retains isolated update media', () => {
    const artifacts = [
      'UniLab.Workbench-0.1.2-arm64.dmg',
      'UniLab.Workbench-0.1.2-arm64.zip',
      'UniLab.Workbench-0.1.2-arm64.zip.blockmap',
      'latest-mac.yml'
    ]
    assert.deepEqual(
      selectMacosReleaseArtifacts(artifacts, 'test'),
      [artifacts[0]]
    )
    assert.deepEqual(
      selectMacosReleaseArtifacts(artifacts, 'production'),
      artifacts
    )
    assert.deepEqual(
      selectMacosReleaseArtifacts(artifacts, 'update-test'),
      artifacts
    )
    assert.throws(
      () => selectMacosReleaseArtifacts([], 'test'),
      /1 个 DMG/u
    )
  })

  it('requires Developer ID signing and Apple notarization for formal DMGs', async () => {
    const packagingScript = await readFile(
      new URL('./package-macos.mjs', import.meta.url),
      'utf8'
    )
    const builderConfiguration = await readFile(
      new URL('../electron-builder.yml', import.meta.url),
      'utf8'
    )

    assert.match(builderConfiguration, /notarize: true/u)
    assert.match(builderConfiguration, /dmg:[^]*sign: true/u)
    assert.match(packagingScript, /notarizeAndStapleDiskImage\(installer\.path\)/u)
    assert.match(packagingScript, /verifySignedAndNotarized\(appPath, installer\.path\)/u)
    assert.match(packagingScript, /runCommand\('codesign'/u)
    assert.match(packagingScript, /'notarytool',\s*'submit'/u)
    assert.match(packagingScript, /'--wait'/u)
    assert.match(packagingScript, /'stapler', 'staple'/u)
    assert.match(packagingScript, /'stapler', 'validate'/u)
    assert.match(packagingScript, /runCommand\('spctl'/u)
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

  /** 验证测试通道只生成 DMG，生产通道保留热更新介质。 */
  it('separates full macOS update media from directory validation', async () => {
    const packagingScript = await readFile(
      new URL('./package-macos.mjs', import.meta.url),
      'utf8'
    )
    const desktopMain = await readFile(
      new URL('../../desktop/src/main/index.ts', import.meta.url),
      'utf8'
    )
    const desktopBuildConfig = await readFile(
      new URL('../../desktop/electron.vite.config.ts', import.meta.url),
      'utf8'
    )

    assert.match(packagingScript, /supportsWorkbenchUpdates\(releaseChannel\)/u)
    assert.match(packagingScript, /macOS Workbench 非压缩应用目录已通过校验/u)
    assert.match(packagingScript, /selectMacosUpdateArtifacts/u)
    assert.match(packagingScript, /requireWorkbenchUpdateUrl/u)
    assert.match(desktopMain, /enabled: shouldEnableWorkbenchUpdates\(/u)
    assert.match(desktopMain, /__UNILAB_WORKBENCH_RELEASE_CHANNEL__/u)
    assert.match(desktopBuildConfig, /UNILAB_WORKBENCH_RELEASE_CHANNEL/u)
    assert.match(desktopBuildConfig, /__UNILAB_WORKBENCH_RELEASE_CHANNEL__/u)
    assert.doesNotMatch(desktopMain, /process\.platform !== 'darwin'/u)
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
      APPLE_TEAM_ID: 'TEAM123456'
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
    assert.match(builderConfiguration, /desktop\/app-update-status\.css/u)
    assert.match(builderConfiguration, /desktop\/welcome\.js/u)
    assert.match(builderConfiguration, /\.packaging\/runtime-installer/u)
    assert.match(builderConfiguration, /to: runtime-installer/u)
    assert.match(builderConfiguration, /to: default-workspace/u)
    assert.match(builderConfiguration, /\.packaging\/device-card-builder/u)
    assert.match(builderConfiguration, /to: a\/app\.asar/u)
    assert.match(builderConfiguration, /to: a\/payload\.json/u)
    assert.match(builderConfiguration, /to: a\/c/u)
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
    assert.match(launcher, /UNILAB_AIONUI_VERSION/u)
    assert.match(launcher, /payload\.json/u)
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
    const pruneIndex = packagingScript.indexOf(
      'pruneDesktopDeployment(desktopRuntimeDirectory)'
    )
    const builderIndex = packagingScript.indexOf("'electron-builder'")
    assert.ok(deployIndex >= 0)
    assert.ok(deployIndex < pruneIndex)
    assert.ok(pruneIndex < builderIndex)
    assert.match(builderConfiguration, /^compression: normal$/mu)
    assert.match(builderConfiguration, /minimumSystemVersion: '13\.0'/u)
    assert.match(builderConfiguration, /^\s+format: ULFO$/mu)
    assert.match(builderConfiguration, /^\s+writeUpdateInfo: false$/mu)
  })

  /** 验证 macOS 工作流隔离生产、普通测试与热更新测试通道。 */
  it('builds and publishes the macOS arm64 bundle in GitHub Actions', async () => {
    const workflow = await readFile(
      new URL('../../../.github/workflows/package-macos.yml', import.meta.url),
      'utf8'
    )

    assert.match(workflow, /^name: Package macOS Workbench$/mu)
    assert.match(workflow, /^\s+runs-on: macos-14$/mu)
    assert.match(
      workflow,
      /branches:\n\s+- main\n\s+- deploy-mac-test\n\s+- deploy-hot-update-test/u
    )
    assert.doesNotMatch(workflow, /ci\/macos-packaging-benchmark/u)
    assert.doesNotMatch(workflow, /ci\/desktop-packaging-optimization-v2/u)
    assert.match(workflow, /options:\n\s+- full\n\s+- quick/u)
    assert.match(workflow, /UNILAB_CI_PACKAGE_MODE:/u)
    assert.match(workflow, /github\.event_name == 'push' && 'full'/u)
    assert.match(workflow, /UNILAB_CI_SIGNING_MODE:/u)
    assert.match(workflow, /refs\/heads\/deploy-mac-test/u)
    assert.match(workflow, /refs\/heads\/deploy-hot-update-test/u)
    assert.match(workflow, /UNILAB_WORKBENCH_RELEASE_CHANNEL:/u)
    assert.match(workflow, /'update-test' \|\| 'test'/u)
    assert.match(workflow, /^\s+contents: write$/mu)
    assert.match(workflow, /workbench-macos-hot-update-test/u)
    assert.match(workflow, /releases\/download\/\$\{\{/u)
    assert.match(workflow, /workbench-macos-stable/u)
    assert.match(workflow, /workbench-macos-hot-update-test/u)
    assert.match(
      workflow,
      /UNILAB_RUNTIME_SOURCE_REF: b09c0c048f6de1e5027deb1733da439598c577cf/u
    )
    assert.match(workflow, /AIONUI_VERSION: 2\.1\.53/u)
    assert.match(workflow, /AIONUI_MACOS_SHA512: [a-f0-9]{128}/u)
    assert.match(workflow, /ELECTRON_VERSION: 33\.4\.11/u)
    assert.match(workflow, /ELECTRON_BUILDER_VERSION: 25\.1\.8/u)
    assert.match(
      workflow,
      new RegExp(`NODE_RUNTIME_VERSION: ${NODE_RUNTIME_VERSION}`, 'u')
    )
    assert.match(workflow, /--platform osx-arm64/u)
    assert.match(workflow, /AionUi-\$AIONUI_VERSION-mac-arm64\.dmg/u)
    assert.match(workflow, /Restore prepared macOS Agent payload/u)
    assert.match(workflow, /aionui-prepared-macos-arm64-v2-/u)
    assert.match(workflow, /-node-\$\{\{ env\.NODE_RUNTIME_VERSION \}\}-/u)
    assert.match(workflow, /actions\/cache\/restore@v6/u)
    assert.match(workflow, /actions\/cache\/save@v6/u)
    assert.doesNotMatch(workflow, /cache: pnpm/u)
    assert.match(workflow, /macos-pnpm-store-v1-/u)
    assert.match(workflow, /restore-keys:/u)
    assert.match(workflow, /name: Save pnpm store/u)
    assert.match(workflow, /macos-electron-builder-v2-/u)
    assert.match(workflow, /macos-portable-node-v1-/u)
    assert.doesNotMatch(
      workflow,
      /aionui-prepared-macos-arm64-v2-[^\n]*package-macos\.mjs/u
    )
    assert.match(workflow, /\.ci-cache\/agent-payload/u)
    assert.match(workflow, /Cache pinned Theia plugins/u)
    assert.match(workflow, /apps\/workbench\/plugins/u)
    assert.match(
      workflow,
      /UNILAB_RUNTIME_INSTALLER=\$GITHUB_WORKSPACE\/\$runtime_source/u
    )
    const releaseRestoreIndex = workflow.indexOf(
      'name: Restore versioned macOS Runtime release'
    )
    const cacheRestoreIndex = workflow.indexOf(
      'name: Restore macOS Runtime cache'
    )
    const runtimeCheckoutIndex = workflow.indexOf('name: Check out Uni-Lab OS')
    assert.ok(releaseRestoreIndex >= 0)
    assert.ok(releaseRestoreIndex < cacheRestoreIndex)
    assert.ok(cacheRestoreIndex < runtimeCheckoutIndex)
    assert.match(
      workflow.slice(runtimeCheckoutIndex, runtimeCheckoutIndex + 240),
      /steps\.runtime-release\.outputs\.hit != 'true'.*steps\.runtime-cache\.outputs\.cache-hit != 'true'/su
    )
    assert.match(workflow, /build:desktop:production/u)
    assert.match(workflow, /package-macos\.mjs "--\$UNILAB_CI_SIGNING_MODE"/u)
    assert.match(workflow, /CSC_LINK: \$\{\{ secrets\.CSC_LINK \}\}/u)
    assert.match(workflow, /APPLE_ID: \$\{\{ secrets\.APPLE_ID \}\}/u)
    assert.match(workflow, /APPLE_APP_SPECIFIC_PASSWORD: \$\{\{ secrets\.APPLE_APP_SPECIFIC_PASSWORD \}\}/u)
    assert.match(workflow, /APPLE_TEAM_ID: \$\{\{ secrets\.APPLE_TEAM_ID \}\}/u)
    assert.match(workflow, /xcrun stapler validate/u)
    assert.match(workflow, /^\s+TZ: Asia\/Shanghai$/mu)
    assert.match(workflow, /BUILD_STARTED_AT_CST=/u)
    assert.match(workflow, /\$\{rawTimezoneOffset:0:3\}:\$\{rawTimezoneOffset:3:2\}/u)
    assert.match(workflow, /更新时间：\$\{BUILD_STARTED_AT_CST\}（UTC\+08:00）/u)
    assert.match(workflow, /prepare-package-version\.mjs/u)
    assert.match(
      workflow,
      /UNILAB_WORKBENCH_PACKAGE_MODE: \$\{\{ env\.UNILAB_CI_PACKAGE_MODE == 'quick' && 'directory' \|\| 'full' \}\}/u
    )
    assert.match(workflow, /name: Report quick macOS validation/u)
    assert.match(workflow, /macos-packaging-metrics\.json/u)
    assert.match(workflow, /hdiutil verify/u)
    assert.match(workflow, /compression-level: 0/u)
    assert.doesNotMatch(workflow, /name: Upload macOS packaging diagnostics/u)
    const unsignedUploadSection = workflow.slice(
      workflow.indexOf('name: Upload unsigned macOS DMG'),
      workflow.indexOf('name: Upload signed macOS DMG')
    )
    assert.match(unsignedUploadSection, /release-macos\/\*\.dmg/u)
    assert.doesNotMatch(unsignedUploadSection, /release-macos\/\*\.zip/u)
    assert.doesNotMatch(unsignedUploadSection, /latest-mac\.yml/u)
    assert.doesNotMatch(unsignedUploadSection, /macos-packaging-metrics\.json/u)
    assert.match(unsignedUploadSection, /retention-days: 7/u)

    const signedUploadSection = workflow.slice(
      workflow.indexOf('name: Upload signed macOS DMG'),
      workflow.indexOf('# Publish the signed app archives')
    )
    assert.match(signedUploadSection, /release-macos\/\*\.dmg/u)
    assert.match(signedUploadSection, /UNILAB_CI_SIGNING_MODE == 'signed'/u)
    assert.doesNotMatch(signedUploadSection, /github\.event_name != 'push'/u)
    assert.doesNotMatch(signedUploadSection, /release-macos\/\*\.zip/u)
    assert.doesNotMatch(signedUploadSection, /latest-mac\.yml/u)
    assert.match(signedUploadSection, /UNILAB_WORKBENCH_RELEASE_CHANNEL/u)
    assert.match(signedUploadSection, /github\.run_number/u)
    assert.doesNotMatch(signedUploadSection, /macos-packaging-metrics\.json/u)
    assert.match(signedUploadSection, /retention-days: 3/u)

    const publishSection = workflow.slice(
      workflow.indexOf('name: Publish rolling macOS update release')
    )
    assert.match(publishSection, /refs\/heads\/main/u)
    assert.match(publishSection, /refs\/heads\/deploy-hot-update-test/u)
    assert.match(publishSection, /UNILAB_WORKBENCH_RELEASE_CHANNEL != 'test'/u)
    assert.match(
      publishSection,
      /macOS release asset verification mismatch/u
    )
    const binaryUploadIndex = publishSection.indexOf(
      'gh release upload "$MACOS_RELEASE_TAG" \\'
    )
    const metadataUploadIndex = publishSection.indexOf(
      'gh release upload "$MACOS_RELEASE_TAG" "$metadata"'
    )
    assert.ok(binaryUploadIndex >= 0)
    assert.ok(metadataUploadIndex > binaryUploadIndex)
    assert.match(publishSection, /requires exactly one DMG, ZIP, ZIP blockmap and latest-mac\.yml/u)
    assert.match(publishSection, /zips=|blockmaps=|metadata=/u)
    assert.match(publishSection, /latest-mac\\\.yml/u)
    assert.doesNotMatch(publishSection, /gh release create/u)
    const bootstrapSection = workflow.slice(
      workflow.indexOf('name: Bootstrap isolated macOS hot-update release'),
      workflow.indexOf('name: Validate update publishing configuration')
    )
    assert.match(bootstrapSection, /refs\/heads\/deploy-hot-update-test/u)
    assert.match(bootstrapSection, /gh release create/u)
    assert.match(bootstrapSection, /--prerelease/u)
    assert.doesNotMatch(workflow, /git push/u)
  })
})
