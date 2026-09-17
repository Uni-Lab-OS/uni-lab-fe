import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDeviceCard } from './build'
import { packDeviceCard, unpackDeviceCard } from './archive'

describe('device card entry paths', () => {
  const temporaryRoots: string[] = []

  /** 清理每个测试创建的卡片项目；无参数，完成后无返回值。 */
  afterEach(async () => {
    for (const root of temporaryRoots.splice(0)) {
      await rm(root, { recursive: true, force: true })
    }
  })

  /**
   * 证明构建器能从当前操作系统的绝对项目路径加载卡片入口。
   * Windows 上该入口会是 `C:\...` 形式，不得被误判为第三方包名。
  */
  it('builds an entry resolved from a native absolute project path', async () => {
    const testRoot = resolve('.scratch')
    await mkdir(testRoot, { recursive: true })
    const projectDir = await mkdtemp(join(testRoot, 'unilab-card-build-'))
    const outDir = join(projectDir, 'dist')
    temporaryRoots.push(projectDir)
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await Promise.all([
      writeFile(
        join(projectDir, 'card.manifest.json'),
        JSON.stringify({
          schemaVersion: 1,
          id: 'test.absolute-path.card',
          version: '0.1.0',
          title: '绝对路径回归卡片',
          deviceTypes: ['test.absolute-path.device'],
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
        join(projectDir, 'src', 'index.ts'),
        'export default class AbsolutePathCard extends HTMLElement {}\n',
        'utf8'
      )
    ])

    const result = await buildDeviceCard({
      projectDir,
      outDir,
      development: true
    })

    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('builds a domain card that references templateCard without local entry', async () => {
    const testRoot = resolve('.scratch')
    await mkdir(testRoot, { recursive: true })
    const monorepoRoot = await mkdtemp(join(testRoot, 'unilab-template-card-'))
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
        join(templateDir, 'src', 'index.ts'),
        'export default class TemplateCard extends HTMLElement {}\n',
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

    const result = await buildDeviceCard({
      projectDir: domainDir,
      outDir: join(domainDir, 'dist'),
      development: true
    })

    expect(result.diagnostics.filter((item) => item.severity === 'error'))
      .toEqual([])
    expect(result.ok).toBe(true)
    expect(result.metadata?.manifest.id).toBe('community.demo_workspace.robot.card')
  })

  it('builds templateCard from packed overlay on a different drive than template', async () => {
    const testRoot = resolve('.scratch')
    await mkdir(testRoot, { recursive: true })
    const monorepoRoot = await mkdtemp(join(testRoot, 'unilab-template-pack-'))
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
        join(templateDir, 'src', 'index.ts'),
        `import { getDeviceCardBridge } from '@unilab/device-card-sdk'
import '@unilab/device-card-ui/register'
export default class TemplateCard extends HTMLElement {
  connectedCallback(): void {
    void getDeviceCardBridge()
  }
}
`,
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

    const packRoot = await mkdtemp(join(tmpdir(), 'unilab-card-pack-'))
    temporaryRoots.push(packRoot)
    const archivePath = join(packRoot, 'source.ulcard')
    const packedProjectDir = join(packRoot, 'source')
    await packDeviceCard(domainDir, archivePath)
    await unpackDeviceCard(archivePath, packedProjectDir)

    const result = await buildDeviceCard({
      projectDir: packedProjectDir,
      templateAnchorDir: domainDir,
      outDir: join(packRoot, 'artifact'),
      development: true
    })

    expect(result.diagnostics.filter((item) => item.severity === 'error'))
      .toEqual([])
    expect(result.ok).toBe(true)
  })

  it('narrows templateCard permissions to the host device catalog', async () => {
    const testRoot = resolve('.scratch')
    await mkdir(testRoot, { recursive: true })
    const monorepoRoot = await mkdtemp(join(testRoot, 'unilab-template-host-'))
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
          permissions: {
            state: ['online', 'moveit_online'],
            actions: ['home', 'read_debug_snapshot'],
            media: []
          }
        }),
        'utf8'
      ),
      writeFile(
        join(templateDir, 'src', 'index.ts'),
        'export default class TemplateCard extends HTMLElement {}\n',
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

    const result = await buildDeviceCard({
      projectDir: domainDir,
      outDir: join(domainDir, 'dist'),
      development: true,
      contextAuthority: 'host',
      authoringContext: {
        schemaVersion: 'device-card-authoring-context/v1',
        deviceTypeId: 'community.demo_workspace.robot',
        deviceId: 'robot_1',
        title: 'Preview robot',
        actions: [
          {
            action: 'home',
            label: 'Home',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            riskLevel: 'dangerous'
          }
        ],
        stateSchema: {
          online: { type: 'boolean', source: 'host', status: 'resolved' }
        },
        sampleState: { online: true },
        media: []
      }
    })

    expect(result.diagnostics.filter((item) => item.severity === 'error'))
      .toEqual([])
    expect(result.ok).toBe(true)
    expect(result.metadata?.manifest.permissions.actions).toEqual(['home'])
    expect(result.metadata?.manifest.permissions.state).toEqual(['online'])
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'context.action_unavailable' }),
      expect.objectContaining({ code: 'context.state_unavailable' })
    ]))
  })
})
