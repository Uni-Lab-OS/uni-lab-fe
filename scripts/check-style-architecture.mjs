import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const STYLE_EXTENSIONS = new Set(['.css', '.scss'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps', 'packages', 'e2e'],
  { cwd: ROOT, encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  .filter((file) => existsSync(file))
  .filter((file) => !/(?:^|\/)(?:dist|coverage|node_modules|playwright-report|test-results)\//.test(file))

const styleFiles = files.filter((file) => STYLE_EXTENSIONS.has(extname(file)))
const sourceFiles = files.filter((file) => SOURCE_EXTENSIONS.has(extname(file)))
const violations = []

const allowedPlainCss = (file) => (
  file === 'apps/kernel-web/src/styles/global.css' ||
  file.startsWith('apps/kernel-web/src/styles/global/') ||
  file === 'apps/workbench/desktop/welcome.css' ||
  file === 'packages/design-system/src/theme.css' ||
  file === 'packages/material/src/UnifiedMaterialViewport.css' ||
  file.startsWith('packages/pascal-host/src/styles/') ||
  file.startsWith('packages/workbench-theia/src/browser/style/') ||
  file.startsWith('e2e/')
)

const ownerOf = (file) => {
  const [scope, name] = file.split('/')
  return `${scope}/${name}/`
}

for (const file of styleFiles) {
  const name = basename(file)
  if (file.endsWith('.css') && !allowedPlainCss(file)) {
    violations.push(`${file}: 业务样式不得使用普通 CSS；优先 Tailwind，复杂样式使用 *.module.scss`)
  }

  if (file.endsWith('.scss') && !name.endsWith('.module.scss') && !name.startsWith('_')) {
    violations.push(`${file}: SCSS 入口必须是 *.module.scss，拆分文件必须以下划线开头`)
  }

  if (file.endsWith('.scss') && name.startsWith('_')) {
    const owner = ownerOf(file)
    const hasModuleBoundary = styleFiles.some(
      (candidate) => candidate.startsWith(owner) && candidate.endsWith('.module.scss'),
    )
    if (!hasModuleBoundary) {
      violations.push(`${file}: SCSS partial 必须归属于同一应用或包内的 CSS Module 入口`)
    }
  }

  if (
    (file.startsWith('packages/device-management/') || file.startsWith('packages/robot-workstation/')) &&
    readFileSync(file, 'utf8').includes('!important')
  ) {
    violations.push(`${file}: 新收口的业务模块禁止新增 !important`)
  }
}

for (const file of sourceFiles.filter((candidate) => candidate.startsWith('packages/device-management/src/'))) {
  const source = readFileSync(file, 'utf8')
  if (/className\s*=\s*["`][^"`]*(?:edge-device|device-list|device-empty|section__)/.test(source)) {
    violations.push(`${file}: 设备管理 BEM 类必须通过 CSS Module 映射，不得回退到全局类名`)
  }
  if (/DeviceManagement(?:Actions)?\.css/.test(source)) {
    violations.push(`${file}: 不得重新导入已迁移的设备管理全局 CSS`)
  }
}

const totalLines = styleFiles.reduce(
  (sum, file) => sum + readFileSync(file, 'utf8').split(/\r?\n/).length,
  0,
)
const plainCssCount = styleFiles.filter((file) => file.endsWith('.css')).length
const moduleCount = styleFiles.filter((file) => file.endsWith('.module.scss')).length
const partialCount = styleFiles.filter((file) => basename(file).startsWith('_')).length

console.log(
  `[styles] ${styleFiles.length} 个样式文件，${totalLines} 行；` +
  `${plainCssCount} 个受控普通 CSS，${moduleCount} 个 CSS Module，${partialCount} 个 Module partial。`,
)

if (violations.length > 0) {
  console.error('\n[styles] 样式边界检查失败：')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log('[styles] Tailwind / CSS Module / 全局 CSS 边界检查通过。')
}
