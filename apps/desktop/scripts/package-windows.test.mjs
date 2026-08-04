import {
  closeSync,
  existsSync,
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
  MAX_PACKAGED_APP_BYTES,
  MIN_WINDOWS_INSTALLER_BYTES,
  findWindowsInstaller,
  resolvePackagingCliPaths,
  validatePackagedApp
} from './package-windows.mjs'

const DEVICE_CARD_APP_ARCHIVE_BYTES = 50 * 1024 * 1024
const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Windows package publication gates', () => {
  it('resolves packaging CLIs from the desktop package dependencies', () => {
    const paths = resolvePackagingCliPaths()

    expect(paths.electronViteCli).toContain(
      '/apps/desktop/node_modules/electron-vite/'
    )
    expect(paths.electronBuilderCli).toContain(
      '/apps/desktop/node_modules/electron-builder/'
    )
    expect(existsSync(paths.electronViteCli)).toBe(true)
    expect(existsSync(paths.electronBuilderCli)).toBe(true)
  })

  it('rejects the small NSIS shell left by a failed build', () => {
    const outputDirectory = createOutputDirectory()
    createSparsePeFile(
      join(outputDirectory, 'Uni-Lab-0.1.0-x64-setup.exe'),
      217_347
    )

    expect(() => findWindowsInstaller(outputDirectory))
      .toThrow(/安装包不完整/)
  })

  it('accepts a complete PE installer above the minimum size', () => {
    const outputDirectory = createOutputDirectory()
    const installerPath = join(
      outputDirectory,
      'Uni-Lab-0.1.0-x64-setup.exe'
    )
    createSparsePeFile(installerPath, MIN_WINDOWS_INSTALLER_BYTES)

    expect(findWindowsInstaller(outputDirectory)).toEqual({
      path: installerPath,
      size: MIN_WINDOWS_INSTALLER_BYTES
    })
  })

  it('accepts the current device-card app archive within budget', () => {
    const outputDirectory = createOutputDirectory()
    const archivePath = join(
      outputDirectory,
      'win-unpacked',
      'resources',
      'app.asar'
    )
    mkdirSync(join(archivePath, '..'), { recursive: true })
    createSparseFile(archivePath, DEVICE_CARD_APP_ARCHIVE_BYTES)

    expect(validatePackagedApp(outputDirectory)).toEqual({
      path: archivePath,
      size: DEVICE_CARD_APP_ARCHIVE_BYTES
    })
  })

  it('rejects an app archive over the dependency budget', () => {
    const outputDirectory = createOutputDirectory()
    const resourcesDirectory = join(
      outputDirectory,
      'win-unpacked',
      'resources'
    )
    mkdirSync(resourcesDirectory, { recursive: true })
    createSparseFile(
      join(resourcesDirectory, 'app.asar'),
      MAX_PACKAGED_APP_BYTES + 1
    )

    expect(() => validatePackagedApp(outputDirectory))
      .toThrow(/超出 56\.0 MiB 预算/)
  })
})

function createOutputDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'unilab-package-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function createSparsePeFile(path, size) {
  const descriptor = openSync(path, 'w')
  try {
    writeSync(descriptor, Buffer.from('MZ'))
    ftruncateSync(descriptor, size)
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
