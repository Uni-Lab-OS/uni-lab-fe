import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const ROOT = process.cwd()
const SOURCE_EXTENSIONS = /\.(?:ts|tsx)$/
const productionFiles = execFileSync(
  'git',
  [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'apps/developer-web/src',
    'packages/lab-ui/src',
  ],
  { cwd: ROOT, encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  .filter((file) => SOURCE_EXTENSIONS.test(file))
  .filter((file) => !/\.(?:test|spec)\.[jt]sx?$/.test(file))

const labUiEntry = readFileSync('packages/lab-ui/src/index.ts', 'utf8')
const publicExports = new Set()
for (const match of labUiEntry.matchAll(/export\s*{([^}]*)}\s*from\s*['"][^'"]+['"]/g)) {
  for (const specifier of match[1].split(',')) {
    const trimmed = specifier.trim()
    if (trimmed.startsWith('type ')) continue
    const name = trimmed.split(/\s+as\s+/)[0]
    if (name) publicExports.add(name)
  }
}

const callers = new Map([...publicExports].map((name) => [name, []]))
const staleClassNames = [
  'modal-actions',
  'form-error',
  'full-input',
  'history-list',
  'reagent-identifier-text',
  'device-cell',
  'page-header-title',
]
const violations = []

for (const file of productionFiles) {
  const source = readFileSync(file, 'utf8')
  if (file.startsWith('apps/developer-web/')) {
    for (const match of source.matchAll(/import\s*{([^}]*)}\s*from\s*['"]@unilab\/lab-ui['"]/g)) {
      for (const specifier of match[1].split(',')) {
        const name = specifier
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
        if (callers.has(name)) callers.get(name).push(file)
      }
    }
  }

  for (const className of staleClassNames) {
    const bareClass = new RegExp(
      `(?:clsx\\(\\s*['"]${className}['"]|className\\s*=\\s*['"]${className}['"])`,
    )
    if (bareClass.test(source)) violations.push(`${file}: 残留裸 class ${className}`)
  }
}

for (const [name, files] of callers) {
  if (files.length === 0)
    violations.push(`packages/lab-ui/src/index.ts: 公开导出 ${name} 没有 developer-web 生产 caller`)
}

console.log(
  `[lab-ui] 公开导出 ${publicExports.size} 个，已检查 developer-web 生产 caller 和残留裸 class。`,
)
if (violations.length > 0) {
  console.error('[lab-ui] 边界检查失败：')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log('[lab-ui] caller/export 与裸 class 边界检查通过。')
}
