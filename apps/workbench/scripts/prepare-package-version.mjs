#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  readWorkbenchUpdateMetadataVersion,
  selectNextWorkbenchVersion
} from './update-publish.mjs'

const [packagePathArgument, publishedMetadataPathArgument] = process.argv.slice(2)
if (!packagePathArgument || process.argv.length > 4) {
  throw new Error(
    '用法：prepare-package-version.mjs <package.json> [published-latest.yml]'
  )
}

const packagePath = resolve(packagePathArgument)
const packageText = await readFile(packagePath, 'utf8')
const packageManifest = JSON.parse(packageText)
const sourceVersion = packageManifest.version
let publishedVersion = null

if (publishedMetadataPathArgument) {
  const metadata = await readFile(resolve(publishedMetadataPathArgument), 'utf8')
  publishedVersion = readWorkbenchUpdateMetadataVersion(metadata)
}

const targetVersion = selectNextWorkbenchVersion(sourceVersion, publishedVersion)
packageManifest.version = targetVersion
await writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`)

console.log(
  `[UniLab Workbench] package version: source=${sourceVersion}, published=${publishedVersion ?? 'none'}, target=${targetVersion}`
)
