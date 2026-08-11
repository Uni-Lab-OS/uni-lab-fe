import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const builderConfig = readFileSync(
  join(desktopDirectory, 'electron-builder.yml'),
  'utf8'
)
const packageConfig = JSON.parse(
  readFileSync(join(desktopDirectory, 'package.json'), 'utf8')
)
const installerInclude = readFileSync(
  join(desktopDirectory, 'build', 'installer.nsh'),
  'utf8'
)

assert.deepEqual(packageConfig.dependencies ?? {}, {
  '@arizeai/phoenix-otel': '2.1.0',
  '@unilab/device-card-agent-cli': 'workspace:*',
  '@unilab/device-card-host': 'workspace:*',
  '@unilab/device-card-sdk': 'workspace:*',
  'electron-updater': '^6.8.9'
})
assert.equal(
  packageConfig.devDependencies?.['@unilab/kernel-web'],
  'workspace:*'
)
assert.equal(
  packageConfig.devDependencies?.['@unilab/device-provisioning'],
  'workspace:*'
)
assert.equal(
  packageConfig.devDependencies?.['@unilab/services'],
  'workspace:*'
)
assert.match(
  readFileSync(join(desktopDirectory, 'electron.vite.config.ts'), 'utf8'),
  /externalizeDepsPlugin\(\{ exclude: \['@unilab\/services'\] \}\)/
)
assert.equal(
  packageConfig.scripts?.['package:win'],
  'node scripts/package-windows.mjs'
)
assert.equal(
  packageConfig.scripts?.['package:mac'],
  'node scripts/package-macos.mjs'
)
assert.match(
  packageConfig.scripts?.['prepackage:win'] ?? '',
  /@unilab\/device-card-agent-cli build/
)
assert.match(
  packageConfig.scripts?.['prepackage:mac'] ?? '',
  /@unilab\/device-card-agent-cli build/
)
assert.match(builderConfig, /npmRebuild: false/)
assert.match(
  builderConfig,
  /extraResources:[\s\S]*?device-card-agent\/cli\.mjs/
)
assert.match(builderConfig, /electronLanguages:\s*\n\s*- zh-CN\s*\n\s*- en-US/)
assert.match(builderConfig, /afterPack: scripts\/after-pack\.mjs/)
assert.match(
  builderConfig,
  /publish:\s*\n\s*provider: generic\s*\n\s*url: \$\{env\.UNILAB_DESKTOP_UPDATE_URL\}/
)
assert.match(builderConfig, /mac:[\s\S]*?target:\s*\n\s*- dmg\s*\n\s*- zip/)
assert.match(builderConfig, /nsis:[\s\S]*?oneClick: false/)
assert.match(builderConfig, /nsis:[\s\S]*?perMachine: false/)
assert.match(builderConfig, /nsis:[\s\S]*?include: build\/installer\.nsh/)
assert.match(builderConfig, /nsis:[\s\S]*?allowToChangeInstallationDirectory: true/)
assert.match(installerInclude, /!macro customWelcomePage/)
assert.match(installerInclude, /!insertmacro MUI_PAGE_WELCOME/)
assert.doesNotMatch(installerInclude, /isForce(?:Current|Machine)Install/)

console.log(
  '桌面安装器检查通过：仅保留主进程运行时依赖，渲染器未重复打包，失败产物受发布门禁保护'
)
