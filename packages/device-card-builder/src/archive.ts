import {
  mkdir,
  readFile,
  readdir,
  writeFile
} from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'

import {
  unzipSync,
  zipSync,
  type Zippable
} from 'fflate'
import {
  parseDeviceCardManifest,
  type DeviceCardManifest
} from '@unilab/device-card-sdk'

import type { DeviceCardArchiveInspection } from './contracts'
import { isSafeArchivePath } from './security'

const MAX_COMPRESSED_BYTES = 10 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024
const MAX_FILE_COUNT = 256
const ALLOWED_EXTENSIONS = new Set([
  '.css',
  '.json',
  '.png',
  '.svg',
  '.ts',
  '.tsx',
  '.vue',
  '.webp'
])

export async function packDeviceCard(
  projectDir: string,
  archivePath: string
): Promise<DeviceCardArchiveInspection> {
  const root = resolve(projectDir)
  const names = (await walk(root))
    .filter((name) => shouldPack(name))
    .sort()
  if (!names.includes('card.manifest.json')) {
    throw new Error('项目缺少 card.manifest.json。')
  }
  if (names.length > MAX_FILE_COUNT) {
    throw new Error(`卡片文件数超过 ${MAX_FILE_COUNT}。`)
  }
  const entries: Zippable = {}
  const rawEntries: Record<string, Uint8Array> = {}
  let uncompressedBytes = 0
  for (const name of names) {
    const bytes = new Uint8Array(await readFile(resolve(root, name)))
    uncompressedBytes += bytes.byteLength
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('卡片解压后体积超过 30 MiB。')
    }
    entries[name] = [bytes, { mtime: new Date('1980-01-01T00:00:00Z') }]
    rawEntries[name] = bytes
  }
  const archive = zipSync(entries, { level: 9 })
  if (archive.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error('卡片包体积超过 10 MiB。')
  }
  await mkdir(dirname(resolve(archivePath)), { recursive: true })
  await writeFile(resolve(archivePath), archive)
  return inspection(
    parseManifest(rawEntries['card.manifest.json']),
    names,
    archive.byteLength,
    uncompressedBytes
  )
}

export async function unpackDeviceCard(
  archivePath: string,
  destination: string
): Promise<DeviceCardArchiveInspection> {
  const archive = new Uint8Array(await readFile(resolve(archivePath)))
  const { entries, files, uncompressedBytes } = readArchive(archive)
  const manifestBytes = entries['card.manifest.json']
  if (!manifestBytes) throw new Error('卡片包缺少 card.manifest.json。')
  const manifest = parseManifest(manifestBytes)
  const root = resolve(destination)
  await mkdir(root, { recursive: true })
  for (const name of files) {
    const path = resolve(root, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, entries[name])
  }
  return inspection(
    manifest,
    files,
    archive.byteLength,
    uncompressedBytes
  )
}

export async function inspectDeviceCardArchive(
  archivePath: string
): Promise<DeviceCardArchiveInspection> {
  const archive = new Uint8Array(await readFile(resolve(archivePath)))
  const { entries, files, uncompressedBytes } = readArchive(archive)
  const manifestBytes = entries['card.manifest.json']
  if (!manifestBytes) throw new Error('卡片包缺少 card.manifest.json。')
  return inspection(
    parseManifest(manifestBytes),
    files,
    archive.byteLength,
    uncompressedBytes
  )
}

function readArchive(archive: Uint8Array): {
  entries: Record<string, Uint8Array>
  files: string[]
  uncompressedBytes: number
} {
  if (archive.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error('卡片包体积超过 10 MiB。')
  }
  let advertisedBytes = 0
  let advertisedFiles = 0
  const entries = unzipSync(archive, {
    filter: (file) => {
      advertisedFiles += 1
      advertisedBytes += file.originalSize
      if (advertisedFiles > MAX_FILE_COUNT) {
        throw new Error(`卡片文件数超过 ${MAX_FILE_COUNT}。`)
      }
      if (advertisedBytes > MAX_UNCOMPRESSED_BYTES) {
        throw new Error('卡片声明的解压体积超过 30 MiB。')
      }
      if (!isSafeArchivePath(file.name) || !shouldPack(file.name)) {
        throw new Error(`卡片包含不允许的路径：${file.name}`)
      }
      return true
    }
  })
  const files = Object.keys(entries).sort()
  if (files.length > MAX_FILE_COUNT) {
    throw new Error(`卡片文件数超过 ${MAX_FILE_COUNT}。`)
  }
  let uncompressedBytes = 0
  for (const name of files) {
    if (!isSafeArchivePath(name) || !shouldPack(name)) {
      throw new Error(`卡片包含不允许的路径：${name}`)
    }
    uncompressedBytes += entries[name].byteLength
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('卡片解压后体积超过 30 MiB。')
    }
  }
  return { entries, files, uncompressedBytes }
}

async function walk(root: string, directory = root): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error(`卡片项目不能包含符号链接：${entry.name}`)
    }
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === '.unilab-card'
    ) {
      continue
    }
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...await walk(root, absolute))
    } else if (entry.isFile()) {
      result.push(relative(root, absolute).replaceAll('\\', '/'))
    }
  }
  return result
}

function shouldPack(name: string): boolean {
  if (name === 'card.manifest.json' || name === 'mock.json') return true
  return ALLOWED_EXTENSIONS.has(extname(name).toLowerCase())
}

function parseManifest(bytes: Uint8Array): DeviceCardManifest {
  return parseDeviceCardManifest(
    JSON.parse(new TextDecoder().decode(bytes)) as unknown
  )
}

function inspection(
  manifest: DeviceCardManifest,
  files: string[],
  compressedBytes: number,
  uncompressedBytes: number
): DeviceCardArchiveInspection {
  return { manifest, files, compressedBytes, uncompressedBytes }
}
