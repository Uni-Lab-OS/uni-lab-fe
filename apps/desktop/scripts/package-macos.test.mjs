import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MIN_MACOS_INSTALLER_BYTES,
  findMacosInstaller,
  validatePackagedMacosApp
} from './package-macos.mjs'
import { MAX_PACKAGED_APP_BYTES } from './package-windows.mjs'

const DEVICE_CARD_APP_ARCHIVE_BYTES = 50 * 1024 * 1024
const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('macOS package publication gates', () => {
  it('rejects a truncated DMG', () => {
    const outputDirectory = createOutputDirectory()
    createSparseDmg(
      join(outputDirectory, 'Uni-Lab-0.1.0-arm64.dmg'),
      217_347,
      true
    )

    expect(() => findMacosInstaller(outputDirectory))
      .toThrow(/安装包不完整/)
  })

  it('rejects a large file without a UDIF trailer', () => {
    const outputDirectory = createOutputDirectory()
    createSparseDmg(
      join(outputDirectory, 'Uni-Lab-0.1.0-arm64.dmg'),
      MIN_MACOS_INSTALLER_BYTES,
      false
    )

    expect(() => findMacosInstaller(outputDirectory))
      .toThrow(/缺少有效的 UDIF 尾部/)
  })

  it('accepts a complete DMG above the minimum size', () => {
    const outputDirectory = createOutputDirectory()
    const installerPath = join(
      outputDirectory,
      'Uni-Lab-0.1.0-arm64.dmg'
    )
    createSparseDmg(installerPath, MIN_MACOS_INSTALLER_BYTES, true)

    expect(findMacosInstaller(outputDirectory)).toEqual({
      path: installerPath,
      size: MIN_MACOS_INSTALLER_BYTES
    })
  })

  it('accepts the current device-card app archive within budget', () => {
    const outputDirectory = createOutputDirectory()
    const archivePath = join(
      outputDirectory,
      'mac-arm64',
      'Uni-Lab.app',
      'Contents',
      'Resources',
      'app.asar'
    )
    mkdirSync(join(archivePath, '..'), { recursive: true })
    createSparseFile(archivePath, DEVICE_CARD_APP_ARCHIVE_BYTES)

    expect(validatePackagedMacosApp(outputDirectory)).toEqual({
      path: archivePath,
      size: DEVICE_CARD_APP_ARCHIVE_BYTES
    })
  })

  it('rejects a macOS app archive over the dependency budget', () => {
    const outputDirectory = createOutputDirectory()
    const resourcesDirectory = join(
      outputDirectory,
      'mac-arm64',
      'Uni-Lab.app',
      'Contents',
      'Resources'
    )
    mkdirSync(resourcesDirectory, { recursive: true })
    createSparseFile(
      join(resourcesDirectory, 'app.asar'),
      MAX_PACKAGED_APP_BYTES + 1
    )

    expect(() => validatePackagedMacosApp(outputDirectory))
      .toThrow(/超出 56\.0 MiB 预算/)
  })
})

function createOutputDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'unilab-package-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function createSparseDmg(path, size, hasSignature) {
  const descriptor = openSync(path, 'w')
  try {
    ftruncateSync(descriptor, size)
    if (hasSignature) {
      writeSync(descriptor, Buffer.from('koly'), 0, 4, size - 512)
    }
  } finally {
    closeSync(descriptor)
  }
}

function createSparseFile(path, size) {
  const descriptor = openSync(path, 'w')
  try {
    ftruncateSync(descriptor, size)
  } finally {
    closeSync(descriptor)
  }
}
