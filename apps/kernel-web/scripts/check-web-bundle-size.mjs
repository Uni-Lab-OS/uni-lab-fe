import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const assetRoot = resolve(appRoot, 'dist/assets')
const maximumBytes = Number(
  process.env.UNILAB_WEB_CHUNK_LIMIT_BYTES ?? 1_500_000
)

if (!Number.isFinite(maximumBytes) || maximumBytes <= 0) {
  throw new Error('UNILAB_WEB_CHUNK_LIMIT_BYTES must be a positive number')
}

const javascriptAssets = (await readdir(assetRoot))
  .filter((name) => name.endsWith('.js'))

if (javascriptAssets.length === 0) {
  throw new Error(`No production JavaScript assets found in ${assetRoot}`)
}

const assets = await Promise.all(javascriptAssets.map(async (name) => ({
  name,
  bytes: (await stat(resolve(assetRoot, name))).size
})))
assets.sort((left, right) => right.bytes - left.bytes)

const oversizedAssets = assets.filter(({ bytes }) => bytes > maximumBytes)
if (oversizedAssets.length > 0) {
  const details = oversizedAssets
    .map(({ name, bytes }) => `- ${name}: ${(bytes / 1_000_000).toFixed(2)} MB`)
    .join('\n')
  throw new Error(
    `Web bundle size limit exceeded (${(maximumBytes / 1_000_000).toFixed(2)} MB):\n${details}`
  )
}

const largest = assets[0]
console.log(
  `Web bundle size check passed: ${assets.length} JS assets, largest ${largest.name} ` +
  `${(largest.bytes / 1_000_000).toFixed(2)} MB`
)
