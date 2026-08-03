import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'

import {
  inspectDeviceCardArchive,
  packDeviceCard
} from './archive'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  )
})

describe('device card source archive', () => {
  it('packs the same source deterministically', async () => {
    const root = await temporaryDirectory()
    const project = join(root, 'project')
    await mkdir(join(project, 'src'), { recursive: true })
    await writeFile(
      join(project, 'card.manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'demo.device.card',
        version: '0.1.0',
        title: 'Demo',
        deviceTypes: ['demo'],
        sdkVersion: '^0.1.0',
        hostProtocolVersion: 1,
        authoringProfile: 'web-component-lite-v1',
        entry: 'src/card.ts',
        uiFeatures: [],
        permissions: { state: [], actions: [], media: [] }
      })
    )
    await writeFile(
      join(project, 'src/card.ts'),
      'export default class DemoCard extends HTMLElement {}'
    )
    const first = join(root, 'first.ulcard')
    const second = join(root, 'second.ulcard')

    await packDeviceCard(project, first)
    await packDeviceCard(project, second)

    expect(await readFile(first)).toEqual(await readFile(second))
  })

  it('rejects archive traversal before extraction', async () => {
    const root = await temporaryDirectory()
    const archive = join(root, 'unsafe.ulcard')
    await writeFile(archive, zipSync({
      '../escape.ts': new TextEncoder().encode('bad')
    }))

    await expect(inspectDeviceCardArchive(archive))
      .rejects.toThrow('不允许的路径')
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'unilab-card-archive-'))
  temporaryDirectories.push(directory)
  return directory
}
