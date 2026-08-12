import assert from 'node:assert/strict'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { describe, it } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MAX_PORTABLE_INSTALLER_BYTES,
  PORTABLE_NODE_ARCHIVES,
  PORTABLE_NODE_VERSION,
  pruneDesktopDeployment,
  resolveEsbuildBinary
} from './package-portable.mjs'
import {
  MAX_PRODUCTION_LIB_BYTES,
  prepareProductionOutput,
  prepareWorkbenchProductionOutput
} from './prune-production-output.mjs'

describe('portable Workbench packaging contract', () => {
  /** 验证 portable 平台、Node 摘要与安装器体积预算保持固定。 */
  it('pins native Node runtimes for Linux and Windows', () => {
    assert.equal(PORTABLE_NODE_VERSION, '24.14.0')
    assert.deepEqual(Object.keys(PORTABLE_NODE_ARCHIVES), [
      'linux-64',
      'win-64'
    ])
    for (const descriptor of Object.values(PORTABLE_NODE_ARCHIVES)) {
      assert.match(descriptor.sha256, /^[a-f0-9]{64}$/u)
      assert.equal(descriptor.hostArchitecture, 'x64')
    }
    assert.equal(MAX_PORTABLE_INSTALLER_BYTES, 850 * 1024 * 1024)
  })

  it('extracts the Windows Node runtime without PowerShell argument binding', async () => {
    const packagingScript = await readFile(
      new URL('./package-portable.mjs', import.meta.url),
      'utf8'
    )

    assert.match(packagingScript, /runCommand\('tar\.exe', \[/u)
    assert.doesNotMatch(packagingScript, /Expand-Archive/u)
  })

  it('runs the Windows pnpm command through its command interpreter', async () => {
    const packagingScript = await readFile(
      new URL('./package-portable.mjs', import.meta.url),
      'utf8'
    )

    assert.match(
      packagingScript,
      /'pnpm\.cmd' : 'pnpm',[\s\S]*?\{ shell: process\.platform === 'win32' \}/u
    )
    assert.match(packagingScript, /shell: options\.shell \?\? false/u)
  })

  /** 验证独立 esbuild 二进制与设备卡构建器 API 使用同一声明版本。 */
  it('resolves the platform esbuild binary from the declared version', async () => {
    const packagingScript = await readFile(
      new URL('./package-portable.mjs', import.meta.url),
      'utf8'
    )

    assert.match(
      packagingScript,
      /const esbuildVersion = deviceCardBuilderManifest\.dependencies\?\.esbuild/u
    )
    assert.match(
      packagingScript,
      /`@esbuild\+\$\{descriptor\.esbuildPackage\}@\$\{esbuildVersion\}`/u
    )
    assert.match(
      packagingScript,
      /descriptor\.hostPlatform === 'win32' \? \[\] : \['bin'\]/u
    )
    assert.doesNotMatch(packagingScript, /esbuildPackage\}@0\.21\.5/u)

    const descriptor = Object.values(PORTABLE_NODE_ARCHIVES).find(candidate =>
      candidate.hostPlatform === process.platform
      && candidate.hostArchitecture === process.arch
    )
    if (descriptor) {
      const binary = resolveEsbuildBinary(descriptor)
      assert.match(binary, /@esbuild\+[^/]+@0\.21\.5/u)
    }
  })

  /** 验证桌面主进程只部署外置运行依赖，并将已编入产物的依赖留在构建期。 */
  it('keeps bundled desktop dependencies out of the production deployment', async () => {
    const desktopManifest = JSON.parse(await readFile(
      new URL('../../desktop/package.json', import.meta.url),
      'utf8'
    ))
    const deviceCardHostManifest = JSON.parse(await readFile(
      new URL('../../../packages/device-card-host/package.json', import.meta.url),
      'utf8'
    ))
    const desktopConfiguration = await readFile(
      new URL('../../desktop/electron.vite.config.ts', import.meta.url),
      'utf8'
    )
    const builderConfiguration = await readFile(
      new URL('../electron-builder.yml', import.meta.url),
      'utf8'
    )

    assert.deepEqual(Object.keys(desktopManifest.dependencies), [
      '@unilab/device-card-host',
      'electron-updater'
    ])
    assert.deepEqual(deviceCardHostManifest.dependencies, {
      esbuild: '0.21.5'
    })
    assert.deepEqual(deviceCardHostManifest.files, ['dist'])
    assert.match(
      deviceCardHostManifest.scripts.build,
      /node build\.mjs/u
    )
    for (const bundledDependency of [
      '@arizeai/phoenix-otel',
      '@unilab/local-environment'
    ]) {
      assert.equal(
        desktopManifest.devDependencies[bundledDependency],
        bundledDependency === '@arizeai/phoenix-otel' ? '2.1.0' : 'workspace:*'
      )
      assert.match(desktopConfiguration, new RegExp(bundledDependency, 'u'))
    }
    assert.match(builderConfiguration, /'!\*\*\/@esbuild\/\*\*'/u)
    assert.match(builderConfiguration, /'!\*\*\/esbuild\/bin\/\*\*'/u)
  })

  it('does not make portable packaging depend on pnpm metadata already being cached', async () => {
    const packagingScript = await readFile(
      new URL('./package-portable.mjs', import.meta.url),
      'utf8'
    )

    assert.match(packagingScript, /'--prefer-offline'/u)
    assert.doesNotMatch(packagingScript, /\n\s*'--offline',?\n/u)
  })

  /** 验证 Agent 仅携带 Workbench 实际读取的渲染器归档。 */
  it('packages a renderer-only Agent archive', async () => {
    const agentPackagingScript = await readFile(
      new URL('./agent-payload.mjs', import.meta.url),
      'utf8'
    )

    assert.match(
      agentPackagingScript,
      /createRendererOnlyAgentArchive\([\s\S]*?join\(destination, 'app\.asar'\)/u
    )
    assert.match(
      agentPackagingScript,
      /entry\.normalized === '\/package\.json'[\s\S]*?entry\.normalized\.startsWith\(AGENT_RENDERER_PREFIX\)/u
    )
    assert.match(agentPackagingScript, /entry\.replaceAll\('\\\\', '\/'\)/u)
    assert.match(agentPackagingScript, /archiveScope: 'renderer-only'/u)
    assert.match(
      agentPackagingScript,
      /MAX_AGENT_RENDERER_ARCHIVE_BYTES = 40 \* 1024 \* 1024/u
    )
  })

  /** 验证打包前切断工作区链接并删除桌面端不可达的构建文件。 */
  it('prunes the desktop deployment before electron-builder runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unilab-desktop-deploy-'))
    const source = join(root, 'desktop-source')
    const deployment = join(root, 'deployment')
    const selfLink = join(
      deployment,
      'node_modules',
      '.pnpm',
      'node_modules',
      '@unilab',
      'desktop'
    )
    try {
      await mkdir(source, { recursive: true })
      await mkdir(join(selfLink, '..'), { recursive: true })
      await mkdir(join(deployment, 'node_modules', '@esbuild', 'linux-x64'), {
        recursive: true
      })
      await mkdir(join(deployment, 'node_modules', 'esbuild', 'bin'), {
        recursive: true
      })
      await mkdir(join(deployment, 'node_modules', '.bin'), {
        recursive: true
      })
      await mkdir(join(
        deployment,
        'node_modules',
        '@vue',
        'compiler-sfc',
        'dist'
      ), { recursive: true })
      await writeFile(join(
        deployment,
        'node_modules',
        '@esbuild',
        'linux-x64',
        'esbuild'
      ), 'native-copy')
      await writeFile(join(
        deployment,
        'node_modules',
        'esbuild',
        'bin',
        'esbuild'
      ), 'native-launcher')
      await writeFile(join(
        deployment,
        'node_modules',
        '.bin',
        'esbuild.cmd'
      ), 'windows-launcher')
      await writeFile(join(
        deployment,
        'node_modules',
        '@vue',
        'compiler-sfc',
        'dist',
        'compiler-sfc.esm-browser.js'
      ), 'browser-only')
      await writeFile(join(
        deployment,
        'node_modules',
        '@vue',
        'compiler-sfc',
        'dist',
        'compiler-sfc.cjs.js'
      ), 'runtime')
      await writeFile(join(
        deployment,
        'node_modules',
        '@vue',
        'compiler-sfc',
        'dist',
        'compiler-sfc.d.ts'
      ), 'types')
      await symlink(
        source,
        selfLink,
        process.platform === 'win32' ? 'junction' : 'dir'
      )

      const metrics = pruneDesktopDeployment(deployment)
      assert.equal(metrics.removedSelfLink, true)
      assert.ok(metrics.removedFiles >= 1)
      assert.ok(metrics.removedBytes >= 5)
      await assert.rejects(lstat(selfLink), error => error?.code === 'ENOENT')
      for (const removed of [
        join(deployment, 'node_modules', '@esbuild'),
        join(deployment, 'node_modules', 'esbuild', 'bin'),
        join(deployment, 'node_modules', '.bin', 'esbuild.cmd'),
        join(
          deployment,
          'node_modules',
          '@vue',
          'compiler-sfc',
          'dist',
          'compiler-sfc.esm-browser.js'
        ),
        join(
          deployment,
          'node_modules',
          '@vue',
          'compiler-sfc',
          'dist',
          'compiler-sfc.d.ts'
        )
      ]) {
        await assert.rejects(lstat(removed), error => error?.code === 'ENOENT')
      }
      assert.equal(await readFile(join(
        deployment,
        'node_modules',
        '@vue',
        'compiler-sfc',
        'dist',
        'compiler-sfc.cjs.js'
      ), 'utf8'), 'runtime')

      const packagingScript = await readFile(
        new URL('./package-portable.mjs', import.meta.url),
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
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  /** 验证各平台安装包复用收敛后的生产构建与耗时可控的默认压缩。 */
  it('builds every installer from a bounded production Workbench bundle', async () => {
    const packageManifest = JSON.parse(await readFile(
      new URL('../package.json', import.meta.url),
      'utf8'
    ))
    const workspaceManifest = JSON.parse(await readFile(
      new URL('../../../package.json', import.meta.url),
      'utf8'
    ))
    const builderConfiguration = await readFile(
      new URL('../electron-builder.yml', import.meta.url),
      'utf8'
    )

    assert.match(
      packageManifest.scripts['build:production'],
      /theia build --mode production/u
    )
    assert.match(
      packageManifest.scripts['build:production'],
      /prune-production-output\.mjs/u
    )
    for (const name of [
      'package:mac',
      'package:mac:developer-id',
      'package:mac:adhoc',
      'package:mac:unsigned',
      'package:linux',
      'package:win'
    ]) {
      assert.match(
        packageManifest.scripts[name],
        /^pnpm build:desktop:production/u
      )
    }
    assert.match(builderConfiguration, /^compression: normal$/mu)
    assert.equal(
      packageManifest.optionalDependencies['@vscode/windows-ca-certs'],
      '0.3.4'
    )
    assert.equal(
      workspaceManifest.allowScripts['@vscode/windows-ca-certs@0.3.4'],
      true
    )
    assert.ok(workspaceManifest.pnpm.onlyBuiltDependencies.includes(
      '@vscode/windows-ca-certs'
    ))
    assert.match(
      builderConfiguration,
      /from: plugins[\s\S]*?filter:[\s\S]*?'!\*\*\/\*\.map'/u
    )
    assert.match(
      builderConfiguration,
      /from: \.packaging\/desktop-runtime\/node_modules[^]*?'!\*\*\/\*\.map'/u
    )
    assert.match(
      builderConfiguration,
      /from: \.packaging\/node-runtime[\s\S]*?to: node-runtime/u
    )
    assert.doesNotMatch(
      builderConfiguration,
      /from: \.packaging\/node-runtime\/bin\/node(?:\s|$)/u
    )
  })

  it('uses the optimized production shell for pnpm workbench:desktop', async () => {
    const rootManifest = JSON.parse(await readFile(
      new URL('../../../package.json', import.meta.url),
      'utf8'
    ))
    const workbenchManifest = JSON.parse(await readFile(
      new URL('../package.json', import.meta.url),
      'utf8'
    ))
    const desktopManifest = JSON.parse(await readFile(
      new URL('../../desktop/package.json', import.meta.url),
      'utf8'
    ))
    const desktopConfiguration = await readFile(
      new URL('../../desktop/electron.vite.config.ts', import.meta.url),
      'utf8'
    )
    const shellBuild = await readFile(
      new URL('../../desktop/scripts/build-workbench-shell.mjs', import.meta.url),
      'utf8'
    )
    const desktopWatch = await readFile(
      new URL('./dev-desktop.mjs', import.meta.url),
      'utf8'
    )

    assert.equal(
      rootManifest.scripts['workbench:desktop'],
      'pnpm --filter @unilab/workbench desktop'
    )
    assert.match(
      workbenchManifest.scripts['build:desktop'],
      /@unilab\/desktop build:workbench-shell/u
    )
    assert.match(
      workbenchManifest.scripts['build:desktop'],
      /pnpm build:production/u
    )
    assert.match(
      workbenchManifest.scripts['build:desktop:development'],
      /@unilab\/desktop build:workbench-shell && pnpm build/u
    )
    assert.match(
      workbenchManifest.scripts.desktop,
      /dev-desktop\.mjs --production-build$/u
    )
    assert.match(
      workbenchManifest.scripts['desktop:development'],
      /dev-desktop\.mjs$/u
    )
    assert.equal(
      desktopManifest.scripts['build:workbench-shell'],
      'node scripts/build-workbench-shell.mjs'
    )
    assert.match(desktopConfiguration, /mode === 'workbench-shell'/u)
    assert.match(shellBuild, /rm\(join\(outputDirectory, 'renderer'\)/u)
    assert.match(shellBuild, /ignoreConfigWarning: true/u)
    assert.match(
      desktopWatch,
      /const watchMode = productionBuild \? 'production' : 'development'/u
    )
    assert.match(desktopWatch, /'--mode',\s*watchMode/u)
    assert.match(desktopWatch, /await waitForOutput\(bundleWatcher/u)
    assert.match(
      desktopWatch,
      /\[watch\/browser\] Finished with 0 errors/u
    )
    assert.match(desktopWatch, /\[watch\/node\] Finished with 0 errors/u)
  })

  it('removes source maps and rejects an oversized production lib', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unilab-workbench-lib-'))
    try {
      await mkdir(join(root, 'frontend'), { recursive: true })
      await writeFile(join(root, 'frontend', 'bundle.js'), 'runtime')
      await writeFile(join(root, 'frontend', 'bundle.js.map'), 'debug-only')

      assert.deepEqual(await prepareProductionOutput(root), {
        removedBytes: 10,
        packagedBytes: 7
      })
      await assert.rejects(
        prepareProductionOutput(root, 6),
        /production lib 超出/u
      )
      assert.equal(MAX_PRODUCTION_LIB_BYTES, 90 * 1024 * 1024)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  /** 验证 Windows 原生流水线复用缓存、固定供应链输入并只上传安装器。 */
  it('builds the Windows installer on a native GitHub Actions runner', async () => {
    const workflow = await readFile(
      new URL('../../../.github/workflows/package-windows.yml', import.meta.url),
      'utf8'
    )

    assert.match(workflow, /runs-on: windows-2022/u)
    assert.match(workflow, /build\/Release\/crypt32\.node/u)
    assert.match(
      workflow,
      /UNILAB_RUNTIME_SOURCE_REF: b09c0c048f6de1e5027deb1733da439598c577cf/u
    )
    assert.match(workflow, /cache: pnpm/u)
    assert.match(workflow, /pnpm\/action-setup@v6/u)
    assert.match(workflow, /actions\/cache\/restore@v6/u)
    assert.match(workflow, /actions\/cache\/save@v6/u)
    assert.match(workflow, /cache-primary-key/u)
    assert.match(workflow, /windows-runtime-installer-v2-/u)
    assert.match(workflow, /dist\/constructor\/\*\.exe/u)
    const restoreRuntimeIndex = workflow.indexOf('name: Restore Windows Runtime')
    const checkoutRuntimeIndex = workflow.indexOf('name: Check out Uni-Lab OS')
    assert.ok(restoreRuntimeIndex >= 0)
    assert.ok(restoreRuntimeIndex < checkoutRuntimeIndex)
    assert.match(
      workflow.slice(checkoutRuntimeIndex, checkoutRuntimeIndex + 180),
      /if: steps\.runtime-cache\.outputs\.cache-hit != 'true'/u
    )
    assert.match(workflow, /windows-electron-builder-/u)
    assert.match(workflow, /MINIFORGE_VERSION: 26\.3\.2-3/u)
    assert.match(workflow, /AIONUI_WINDOWS_SHA512: [a-f0-9]{128}/u)
    assert.match(workflow, /Get-FileHash \$agentInstaller -Algorithm SHA512/u)
    assert.match(workflow, /Test-Path \.conda\/constructor\/construct\.yaml/u)
    assert.match(
      workflow,
      /conda run -n constructor-build constructor/u
    )
    assert.match(workflow, /pnpm --filter @unilab\/workbench package:win/u)
    assert.match(workflow, /UNILAB_RUNTIME_INSTALLER=/u)
    assert.match(workflow, /UNILAB_AGENT_DISTRIBUTION=/u)
    assert.match(workflow, /Filter 'aioncore\.exe'/u)
    assert.match(workflow, /Test-Path \(Join-Path \$_\.Directory\.FullName 'managed-resources'\)/u)
    assert.match(workflow, /bundled-aioncore\\windows-x64/u)
    assert.match(workflow, /release-windows\/\*-setup\.exe/u)
    assert.match(workflow, /release-windows\/\*-setup\.exe\.blockmap/u)
    assert.match(workflow, /release-windows\/latest\.yml/u)
    assert.match(workflow, /vars\.UNILAB_WORKBENCH_UPDATE_URL/u)
    assert.match(workflow, /actions\/upload-artifact@v6/u)
    assert.match(workflow, /compression-level: 0/u)

    const builderConfiguration = await readFile(
      new URL('../electron-builder.yml', import.meta.url),
      'utf8'
    )
    assert.match(builderConfiguration, /differentialPackage: true/u)
    assert.match(builderConfiguration, /packElevateHelper: true/u)
    assert.match(builderConfiguration, /^publish:\n  provider: generic$/mu)
    assert.match(builderConfiguration, /UNILAB_WORKBENCH_UPDATE_URL/u)
  })

  it('removes source maps from local Workbench plugins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unilab-workbench-output-'))
    try {
      await mkdir(join(root, 'lib'), { recursive: true })
      await mkdir(join(root, 'plugins', 'python'), { recursive: true })
      await writeFile(join(root, 'lib', 'bundle.js'), 'runtime')
      await writeFile(join(root, 'lib', 'bundle.js.map'), 'lib-debug')
      await writeFile(join(root, 'plugins', 'python', 'server.js'), 'plugin')
      await writeFile(
        join(root, 'plugins', 'python', 'server.js.map'),
        'plugin-debug'
      )

      assert.deepEqual(await prepareWorkbenchProductionOutput(root), {
        lib: { removedBytes: 9, packagedBytes: 7 },
        pluginMapsRemovedBytes: 12,
        pluginBytes: 6
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
