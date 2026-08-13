import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import {
  createDeviceCardAuthoringKit,
  createExampleAuthoringContext
} from './index'

const generatedAt = '2026-07-31T00:00:00.000Z'

describe('createDeviceCardAuthoringKit', () => {
  it('creates the complete selected project, contracts, templates and examples', async () => {
    const result = await createDeviceCardAuthoringKit({
      context: createExampleAuthoringContext(),
      profile: 'vue-web-component-v1',
      generatedAt
    })
    const entries = unzipSync(result.archive)
    const root = `${result.rootDirectory}/`

    expect(result.fileName).toBe(
      'community.example_device.example_device.unilab-card-kit.zip'
    )
    expect(Object.keys(entries)).toEqual(expect.arrayContaining([
      `${root}README.md`,
      `${root}AGENTS.md`,
      `${root}CARD_SPEC.md`,
      `${root}kit-metadata.json`,
      `${root}authoring-context.json`,
      `${root}card-manifest.schema.json`,
      `${root}ui-catalog.json`,
      `${root}sdk/index.d.ts`,
      `${root}sdk/ui-elements.d.ts`,
      `${root}sdk/framework.d.ts`,
      `${root}sdk/vue-shim.d.ts`,
      `${root}mocks/default-state.json`,
      `${root}card-project/card.manifest.json`,
      `${root}card-project/src/card.vue`,
      `${root}templates/vue-web-component/src/card.vue`,
      `${root}templates/react-web-component/src/card.tsx`,
      `${root}templates/web-component-lite/src/card.ts`,
      `${root}examples/status-card/card.vue`,
      `${root}examples/action-card/card.vue`,
      `${root}examples/rack-card/card.vue`,
      `${root}examples/trend-card/card.vue`
    ]))

    const metadata = JSON.parse(
      new TextDecoder().decode(entries[`${root}kit-metadata.json`])
    ) as Record<string, unknown>
    expect(metadata).toMatchObject({
      kitVersion: 1,
      generatedAt,
      definitionFqid: 'community.example_device.example_device',
      deviceTypeId: 'community.example_device.example_device',
      authoringProfile: 'vue-web-component-v1',
      hostProtocolVersion: 1
    })
    expect(metadata.authoringContextDigest).toMatch(/^[0-9a-f]{64}$/)

    const manifest = JSON.parse(
      new TextDecoder().decode(
        entries[`${root}card-project/card.manifest.json`]
      )
    ) as {
      targets: Array<{ definitionFqid: string }>
      permissions: { state: string[]; actions: string[] }
    }
    expect(manifest.targets).toEqual([
      expect.objectContaining({
        definitionFqid: 'community.example_device.example_device'
      })
    ])
    expect(manifest.permissions.state).toEqual(['status', 'temperature'])
    expect(manifest.permissions.actions).toEqual(['start'])

    const packageJson = JSON.parse(
      new TextDecoder().decode(
        entries[`${root}card-project/package.json`]
      )
    ) as {
      devDependencies?: Record<string, string>
      unilab?: { developmentWorkflow?: string }
    }
    expect(packageJson.devDependencies).toBeUndefined()
    expect(packageJson.unilab?.developmentWorkflow)
      .toBe('electron-workspace')
  })

  it('is deterministic when the context and generation time are fixed', async () => {
    const input = {
      context: createExampleAuthoringContext(),
      profile: 'react-web-component-v1' as const,
      generatedAt
    }
    const first = await createDeviceCardAuthoringKit(input)
    const second = await createDeviceCardAuthoringKit(input)

    expect(first.archive).toEqual(second.archive)
    expect(first.metadata.authoringContextDigest)
      .toBe(second.metadata.authoringContextDigest)
  })

  it('rejects invalid context instead of creating a misleading kit', async () => {
    const context = createExampleAuthoringContext()
    context.actions.push({ ...context.actions[0] })

    await expect(createDeviceCardAuthoringKit({
      context,
      profile: 'vue-web-component-v1',
      generatedAt
    })).rejects.toThrow('无效或重复')
  })
})
