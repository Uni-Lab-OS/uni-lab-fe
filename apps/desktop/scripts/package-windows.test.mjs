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
  MAX_PACKAGED_APP_BYTES,
  MIN_WINDOWS_INSTALLER_BYTES,
  findWindowsInstaller,
  validatePackagedApp
} from './package-windows.mjs'

const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Windows package publication gates', () => {
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

  it('rejects an app archive that contains a duplicated dependency tree', () => {
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
      .toThrow(/超出 32\.0 MiB 预算/)
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
