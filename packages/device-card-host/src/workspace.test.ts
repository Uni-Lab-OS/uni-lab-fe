import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { inspectDeviceCardArchive } from '@unilab/device-card-builder'
import type { DeviceCardAuthoringContext } from '@unilab/device-card-sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { createDeviceCardWorkspace } from './workspace'

const roots: string[] = []
const context: DeviceCardAuthoringContext = {
  schemaVersion: 'device-card-authoring-context/v1',
  deviceTypeId: 'virtual_device',
  deviceId: 'virtual_device_1',
  title: 'Virtual device',
  actions: [],
  stateSchema: { status: { type: 'string' } },
  sampleState: { status: 'idle' },
  media: []
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ))
})

describe('device card local workspace', () => {
  it('builds a safe snapshot and exports the exact checked source', async () => {
    const root = await temporaryRoot()
    const projectDir = join(root, 'card-project')
    await createProject(projectDir, validSource('First'))
    const statuses: string[] = []
    const workspace = await createDeviceCardWorkspace({
      projectDir,
      workRoot: join(root, 'workspaces'),
      authoringContext: context,
      watch: false,
      onStatus: (status) => statuses.push(status.state)
    })

    expect(workspace.getStatus()).toMatchObject({
      state: 'ready',
      projectName: 'card-project',
      card: {
        id: 'virtual-device.card',
        title: 'Virtual card'
      }
    })
    expect(statuses).toEqual(['building', 'ready'])

    const persisted = JSON.parse(
      await readFile(
        join(projectDir, '.unilab-card', 'diagnostics.json'),
        'utf8'
      )
    ) as { state: string; card?: { id: string } }
    expect(persisted).toMatchObject({
      state: 'ready',
      card: { id: 'virtual-device.card' }
    })

    const archivePath = join(root, 'virtual-card.ulcard')
    await workspace.exportSourceArchive(archivePath)
    const inspection = await inspectDeviceCardArchive(archivePath)
    expect(inspection.manifest.id).toBe('virtual-device.card')
    expect(inspection.files).toContain('src/card.ts')

    await workspace.close()
  })

  it('preserves the last preview but blocks stale install/export after an error', async () => {
    const root = await temporaryRoot()
    const projectDir = join(root, 'card-project')
    await createProject(projectDir, validSource('First'))
    const workspace = await createDeviceCardWorkspace({
      projectDir,
      workRoot: join(root, 'workspaces'),
      authoringContext: context,
      watch: false
    })
    const firstHash = workspace.getStatus().card?.sourceHash

    await writeFile(
      join(projectDir, 'src', 'card.ts'),
      `fetch('/forbidden')\n${validSource('Broken')}`,
      'utf8'
    )
    const failed = await workspace.rebuild()

    expect(failed.state).toBe('error')
    expect(failed.card?.sourceHash).toBe(firstHash)
    expect(failed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source.network_fetch' })
    ]))
    expect(() => workspace.getReadyArtifact()).toThrow(
      '尚未通过当前检查'
    )
    await expect(
      workspace.exportSourceArchive(join(root, 'stale.ulcard'))
    ).rejects.toThrow('尚未通过当前检查')

    await writeFile(
      join(projectDir, 'src', 'card.ts'),
      validSource('Recovered'),
      'utf8'
    )
    const recovered = await workspace.rebuild()
    expect(recovered.state).toBe('ready')
    expect(recovered.card?.sourceHash).not.toBe(firstHash)

    await workspace.close()
  })

  it('automatically rebuilds after an authorized source file changes', async () => {
    const root = await temporaryRoot()
    const projectDir = join(root, 'card-project')
    await createProject(projectDir, validSource('First'))
    const workspace = await createDeviceCardWorkspace({
      projectDir,
      workRoot: join(root, 'workspaces'),
      authoringContext: context
    })
    const firstHash = workspace.getStatus().card?.sourceHash

    await writeFile(
      join(projectDir, 'src', 'card.ts'),
      validSource('Watched change'),
      'utf8'
    )
    await waitFor(() => {
      const status = workspace.getStatus()
      return status.state === 'ready' &&
        status.card?.sourceHash !== firstHash
    })

    expect(workspace.getStatus()).toMatchObject({
      state: 'ready',
      diagnostics: []
    })
    await workspace.close()
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'unilab-card-workspace-'))
  roots.push(root)
  return root
}

async function createProject(
  projectDir: string,
  source: string
): Promise<void> {
  await mkdir(join(projectDir, 'src'), { recursive: true })
  await Promise.all([
    writeFile(
      join(projectDir, 'card.manifest.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        id: 'virtual-device.card',
        version: '0.1.0',
        title: 'Virtual card',
        deviceTypes: ['virtual_device'],
        sdkVersion: '^0.1.0',
        hostProtocolVersion: 1,
        authoringProfile: 'web-component-lite-v1',
        entry: 'src/card.ts',
        uiFeatures: ['core'],
        permissions: {
          state: ['status'],
          actions: [],
          media: []
        }
      }, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      join(projectDir, 'authoring-context.json'),
      `${JSON.stringify(context, null, 2)}\n`,
      'utf8'
    ),
    writeFile(join(projectDir, 'src', 'card.ts'), source, 'utf8')
  ])
}

function validSource(label: string): string {
  return `export default class CardElement extends HTMLElement {
  connectedCallback(): void {
    this.textContent = ${JSON.stringify(label)}
  }
}
`
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('等待本地工作区自动重建超时。')
}
