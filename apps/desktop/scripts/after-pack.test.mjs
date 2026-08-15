import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { afterPack } from './after-pack.mjs'

const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('desktop afterPack optimization', () => {
  it('keeps only English and Simplified Chinese Electron resources on macOS', async () => {
    const outputDirectory = createOutputDirectory()
    const resourcesDirectory = join(
      outputDirectory,
      'Uni-Lab.app',
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Versions',
      'A',
      'Resources'
    )
    for (const name of [
      'en.lproj',
      'zh_CN.lproj',
      'fr.lproj',
      'resources.pak'
    ]) {
      mkdirSync(join(resourcesDirectory, name), { recursive: true })
    }

    await afterPack({
      electronPlatformName: 'darwin',
      appOutDir: outputDirectory
    })

    expect(existsSync(join(resourcesDirectory, 'en.lproj'))).toBe(true)
    expect(existsSync(join(resourcesDirectory, 'zh_CN.lproj'))).toBe(true)
    expect(existsSync(join(resourcesDirectory, 'fr.lproj'))).toBe(false)
    expect(existsSync(join(resourcesDirectory, 'resources.pak'))).toBe(true)
  })

  it('does not alter non-macOS packages', async () => {
    const outputDirectory = createOutputDirectory()
    await expect(afterPack({
      electronPlatformName: 'win32',
      appOutDir: outputDirectory
    })).resolves.toBeUndefined()
  })

  it('rejects incomplete copied resources before native media is built', async () => {
    const outputDirectory = createOutputDirectory()
    mkdirSync(join(outputDirectory, 'resources'), { recursive: true })
    mkdirSync(join(outputDirectory, 'resources', 'app.asar'))

    await expect(afterPack({
      electronPlatformName: 'win32',
      appOutDir: outputDirectory
    })).rejects.toThrow(/Workbench 安装包缺少运行资源/u)
  })
})

function createOutputDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'unilab-after-pack-test-'))
  temporaryDirectories.push(directory)
  return directory
}
