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
import { dirname, join } from 'node:path'

import {
  assertSafeChildDirectory,
  createWindowsInstallerAuditArguments,
  MAX_PORTABLE_INSTALLER_BYTES,
  PORTABLE_COMPRESSION_LEVELS,
  PORTABLE_NODE_ARCHIVES,
  PORTABLE_NODE_VERSION,
  pruneDesktopDeployment,
  resolveElectronBuilderSevenZipCommand,
  resolveEsbuildBinary,
  resolvePortableCompressionLevel,
  validatePackagedWorkbenchResources,
  validateWindowsInstallerListing
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
    assert.equal(MAX_PORTABLE_INSTALLER_BYTES, 800 * 1024 * 1024)
  })

  /** 验证成品复用宿主内联的 Vue 编译器，不要求部署第二份编译器。 */
  it('accepts the bundled Device Card Host without a duplicate Vue compiler', async () => {
    const resources = await mkdtemp(join(tmpdir(), 'unilab-resources-'))
    const requiredFiles = [
      'app.asar',
      'workbench/lib/backend/main.js',
      'workbench/lib/frontend/index.html',
      'node-runtime/bin/node',
      'desktop/out/main/index.js',
      'desktop/out/preload/index.js',
      'desktop/node_modules/@unilab/device-card-host/dist/index.cjs',
      `device-card-builder/${process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'}`,
      'device-card-agent/cli.mjs',
      'workspace-skills/manifest.json',
      'workspace-skills/add-device/SKILL.md',
      'workspace-skills/add-resource/SKILL.md',
      'workspace-skills/add-workstation/SKILL.md',
      'workspace-skills/create-device-package/SKILL.md',
      'workspace-skills/create-device-skill/SKILL.md',
      'workspace-skills/unilab-domain-repo-builder/SKILL.md'
    ]
    try {
      await mkdir(join(resources, 'workbench', 'plugins'), { recursive: true })
      for (const relativePath of requiredFiles) {
        const path = join(resources, relativePath)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, 'fixture')
      }

      assert.doesNotThrow(() => {
        validatePackagedWorkbenchResources(resources, 'node')
      })
    } finally {
      await rm(resources, { recursive: true, force: true })
    }
  })

  /** 验证正式包默认使用 normal，并允许 CI 在同一提交上显式测量 maximum。 */
  it('accepts only benchmarked portable compression levels', () => {
    assert.deepEqual(PORTABLE_COMPRESSION_LEVELS, ['normal', 'maximum'])
    assert.equal(resolvePortableCompressionLevel(undefined), 'normal')
    assert.equal(resolvePortableCompressionLevel(' normal '), 'normal')
    assert.equal(resolvePortableCompressionLevel('maximum'), 'maximum')
    assert.throws(
      () => resolvePortableCompressionLevel('store'),
      /不支持的 Workbench 压缩级别/u
    )
  })

  /** 验证 Windows A/B 能复用同一应用目录，并只切换已压缩资源配置。 */
  it('supports directory and prepackaged Windows media modes', async () => {
    const packagingScript = await readFile(
      new URL('./package-portable.mjs', import.meta.url),
      'utf8'
    )

    assert.match(packagingScript, /packageMode === 'directory'/u)
    assert.match(packagingScript, /builderArgs\.push\('--prepackaged'/u)
    assert.match(
      packagingScript,
      /--config\.nsis\.preCompressedFileExtensions=/u
    )
    assert.match(
      packagingScript,
      /--config\.win\.artifactName=UniLab\.Workbench\.Test-/u
    )
    assert.match(packagingScript, /resolveWorkbenchReleaseChannel/u)
    assert.match(packagingScript, /allowsOversizePackagingBenchmark\(\)/u)
  })

  /** 验证可递归清理的覆盖目录不能逃逸专用暂存范围。 */
  it('confines reusable packaging output to a dedicated staging root', () => {
    const stagingRoot = join(tmpdir(), 'unilab-packaging-staging')
    const child = join(stagingRoot, 'windows')
    assert.equal(assertSafeChildDirectory(child, stagingRoot, '测试目录'), child)
    assert.throws(
      () => assertSafeChildDirectory(stagingRoot, stagingRoot, '测试目录'),
      /必须位于专用目录/u
    )
    assert.throws(
      () => assertSafeChildDirectory(tmpdir(), stagingRoot, '测试目录'),
      /必须位于专用目录/u
    )
  })

  /** 验证最终 NSIS 技术清单只查询并必须包含安装根目录的桌面主程序。 */
  it('rejects a Windows installer without its desktop executable', () => {
    assert.match(
      resolveElectronBuilderSevenZipCommand(),
      /[/\\]7za(?:\.exe)?$/u
    )
    assert.deepEqual(createWindowsInstallerAuditArguments('setup.exe'), [
      'l',
      '-slt',
      'setup.exe',
      'UniLab Workbench.exe'
    ])
    assert.doesNotThrow(() => validateWindowsInstallerListing([
      'Path = resources',
      'Path = UniLab Workbench.exe'
    ].join('\r\n')))
    assert.throws(
      () => validateWindowsInstallerListing([
        'Path = C:\\build\\UniLab.Workbench-setup.exe',
        'Type = Nsis',
        'Path = resources\\app.asar'
      ].join('\r\n')),
      /Windows 安装包缺少桌面主程序/u
    )
    assert.throws(
      () => validateWindowsInstallerListing(
        'Path = resources\\UniLab Workbench.exe'
      ),
      /Windows 安装包缺少桌面主程序/u
    )
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

  /** 验证成品复用宿主内联的 Vue 编译器，不要求部署第二份编译器。 */
  it('accepts the bundled Device Card Host without a duplicate Vue compiler', async () => {
    const resources = await mkdtemp(join(tmpdir(), 'unilab-resources-'))
    const requiredFiles = [
      'app.asar',
      'workbench/lib/backend/main.js',
      'workbench/lib/frontend/index.html',
      'node-runtime/bin/node',
      'desktop/out/main/index.js',
      'desktop/out/preload/index.js',
      'desktop/node_modules/@unilab/device-card-host/dist/index.cjs',
      `device-card-builder/${process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'}`,
      'device-card-agent/cli.mjs',
      'workspace-skills/manifest.json',
      'workspace-skills/add-device/SKILL.md',
      'workspace-skills/add-resource/SKILL.md',
      'workspace-skills/add-workstation/SKILL.md',
      'workspace-skills/create-device-package/SKILL.md',
      'workspace-skills/create-device-skill/SKILL.md',
      'workspace-skills/unilab-domain-repo-builder/SKILL.md'
    ]
    try {
      await mkdir(join(resources, 'workbench', 'plugins'), { recursive: true })
      for (const relativePath of requiredFiles) {
        const path = join(resources, relativePath)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, 'fixture')
      }

      assert.doesNotThrow(() => {
        validatePackagedWorkbenchResources(resources, 'node')
      })
    } finally {
      await rm(resources, { recursive: true, force: true })
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
    const protectedTheiaBuild = await readFile(
      new URL('./run-theia-build.mjs', import.meta.url),
      'utf8'
    )

    assert.match(
      packageManifest.scripts['build:production'],
      /run-theia-build\.mjs --mode production/u
    )
    assert.match(protectedTheiaBuild, /theiaCli,[\s\S]*'build'/u)
    assert.match(protectedTheiaBuild, /theiaBuildEnvironment\(\)/u)
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
    assert.match(
      await readFile(new URL('./package-portable.mjs', import.meta.url), 'utf8'),
      /`--config\.compression=\$\{compression\}`/u
    )
    assert.match(
      builderConfiguration,
      /from: \.packaging\/node-runtime\s+to: node-runtime\s+filter:\s+- '\*\*\/\*'/u
    )
    assert.doesNotMatch(
      builderConfiguration,
      /from: \.packaging\/node-runtime\/bin\/node/u
    )
    assert.match(
      builderConfiguration,
      /afterSign: \.\.\/desktop\/scripts\/after-pack\.mjs/u
    )
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

  /** 验证 Windows 原生流水线分流 main 生产包、测试包与同源介质 A/B。 */
  it('builds the Windows installer on a native GitHub Actions runner', async () => {
    const workflow = await readFile(
      new URL('../../../.github/workflows/package-windows.yml', import.meta.url),
      'utf8'
    )
    const packagingScript = await readFile(
      new URL('./package-portable.mjs', import.meta.url),
      'utf8'
    )

    assert.match(workflow, /runs-on: windows-2022/u)
    assert.match(workflow, /permissions:\n(?:.|\n)*?contents: write/u)
    assert.match(workflow, /build\/Release\/crypt32\.node/u)
    assert.match(
      workflow,
      /UNILAB_RUNTIME_SOURCE_REF: b09c0c048f6de1e5027deb1733da439598c577cf/u
    )
    assert.doesNotMatch(workflow, /cache: pnpm/u)
    assert.match(workflow, /pnpm\/action-setup@v6/u)
    assert.match(workflow, /actions\/cache\/restore@v6/u)
    assert.match(workflow, /actions\/cache\/save@v6/u)
    assert.match(workflow, /cache-primary-key/u)
    assert.match(workflow, /push:\n\s+branches:\n\s+- deploy-windows-test/u)
    assert.doesNotMatch(workflow, /push:\n\s+branches:\n(?:\s+- [^\n]+\n)*\s+- main/u)
    assert.doesNotMatch(workflow, /ci\/desktop-packaging-optimization-v2/u)
    assert.match(workflow, /workflow_dispatch:/u)
    assert.match(
      workflow,
      /default: full\n\s+type: choice\n\s+options:\n\s+- full\n\s+- quick\n\s+- benchmark/u
    )
    assert.match(workflow, /options:\n\s+- normal\n\s+- maximum/u)
    assert.match(workflow, /UNILAB_CI_PACKAGE_MODE:/u)
    assert.match(workflow, /UNILAB_WORKBENCH_COMPRESSION:/u)
    assert.match(workflow, /UNILAB_WORKBENCH_RELEASE_CHANNEL:/u)
    assert.match(workflow, /refs\/heads\/main' && 'production' \|\| 'test'/u)
    assert.doesNotMatch(workflow, /strategy:\n\s+matrix:/u)
    assert.match(workflow, /ELECTRON_VERSION: 33\.4\.11/u)
    assert.match(workflow, /ELECTRON_BUILDER_VERSION: 25\.1\.8/u)
    assert.match(
      workflow,
      new RegExp(`PORTABLE_NODE_VERSION: ${PORTABLE_NODE_VERSION}`, 'u')
    )
    assert.match(workflow, /windows-pnpm-store-v1-/u)
    assert.match(workflow, /restore-keys:/u)
    assert.match(workflow, /name: Save pnpm store/u)
    assert.match(workflow, /windows-runtime-installer-v2-/u)
    assert.match(workflow, /dist\/constructor\/\*\.exe/u)
    const validateConfigIndex = workflow.indexOf(
      'name: Validate update publishing configuration'
    )
    const releaseRestoreIndex = workflow.indexOf(
      'name: Restore versioned Windows Runtime release'
    )
    const restoreRuntimeIndex = workflow.indexOf(
      'name: Restore Windows Runtime cache'
    )
    const checkoutRuntimeIndex = workflow.indexOf('name: Check out Uni-Lab OS')
    assert.ok(validateConfigIndex >= 0)
    assert.ok(releaseRestoreIndex >= 0)
    assert.ok(restoreRuntimeIndex >= 0)
    assert.ok(validateConfigIndex < releaseRestoreIndex)
    assert.ok(releaseRestoreIndex < restoreRuntimeIndex)
    assert.ok(restoreRuntimeIndex < checkoutRuntimeIndex)
    assert.match(
      workflow.slice(checkoutRuntimeIndex, checkoutRuntimeIndex + 260),
      /steps\.runtime-release\.outputs\.hit != 'true'.*steps\.runtime-cache\.outputs\.cache-hit != 'true'/su
    )
    assert.match(workflow, /windows-electron-builder-v3-/u)
    assert.match(workflow, /electron-\$\{\{ env\.ELECTRON_VERSION \}\}/u)
    assert.match(workflow, /builder-\$\{\{ env\.ELECTRON_BUILDER_VERSION \}\}/u)
    assert.doesNotMatch(
      workflow,
      /windows-electron-builder-v3-[^\n]*hashFiles\('pnpm-lock\.yaml'/u
    )
    assert.match(workflow, /windows-portable-node-v1-/u)
    assert.match(workflow, /\.unilab-workbench\\downloads/u)
    assert.match(workflow, /aionui-prepared-windows-x64-v1-/u)
    assert.match(
      workflow,
      /validateBundledAgentPayload\('\.ci-cache', 'win32', 'x64', 'prepared'\)/u
    )
    assert.match(workflow, /windows-workbench-plugins-v1-/u)
    const pluginCacheIndex = workflow.indexOf('name: Cache pinned Theia plugins')
    const selectVersionIndex = workflow.indexOf(
      'name: Select automatic Windows package version'
    )
    const buildInstallerIndex = workflow.indexOf(
      'name: Build full Windows installer'
    )
    assert.ok(pluginCacheIndex >= 0)
    assert.ok(pluginCacheIndex < selectVersionIndex)
    assert.ok(selectVersionIndex < buildInstallerIndex)
    const fullInstallerSection = workflow.slice(
      buildInstallerIndex,
      workflow.indexOf('name: Prepare identical unpacked input for Windows A/B')
    )
    assert.match(
      fullInstallerSection,
      /UNILAB_WORKBENCH_PRECOMPRESSED_PROFILE: none/u
    )
    assert.match(
      packagingScript,
      /validateWindowsInstallerArchive\(installer\.path\)/u
    )
    assert.match(workflow, /prepare-package-version\.mjs/u)
    assert.match(workflow, /name: Select test Windows package version/u)
    assert.match(workflow, /UNILAB_WORKBENCH_PACKAGE_VERSION=/u)
    assert.match(workflow, /readWorkbenchUpdateMetadataVersion/u)
    assert.match(workflow, /发布版本：\$env:UNILAB_WORKBENCH_PACKAGE_VERSION/u)
    assert.doesNotMatch(workflow, /git (?:commit|push)/u)
    assert.match(workflow, /MINIFORGE_VERSION: 26\.3\.2-3/u)
    assert.match(workflow, /AIONUI_WINDOWS_SHA512: [a-f0-9]{128}/u)
    assert.match(workflow, /Get-FileHash \$agentInstaller -Algorithm SHA512/u)
    assert.match(workflow, /Test-Path \.conda\/constructor\/construct\.yaml/u)
    assert.match(
      workflow,
      /conda run -n constructor-build constructor/u
    )
    assert.match(
      workflow,
      /node apps\/workbench\/scripts\/package-windows\.mjs/u
    )
    assert.equal(
      workflow.match(/build:desktop:production/gu)?.length,
      1
    )
    assert.match(workflow, /UNILAB_WORKBENCH_PACKAGE_MODE: directory/u)
    assert.match(workflow, /UNILAB_WORKBENCH_PACKAGE_MODE: prepackaged/u)
    assert.match(workflow, /UNILAB_WORKBENCH_PREPACKAGED_APP:/u)
    assert.match(workflow, /Name = 'baseline'; Profile = 'none'/u)
    assert.match(workflow, /Name = 'precompressed-exe'; Profile = 'exe'/u)
    assert.match(workflow, /\$sizeReport\.precompressedProfile -ne 'none'/u)
    assert.match(workflow, /precompressed-ab-metrics\.json/u)
    assert.match(workflow, /New-SelfSignedCertificate/u)
    assert.match(workflow, /-Type CodeSigningCert/u)
    assert.match(workflow, /CSC_LINK=/u)
    assert.match(workflow, /CSC_KEY_PASSWORD=/u)
    assert.match(workflow, /Get-AuthenticodeSignature/u)
    assert.match(workflow, /UNILAB_EXPECTED_CERTIFICATE_THUMBPRINT/u)
    const temporaryCertificateSection = workflow.slice(
      workflow.indexOf('name: Create temporary CI code-signing certificate'),
      workflow.indexOf('name: Build full Windows installer')
    )
    assert.match(
      temporaryCertificateSection,
      /if: env\.UNILAB_CI_PACKAGE_MODE == 'full'/u
    )
    assert.doesNotMatch(
      temporaryCertificateSection,
      /UNILAB_WORKBENCH_RELEASE_CHANNEL/u
    )
    assert.match(
      workflow,
      /name: Remove temporary CI code-signing certificate\s+if: always\(\)/u
    )
    assert.match(workflow, /UNILAB_RUNTIME_INSTALLER=/u)
    assert.match(workflow, /UNILAB_AGENT_DISTRIBUTION=/u)
    assert.match(workflow, /Filter 'aioncore\.exe'/u)
    assert.match(workflow, /Test-Path \(Join-Path \$_\.Directory\.FullName 'managed-resources'\)/u)
    assert.match(workflow, /bundled-aioncore\\windows-x64/u)
    assert.match(
      workflow,
      /Get-ChildItem apps\/workbench\/release-windows -File -Filter '\*-setup\.exe'/u
    )
    assert.match(
      workflow,
      /Get-ChildItem apps\/workbench\/release-windows -File -Filter '\*-setup\.exe\.blockmap'/u
    )
    assert.match(workflow, /release-windows\/latest\.yml/u)
    assert.match(workflow, /release-windows\/package-size-report\.json/u)
    assert.match(workflow, /WINDOWS_RELEASE_TAG: workbench-windows-stable/u)
    assert.match(workflow, /tzutil\.exe \/s "China Standard Time"/u)
    assert.match(
      workflow,
      /FindSystemTimeZoneById\('China Standard Time'\)/u
    )
    assert.match(workflow, /ConvertTimeFromUtc\(\s*\[DateTime\]::UtcNow/u)
    assert.match(workflow, /' \+08:00'/u)
    assert.match(workflow, /BUILD_STARTED_AT_CST=/u)
    assert.match(workflow, /更新时间：\$env:BUILD_STARTED_AT_CST（UTC\+08:00）/u)
    assert.match(
      workflow,
      /releases\/download\/workbench-windows-stable/u
    )
    assert.doesNotMatch(workflow, /vars\.UNILAB_WORKBENCH_UPDATE_URL/u)
    assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/u)
    assert.match(workflow, /gh release upload/u)
    assert.doesNotMatch(workflow, /gh release create/u)
    const uploadBinaryIndex = workflow.indexOf(
      '& gh release upload $env:WINDOWS_RELEASE_TAG $installerPath $blockmapPath'
    )
    const uploadMetadataIndex = workflow.indexOf(
      '& gh release upload $env:WINDOWS_RELEASE_TAG $metadataPath'
    )
    const verifyReleaseIndex = workflow.indexOf(
      '# Verify exact names and sizes before declaring deployment complete.'
    )
    const removeStaleIndex = workflow.indexOf(
      '# Version changes rename the installer.'
    )
    assert.ok(uploadBinaryIndex >= 0)
    assert.ok(uploadBinaryIndex < uploadMetadataIndex)
    assert.ok(uploadMetadataIndex < verifyReleaseIndex)
    assert.ok(verifyReleaseIndex < removeStaleIndex)
    assert.match(workflow, /\$installerName = \[string\]\$installer\.Name/u)
    assert.match(workflow, /\$expectedNames -notcontains \$assetName/u)
    assert.match(workflow, /Rolling release asset verification failed/u)
    assert.match(workflow, /actions\/upload-artifact@v6/u)
    assert.doesNotMatch(workflow, /Upload Windows packaging diagnostics/u)
    assert.doesNotMatch(
      workflow,
      /UniLab-Workbench-windows-x64-diagnostics/u
    )
    const installerUploadSection = workflow.slice(
      workflow.indexOf('name: Upload Windows installer'),
      workflow.indexOf('name: Upload Windows precompressed-resource A/B')
    )
    assert.match(
      installerUploadSection,
      /if: env\.UNILAB_CI_PACKAGE_MODE == 'full'/u
    )
    assert.doesNotMatch(installerUploadSection, /github\.event_name/u)
    assert.doesNotMatch(installerUploadSection, /github\.ref/u)
    assert.match(installerUploadSection, /\*-setup\.exe/u)
    assert.match(installerUploadSection, /UNILAB_WORKBENCH_RELEASE_CHANNEL/u)
    assert.match(
      installerUploadSection,
      /name: UniLab-Workbench-windows-x64-\$\{\{ env\.UNILAB_WORKBENCH_RELEASE_CHANNEL \}\}-\$\{\{ env\.UNILAB_WORKBENCH_PACKAGE_VERSION \}\}\n/u
    )
    assert.doesNotMatch(installerUploadSection, /github\.run_number/u)
    assert.doesNotMatch(installerUploadSection, /\*-setup\.exe\.blockmap/u)
    assert.doesNotMatch(installerUploadSection, /latest\.yml/u)
    assert.match(installerUploadSection, /compression-level: 0/u)
    const abUploadSection = workflow.slice(
      workflow.indexOf('name: Upload Windows precompressed-resource A/B'),
      workflow.indexOf('name: Publish rolling Windows update release')
    )
    assert.match(abUploadSection, /package-size-report\.json/u)
    assert.match(abUploadSection, /precompressed-ab-metrics\.json/u)
    assert.doesNotMatch(abUploadSection, /\*-setup\.exe/u)
    assert.match(
      workflow,
      /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'[^\n]*UNILAB_WORKBENCH_RELEASE_CHANNEL == 'production'/u
    )

    const builderConfiguration = await readFile(
      new URL('../electron-builder.yml', import.meta.url),
      'utf8'
    )
    assert.match(builderConfiguration, /differentialPackage: true/u)
    assert.match(builderConfiguration, /packElevateHelper: true/u)
    assert.match(
      builderConfiguration,
      /artifactName: UniLab\.Workbench-\$\{version\}-\$\{arch\}-setup\.\$\{ext\}/u
    )
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
