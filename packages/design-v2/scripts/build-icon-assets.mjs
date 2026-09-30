#!/usr/bin/env node

/**
 * Turn the read-only Figma Bohr icon export into the checked-in design-v2
 * icon package. The input directory is expected to contain one directory per
 * Figma category and one SVG per public Icon/<category>/<name> component.
 *
 * Example:
 *   node scripts/build-icon-assets.mjs \
 *     --source-dir /tmp/figma-icons/clean \
 *     --output-dir src/icons
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, '..')

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const sourceDir = resolve(arg('--source-dir', join(packageRoot, '.icon-export')))
const outputDir = resolve(arg('--output-dir', join(packageRoot, 'src/icons')))
const assetsDir = join(outputDir, 'assets')
const generatedDir = join(outputDir, 'generated')
const staticDir = join(outputDir, 'static')

function slug(value) {
  return value
    .replace(/eCommerce/g, 'ecommerce')
    .replace(/&/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function normalizeSvg(svg) {
  return (
    svg
      .replace(/#1d2129/gi, 'currentColor')
      // Figma emits this neutral only as the opaque mask backing rect. The
      // mask uses alpha, so a named white fill preserves the export semantics
      // without leaking a second icon color into the runtime API.
      .replace(/#d9d9d9/gi, 'white')
      .replace(/stroke-width="1\.8"/g, 'stroke-width="var(--bh-icon-stroke-width, 1.8)"')
      .replace(/\s+xmlns:xlink="[^"]+"/g, '')
      .replace(/\n+/g, '\n')
      .trim()
  )
}

function bodyOf(svg) {
  const start = svg.indexOf('>') + 1
  const end = svg.lastIndexOf('</svg>')
  return svg.slice(start, end).trim()
}

function parseSvg(svg, sourcePath) {
  const root = svg.match(/<svg\b([^>]*)>/i)?.[1] ?? ''
  const width = root.match(/\bwidth="([^"]+)"/)?.[1]
  const height = root.match(/\bheight="([^"]+)"/)?.[1]
  const viewBox = root.match(/\bviewBox="([^"]+)"/)?.[1]
  if (!width || !height || !viewBox || !/^0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?$/.test(viewBox)) {
    throw new Error(`Expected a sized Figma SVG: ${sourcePath}`)
  }
  return { width, height, viewBox, body: bodyOf(svg) }
}

async function walkCategory(categoryDir) {
  const entries = await readdir(categoryDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.svg'))
    .sort((left, right) => left.name.localeCompare(right.name))
}

const categories = (await readdir(sourceDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .sort((left, right) => left.name.localeCompare(right.name))

if (categories.length === 0) {
  throw new Error(`No Figma icon categories found in ${sourceDir}`)
}

await rm(assetsDir, { recursive: true, force: true })
await rm(generatedDir, { recursive: true, force: true })
await rm(staticDir, { recursive: true, force: true })
await mkdir(assetsDir, { recursive: true })
await mkdir(generatedDir, { recursive: true })
await mkdir(join(generatedDir, 'categories'), { recursive: true })
await mkdir(staticDir, { recursive: true })

const entries = []
const seenNames = new Set()
const seenFigmaNames = new Set()

for (const categoryEntry of categories) {
  const category = categoryEntry.name
  const categorySlug = slug(category)
  const categoryDir = join(sourceDir, category)
  const files = await walkCategory(categoryDir)

  for (const file of files) {
    const originalBase = file.name.slice(0, -'.svg'.length)
    const nameSlug = slug(originalBase)
    const name = `${categorySlug}/${nameSlug}`
    const figmaName = `Icon/${category}/${originalBase}`
    if (seenNames.has(name)) throw new Error(`Duplicate icon name: ${name}`)
    if (seenFigmaNames.has(figmaName)) throw new Error(`Duplicate Figma name: ${figmaName}`)
    seenNames.add(name)
    seenFigmaNames.add(figmaName)

    const sourcePath = join(categoryDir, file.name)
    const originalSvg = await readFile(sourcePath, 'utf8')
    const svg = normalizeSvg(originalSvg)
    const parsed = parseSvg(svg, sourcePath)
    const assetFile = `${nameSlug}.svg`
    const assetPath = join(assetsDir, categorySlug, assetFile)
    await mkdir(dirname(assetPath), { recursive: true })
    await writeFile(assetPath, `${svg}\n`, 'utf8')

    entries.push({
      name,
      figmaName,
      category,
      categorySlug,
      assetPath: `./assets/${categorySlug}/${assetFile}`,
      width: parsed.width,
      height: parsed.height,
      viewBox: parsed.viewBox,
      body: parsed.body,
      strokeWidth: 1.8,
      source: 'figma',
      sourcePage: 'Bohr icon / 玻尔图标（Bohr 线上）',
    })
  }
}

entries.sort((left, right) => left.name.localeCompare(right.name))

const manifest = Object.fromEntries(entries.map(({ body, ...entry }) => [entry.name, entry]))
const names = entries.map((entry) => entry.name)
const categorySummary = categories.map((categoryEntry) => {
  const category = categoryEntry.name
  const categorySlug = slug(category)
  return {
    slug: categorySlug,
    name: category,
    count: entries.filter((entry) => entry.category === category).length,
  }
})

const generatedHeader = `// Generated from the read-only Figma Bohr icon export. Do not edit by hand.\n// Regenerate with: pnpm --dir packages/design-v2 build:icons -- --source-dir <export>/clean\n`
await writeFile(
  join(generatedDir, 'manifest.ts'),
  `${generatedHeader}\nexport const ICON_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const\n\nexport const ICON_NAMES = ${JSON.stringify(names, null, 2)} as const\nexport type IconName = typeof ICON_NAMES[number]\n\nexport const ICON_CATEGORIES = ${JSON.stringify(categorySummary, null, 2)} as const\n`,
  'utf8',
)

const categoryEntries = new Map()
for (const entry of entries) {
  const bucket = categoryEntries.get(entry.categorySlug) ?? []
  bucket.push(entry)
  categoryEntries.set(entry.categorySlug, bucket)
}

for (const [categorySlug, categoryIcons] of categoryEntries) {
  const categoryData = Object.fromEntries(
    categoryIcons.map((entry) => [
      entry.name,
      {
        body: entry.body,
        viewBox: entry.viewBox,
      },
    ]),
  )
  await writeFile(
    join(generatedDir, 'categories', `${categorySlug}.ts`),
    `${generatedHeader}\nexport const ICON_CATEGORY_DATA = ${JSON.stringify(categoryData, null, 2)} as const\n`,
    'utf8',
  )

  const categoryStaticDir = join(staticDir, categorySlug)
  await mkdir(categoryStaticDir, { recursive: true })
  for (const entry of categoryIcons) {
    const componentName = `${entry.name
      .split('/')[1]
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')}Icon`
    await writeFile(
      join(categoryStaticDir, `${entry.name.split('/')[1]}.ts`),
      `${generatedHeader}\nimport { createStaticIcon } from '../../staticIcon'\n\nexport const ${componentName} = createStaticIcon(${JSON.stringify({ body: entry.body, viewBox: entry.viewBox }, null, 2)})\nexport default ${componentName}\n`,
      'utf8',
    )
  }
}

const categoryLoaders = Object.fromEntries(
  [...categoryEntries.keys()].map((categorySlug) => [
    categorySlug,
    `() => import('./categories/${categorySlug}')`,
  ]),
)
await writeFile(
  join(generatedDir, 'iconLoader.ts'),
  `${generatedHeader}
import type { IconName } from './manifest'

export interface ResolvedIconData {
  body: string
  viewBox: string
}

type IconCategoryModule = { ICON_CATEGORY_DATA: Record<string, ResolvedIconData> }
type IconCategory = keyof typeof ICON_CATEGORY_LOADERS

const ICON_CATEGORY_LOADERS = {
${Object.entries(categoryLoaders)
  .map(([categorySlug, loader]) => `  '${categorySlug}': ${loader},`)
  .join('\n')}
} as const

const categoryCache = new Map<string, Promise<IconCategoryModule>>()
const iconCache = new Map<string, ResolvedIconData>()

export function iconCategoryFromName(name: string): string {
  return name.split('/')[0] ?? ''
}

function loadCategory(category: string): Promise<IconCategoryModule> {
  const cached = categoryCache.get(category)
  if (cached) return cached
  const loader = ICON_CATEGORY_LOADERS[category as IconCategory]
  if (!loader) return Promise.reject(new Error('Unknown Bohr icon category: ' + category))
  const promise = loader()
  categoryCache.set(category, promise)
  return promise
}

export function getCachedIconData(name: IconName): ResolvedIconData | undefined {
  return iconCache.get(name)
}

export function loadIconData(name: IconName): Promise<ResolvedIconData> {
  const cached = iconCache.get(name)
  if (cached) return Promise.resolve(cached)
  const category = iconCategoryFromName(name)
  return loadCategory(category).then((module) => {
    const data = module.ICON_CATEGORY_DATA[name]
    if (!data) throw new Error('Unknown Bohr icon: ' + name)
    iconCache.set(name, data)
    return data
  })
}

export function preloadIconCategory(category: string): Promise<void> {
  return loadCategory(category).then(() => undefined)
}
`,
  'utf8',
)

console.log(`Generated ${entries.length} Figma icons in ${relative(packageRoot, outputDir)}`)
