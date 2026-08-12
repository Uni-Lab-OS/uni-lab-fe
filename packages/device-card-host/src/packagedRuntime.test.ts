import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DeviceCardAuthoringContext } from '@unilab/device-card-sdk'
import { afterEach, describe, expect, it } from 'vitest'

import type { createDeviceCardWorkspace as CreateWorkspace } from './workspace'

const runtimeRequire = createRequire(import.meta.url)
const packagedHost = runtimeRequire('../dist/index.cjs') as {
  createDeviceCardWorkspace: typeof CreateWorkspace
  installDeviceCardArchive: typeof import('./index').installDeviceCardArchive
}
const roots: string[] = []
const context: DeviceCardAuthoringContext = {
  schemaVersion: 'device-card-authoring-context/v1',
  deviceTypeId: 'virtual_device',
  deviceId: 'virtual_device_1',
  title: 'Virtual device',
  actions: [],
  stateSchema: {
    status: { type: 'string', source: 'driver', status: 'resolved' }
  },
  sampleState: { status: 'idle' },
  media: []
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ))
})

describe('packaged device card browser runtime', () => {
  /** 验证预编译运行库仍支持 Vue 与 React 两种正式创作协议。 */
  it('builds Vue and React cards without published framework packages', async () => {
    const fixtures = [
      {
        entry: 'src/card.vue',
        marker: 'Vue packaged smoke',
        profile: 'vue-web-component-v1',
        source: `<script setup lang="ts">
import { computed } from 'vue'
import { useDeviceCard } from '@unilab/device-card-sdk/vue'
const card = useDeviceCard({ state: ['status'] })
const status = computed(() => String(card.state.status ?? '—'))
</script>
<template>
  <u-card title="Vue packaged smoke">
    <u-status label="status" :value="status" />
  </u-card>
</template>
`
      },
      {
        entry: 'src/card.tsx',
        marker: 'React packaged smoke',
        profile: 'react-web-component-v1',
        source: `import { useDeviceCard } from '@unilab/device-card-sdk/react'

export default function Card(): React.JSX.Element {
  const card = useDeviceCard({ state: ['status'] })
  return <u-card title="React packaged smoke">
    <u-status label="status" value={String(card.state.status ?? '—')} />
  </u-card>
}
`
      }
    ] as const

    for (const fixture of fixtures) {
      const root = await temporaryRoot()
      const projectDir = join(root, 'project')
      await createProject(projectDir, fixture)
      const workspace = await packagedHost.createDeviceCardWorkspace({
        projectDir,
        workRoot: join(root, 'workspaces'),
        authoringContext: context,
        watch: false
      })
      try {
        expect(workspace.getStatus()).toMatchObject({ state: 'ready' })
        const artifact = workspace.getReadyArtifact()
        const entry = await readFile(join(artifact.artifactDir, 'entry.js'))
        expect(entry.toString('utf8')).toContain(fixture.marker)

        const archivePath = join(root, `${fixture.profile}.ulcard`)
        await workspace.exportSourceArchive(archivePath)
        const installed = await packagedHost.installDeviceCardArchive({
          archivePath,
          storeRoot: join(root, 'installed'),
          authoringContext: context,
          contextAuthority: 'host'
        })
        const installedEntry = await readFile(
          join(installed.artifactDir, 'entry.js'),
          'utf8'
        )
        expect(installedEntry).toContain(fixture.marker)
      } finally {
        await workspace.close()
      }
    }
  })
})

/** 创建单个测试专属的临时根目录。 */
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'unilab-packaged-card-'))
  roots.push(root)
  return root
}

/**
 * 写入最小但完整的设备卡源码工程。
 * @param projectDir 工程根目录。
 * @param fixture 创作协议、入口与源码。
 */
async function createProject(
  projectDir: string,
  fixture: {
    readonly entry: string
    readonly marker: string
    readonly profile: 'vue-web-component-v1' | 'react-web-component-v1'
    readonly source: string
  }
): Promise<void> {
  await mkdir(join(projectDir, 'src'), { recursive: true })
  await Promise.all([
    writeFile(
      join(projectDir, 'card.manifest.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        id: `virtual-device.${fixture.profile}`,
        version: '0.1.0',
        title: 'Packaged runtime smoke',
        deviceTypes: ['virtual_device'],
        sdkVersion: '^0.1.0',
        hostProtocolVersion: 1,
        authoringProfile: fixture.profile,
        entry: fixture.entry,
        uiFeatures: ['core'],
        permissions: { state: ['status'], actions: [], media: [] }
      }, null, 2)}\n`,
      'utf8'
    ),
    writeFile(
      join(projectDir, 'authoring-context.json'),
      `${JSON.stringify(context, null, 2)}\n`,
      'utf8'
    ),
    writeFile(join(projectDir, fixture.entry), fixture.source, 'utf8')
  ])
}
