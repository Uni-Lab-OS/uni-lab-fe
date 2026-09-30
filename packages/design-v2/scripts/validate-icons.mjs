#!/usr/bin/env node

import { access, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const iconRoot = join(packageRoot, 'src/icons')
const assetsRoot = join(iconRoot, 'assets')
const manifestPath = join(iconRoot, 'generated/manifest.ts')

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const expectedCountValue = arg('--expected-count') ?? process.env.BOHR_ICON_EXPECTED_COUNT
const expectedCount = expectedCountValue ? Number(expectedCountValue) : undefined
if (expectedCountValue && (!Number.isInteger(expectedCount) || expectedCount < 1)) {
  throw new Error(
    `Expected a positive integer for --expected-count, received: ${expectedCountValue}`,
  )
}

async function walk(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path, extension)))
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(path)
  }
  return files
}

const assets = await walk(assetsRoot, '.svg')
const categoryModules = await walk(join(iconRoot, 'generated/categories'), '.ts')
const staticModules = await walk(join(iconRoot, 'static'), '.ts')
const manifestSource = await readFile(manifestPath, 'utf8')
const manifestJson = manifestSource.match(
  /export const ICON_MANIFEST = (\{[\s\S]*?\}) as const\n\nexport/,
)
if (!manifestJson) throw new Error('Could not parse generated icon manifest')
const manifest = JSON.parse(manifestJson[1])
const names = Object.keys(manifest)

if (assets.length !== names.length) {
  throw new Error(
    `Asset/manifest count mismatch: ${assets.length} assets vs ${names.length} manifest entries`,
  )
}
if (expectedCount !== undefined && assets.length !== expectedCount) {
  throw new Error(`Unexpected Figma public icon count: ${assets.length}; expected ${expectedCount}`)
}
if (categoryModules.length !== 19)
  throw new Error(`Expected 19 category chunks, found ${categoryModules.length}`)
if (staticModules.length !== names.length)
  throw new Error(
    `Static icon count mismatch: ${staticModules.length} files vs ${names.length} manifest entries`,
  )

for (const [name, entry] of Object.entries(manifest)) {
  const assetPath = resolve(iconRoot, entry.assetPath)
  await access(assetPath)
  const svg = await readFile(assetPath, 'utf8')
  if (/#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i.test(svg)) {
    throw new Error(`Hard-coded hex color remains in ${name}`)
  }
  if (!svg.includes('<svg') || !svg.includes('viewBox='))
    throw new Error(`Invalid SVG export: ${name}`)
  if (entry.source !== 'figma' || !entry.figmaName.startsWith('Icon/')) {
    throw new Error(`Missing Figma provenance for ${name}`)
  }
}

const deprecated = assets.filter((path) => path.includes('.Deprecated'))
if (deprecated.length > 0)
  throw new Error(`Deprecated Figma icons were included: ${deprecated.join(', ')}`)

const countMessage = expectedCount === undefined ? 'count not pinned' : `count=${expectedCount}`
console.log(
  `Validated ${names.length} Figma icons, ${assets.length} SVG assets (${countMessage}), and no deprecated exports.`,
)
