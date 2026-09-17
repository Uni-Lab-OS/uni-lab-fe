import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveTemplateCardAuthoringPreview } from './templateCard'

describe('template card authoring preview', () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    for (const root of temporaryRoots.splice(0)) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('inherits authoring-context.json from the referenced template card', async () => {
    const testRoot = resolve('.scratch')
    await mkdir(testRoot, { recursive: true })
    const monorepoRoot = await mkdtemp(join(testRoot, 'unilab-template-preview-'))
    temporaryRoots.push(monorepoRoot)

    const templateDir = join(
      monorepoRoot,
      'unilab_robot_template/frontend/cards/demo-template-card'
    )
    const domainDir = join(
      monorepoRoot,
      'demo-workspace/frontend/cards/demo-ref-card'
    )
    await mkdir(join(templateDir, 'src'), { recursive: true })
    await mkdir(domainDir, { recursive: true })

    await Promise.all([
      writeFile(
        join(templateDir, 'card.manifest.json'),
        JSON.stringify({
          schemaVersion: 1,
          id: 'community.unilab_robot_template.demo.card',
          version: '0.1.0',
          title: 'Template Card',
          deviceTypes: [],
          sdkVersion: '^0.1.0',
          hostProtocolVersion: 1,
          authoringProfile: 'web-component-lite-v1',
          entry: 'src/index.ts',
          uiFeatures: [],
          permissions: { state: [], actions: [], media: [] }
        }),
        'utf8'
      ),
      writeFile(
        join(templateDir, 'authoring-context.json'),
        JSON.stringify({
          schemaVersion: 'device-card-authoring-context/v1',
          deviceTypeId: 'community.unilab_robot_template.demo',
          deviceId: 'demo_template',
          title: 'Template Card',
          actions: [{
            action: 'home',
            label: 'Home',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            riskLevel: 'dangerous'
          }],
          stateSchema: {
            online: { type: 'boolean', source: 'host', status: 'resolved' }
          },
          sampleState: { online: true },
          media: []
        }),
        'utf8'
      ),
      writeFile(
        join(templateDir, 'mock.json'),
        JSON.stringify({ moveit_online: true }),
        'utf8'
      ),
      writeFile(
        join(domainDir, 'card.manifest.json'),
        JSON.stringify({
          schemaVersion: 1,
          id: 'community.demo_workspace.robot.card',
          version: '0.1.0',
          title: 'Domain Ref Card',
          deviceTypes: ['community.demo_workspace.robot'],
          hostProtocolVersion: 1,
          templateCard: 'unilab_robot_template/frontend/cards/demo-template-card'
        }),
        'utf8'
      )
    ])

    const preview = await resolveTemplateCardAuthoringPreview(domainDir)

    expect(preview).toMatchObject({
      authoringContext: {
        deviceTypeId: 'community.demo_workspace.robot',
        deviceId: 'robot',
        title: 'Domain Ref Card'
      },
      mockState: { moveit_online: true }
    })
  })
})
