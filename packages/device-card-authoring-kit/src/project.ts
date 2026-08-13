import type {
  DeviceCardAuthoringContext,
  DeviceCardAuthoringProfile,
  DeviceCardManifest
} from '@unilab/device-card-sdk'
import {
  createDeviceCardDefinitionTarget,
  deviceCardRealtimeStateKeys
} from '@unilab/device-card-sdk'

import {
  DEVICE_CARD_SDK_VERSION,
  FRAMEWORK_DECLARATION,
  SDK_DECLARATION,
  UI_ELEMENTS_DECLARATION,
  VUE_SHIM_DECLARATION
} from './catalog'
import type { DeviceCardProjectFiles } from './contracts'
import {
  deviceCardPresentationStateKeys,
  isDeviceCardScalarStateDefinition
} from './stateSelection'

/**
 * 为当前领域设备包定义生成一个 v2 设备卡源码项目。
 *
 * @param context Host 提供的 v2 设备卡开发上下文。
 * @param profile 选定的前端开发 Profile。
 * @returns 相对路径到确定性文本内容的项目文件映射。
 */
export function createDeviceCardProjectFiles(
  context: DeviceCardAuthoringContext,
  profile: DeviceCardAuthoringProfile
): DeviceCardProjectFiles {
  if (context.schemaVersion !== 'device-card-authoring-context/v2') {
    throw new Error('新建设备卡片必须使用 PackageCatalog Authoring Context v2。')
  }
  const stateKeys = deviceCardRealtimeStateKeys(context.stateSchema)
  const actions = context.actions.map((action) => action.action).sort()
  const manifest: DeviceCardManifest = {
    schemaVersion: 2,
    id: `${safeIdentifier(context.definition.fqid)}.card`,
    version: '0.1.0',
    title: `${context.title}自定义卡片`,
    targets: [createDeviceCardDefinitionTarget(context.definition)],
    sdkVersion: `^${DEVICE_CARD_SDK_VERSION}`,
    hostProtocolVersion: 1,
    authoringProfile: profile,
    entry: entryForProfile(profile),
    uiFeatures: ['core'],
    permissions: {
      state: stateKeys,
      actions,
      media: [...context.media].sort()
    },
    config: {
      version: 1,
      defaults: {},
      schema: {}
    }
  }
  return {
    'package.json': json({
      name: `${safeIdentifier(context.definition.fqid)}-device-card`,
      version: '0.1.0',
      private: true,
      type: 'module',
      unilab: {
        developmentWorkflow: 'electron-workspace',
        hostProtocolVersion: 1
      }
    }),
    '.gitignore': `.unilab-card/diagnostics.json*
`,
    'tsconfig.json': json({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        jsx: 'react-jsx',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        types: []
      },
      include: ['src/**/*', '.unilab-card/**/*.d.ts']
    }),
    'card.manifest.json': json(manifest),
    'authoring-context.json': json(context),
    'mock.json': json(context.sampleState),
    'AGENTS.md': agentRules(context),
    'CARD_SPEC.md': cardSpec(context, profile),
    'README.md': projectReadme(context, profile),
    '.unilab-card/sdk.d.ts': SDK_DECLARATION,
    '.unilab-card/ui-elements.d.ts': UI_ELEMENTS_DECLARATION,
    '.unilab-card/framework.d.ts': FRAMEWORK_DECLARATION,
    '.unilab-card/vue-shim.d.ts': VUE_SHIM_DECLARATION,
    [entryForProfile(profile)]: sourceForProfile(context, profile)
  }
}

/**
 * 构造命令行和离线模板使用的完整示例开发上下文。
 *
 * @returns 带有效 FQID 与摘要格式的 v2 示例上下文。
 */
export function createExampleAuthoringContext(): DeviceCardAuthoringContext {
  return {
    schemaVersion: 'device-card-authoring-context/v2',
    definition: exampleDeviceDefinition(),
    deviceTypeId: 'community.example_device.example_device',
    deviceId: 'example_device_1',
    title: '示例设备',
    actions: [{
      action: 'start',
      label: '启动',
      inputSchema: {},
      outputSchema: {},
      riskLevel: 'normal'
    }],
    stateSchema: {
      status: { type: 'string', source: 'driver', status: 'resolved' },
      temperature: { type: 'number', source: 'driver', status: 'resolved' }
    },
    sampleState: {
      status: 'idle',
      temperature: 24.6
    },
    media: []
  }
}

/**
 * 构造离线示例使用的完整领域设备包定义引用。
 *
 * @returns 只用于脚手架演示、摘要格式真实有效的 PackageCatalog 定义证据。
 */
function exampleDeviceDefinition() {
  return {
    fqid: 'community.example_device.example_device',
    version: '1.0.0',
    contentHash: `sha256:${'1'.repeat(64)}`,
    sourceIdentity: 'example_device.devices.example:ExampleDevice',
    title: '示例设备',
    description: '离线脚手架示例',
    category: ['example'],
    manufacturer: 'Uni-Lab',
    packageCatalog: {
      schemaVersion: '1' as const,
      distribution: {
        name: 'example-device',
        normalizedName: 'example_device',
        version: '0.1.0'
      },
      importPackage: 'example_device',
      namespace: 'community.example_device',
      contentDigest: `sha256:${'2'.repeat(64)}`,
      catalogDigest: `sha256:${'3'.repeat(64)}`
    }
  }
}

function sourceForProfile(
  context: DeviceCardAuthoringContext,
  profile: DeviceCardAuthoringProfile
): string {
  const stateKeys = deviceCardRealtimeStateKeys(context.stateSchema)
  const presentationStateKeys = deviceCardPresentationStateKeys(
    context.stateSchema
  )
  const primaryState = presentationStateKeys[0]
  const action = context.actions[0]?.action
  const actionLabel = context.actions[0]?.label ?? action
  if (!primaryState) {
    if (profile === 'vue-web-component-v1') {
      return `<template>
  <u-card title="${escapeHtml(context.title)}" subtitle="Vue → Web Component">
    <p>设备未声明可订阅的实时状态。</p>
    ${action ? `<u-action-button action="${escapeHtml(action)}">${escapeHtml(actionLabel ?? action)}</u-action-button>` : ''}
  </u-card>
</template>
`
    }
    if (profile === 'react-web-component-v1') {
      return `export default function Card(): React.JSX.Element {
  return (
    <u-card title=${JSON.stringify(context.title)} subtitle="React → Web Component">
      <p>设备未声明可订阅的实时状态。</p>
      ${action ? `<u-action-button action=${JSON.stringify(action)}>${escapeHtml(actionLabel ?? action)}</u-action-button>` : ''}
    </u-card>
  )
}
`
    }
    return `export default class DeviceCardElement extends HTMLElement {
  connectedCallback(): void {
    this.innerHTML = \`
      <u-card title="${escapeHtml(context.title)}" subtitle="Web Component Lite">
        <p>设备未声明可订阅的实时状态。</p>
        ${action ? `<u-action-button action="${escapeHtml(action)}">${escapeHtml(actionLabel ?? action)}</u-action-button>` : ''}
      </u-card>
    \`
  }
}
`
  }
  const secondaryState = presentationStateKeys.slice(1).find((key) =>
    isDeviceCardScalarStateDefinition(context.stateSchema[key])
  ) ?? primaryState
  if (profile === 'vue-web-component-v1') {
    return `<script setup lang="ts">
import { computed } from 'vue'
import { useDeviceCard } from '@unilab/device-card-sdk/vue'

const card = useDeviceCard({ state: ${JSON.stringify(stateKeys)} })
const primaryValue = computed(() => String(card.state[${JSON.stringify(primaryState)}] ?? '—'))
const secondaryValue = computed(() => String(card.state[${JSON.stringify(secondaryState)}] ?? '—'))
</script>

<template>
  <u-card title="${escapeHtml(context.title)}" subtitle="Vue → Web Component">
    <u-status label="${escapeHtml(primaryState)}" :value="primaryValue" />
    <u-metric
      label="${escapeHtml(secondaryState)}"
      :value="secondaryValue"
    />
    ${action ? `<u-action-button action="${escapeHtml(action)}">${escapeHtml(actionLabel ?? action)}</u-action-button>` : ''}
  </u-card>
</template>
`
  }
  if (profile === 'react-web-component-v1') {
    return `import { useDeviceCard } from '@unilab/device-card-sdk/react'

export default function Card(): React.JSX.Element {
  const card = useDeviceCard({ state: ${JSON.stringify(stateKeys)} })
  return (
    <u-card title=${JSON.stringify(context.title)} subtitle="React → Web Component">
      <u-status
        label=${JSON.stringify(primaryState)}
        value={String(card.state[${JSON.stringify(primaryState)}] ?? '—')}
      />
      <u-metric
        label=${JSON.stringify(secondaryState)}
        value={String(card.state[${JSON.stringify(secondaryState)}] ?? '—')}
      />
      ${action ? `<u-action-button action=${JSON.stringify(action)}>${escapeHtml(actionLabel ?? action)}</u-action-button>` : ''}
    </u-card>
  )
}
`
  }
  return `import { getDeviceCardBridge } from '@unilab/device-card-sdk'

export default class DeviceCardElement extends HTMLElement {
  private unsubscribe: (() => void) | null = null

  async connectedCallback(): Promise<void> {
    const bridge = getDeviceCardBridge()
    const context = await bridge.getContext()
    this.render(context.state)
    this.unsubscribe = bridge.subscribeState(
      ${JSON.stringify(stateKeys)},
      (state) => this.render(state)
    )
  }

  disconnectedCallback(): void {
    this.unsubscribe?.()
  }

  private render(state: Record<string, unknown>): void {
    this.innerHTML = \`
      <u-card title="${escapeHtml(context.title)}" subtitle="Web Component Lite">
        <u-status
          label="${escapeHtml(primaryState)}"
          value="\${String(state[${JSON.stringify(primaryState)}] ?? '—')}"
        ></u-status>
        ${action ? `<u-action-button action="${escapeHtml(action)}">${escapeHtml(actionLabel ?? action)}</u-action-button>` : ''}
      </u-card>
    \`
  }
}
`
}

function agentRules(context: DeviceCardAuthoringContext): string {
  return `# Uni-Lab Device Card Agent Rules

本目录只开发 ${context.title}（\`${context.deviceTypeId}\`）的设备卡片。

- 只使用 \`@unilab/device-card-sdk\`、固定 Vue/React 运行时和 Kit 中列出的 \`u-*\` 元素。
- 只能读取 \`authoring-context.json\` 中声明的状态、Action 和媒体。
- \`stateSchema\` 只表示 Host Bridge 可订阅的正式状态；Action 输入和输出绝不是设备实时状态。
- 禁止把 \`source: action-inferred/runtime-sample\` 或 \`status: unresolved\` 的兼容字段加入状态权限或实时面板。
- \`authoring-context.json\` 说明可用能力，\`mock.json\` 是预览样本；二者都不是运行时实时状态来源。
- 运行态只能通过 SDK 获取：原生 Web Component 使用 Host Bridge 的 \`getContext()\` 和 \`subscribeState()\`，Vue/React 使用对应的 \`useDeviceCard()\`。禁止自行连接设备接口或 WebSocket。
- 禁止使用 Node.js、Electron、fetch、WebSocket、XMLHttpRequest、eval、Worker 和动态 import。
- 禁止新增 npm 依赖、运行第三方脚本或注册额外全局 Custom Element。
- Action 必须通过 Host Bridge 的 \`callAction()\`（或 \`useDeviceCard()\` 返回的 \`callAction()\`）调用，名称和参数必须严格符合对应 JSON Schema。
- 界面必须处理离线、未知状态、\`actionBusy\`、Action 失败和 Mock/Live 两种模式；原生订阅必须在组件销毁时取消。
- 权限变化必须同步修改 \`card.manifest.json\`。
- 必须支持 Mock 模式，并保持 Electron“本地开发工作区”的自动检查通过。
- 每次保存后读取 \`.unilab-card/diagnostics.json\`；存在 error 时继续修复。
- 不要编辑 \`.unilab-card/\` 中的 SDK 类型或诊断文件；重新导出 Kit 更新类型。
`
}

function cardSpec(
  context: DeviceCardAuthoringContext,
  profile: DeviceCardAuthoringProfile
): string {
  return `# Card Specification

- Device Type: \`${context.deviceTypeId}\`
- Device Instance: \`${context.deviceId ?? '未绑定'}\`
- Authoring Profile: \`${profile}\`
- Host Protocol: \`1\`
- SDK: \`^${DEVICE_CARD_SDK_VERSION}\`

## 状态字段

${deviceCardRealtimeStateKeys(context.stateSchema).map((key) => `- \`${key}\``).join('\n') || '- 无（仅可开发 Action 控制，不得虚构实时状态）'}

Action 输入只属于调用草稿，Action 输出只属于该次调用结果；两者不得作为实时状态订阅。

## Actions

${context.actions.map((action) => `- \`${action.action}\`：${action.label}`).join('\n') || '- 无'}

## 交付

Electron 从用户授权目录创建受限源码快照。用户可以直接安装当前源码，也可以导出
\`.ulcard\` 供其他 Electron 导入；两条路径都会重新校验并使用固定 Builder
权威构建，开发预览结果不等于正式运行结果。
`
}

function projectReadme(
  context: DeviceCardAuthoringContext,
  profile: DeviceCardAuthoringProfile
): string {
  return `# ${context.title}设备卡片

该项目由 Uni-Lab Authoring Kit 生成，Profile 为 \`${profile}\`。

无需执行 \`pnpm install\`，也不依赖 npm Registry。

1. 在 Cursor、Codex 或 VS Code 中打开本目录。
2. 在 Uni-Lab Electron 的“设备卡片”页点击“打开源码目录”并选择本目录。
3. Electron 使用内置固定 Builder 自动检查、构建并刷新隔离预览。
4. Coding Agent 可读取 \`.unilab-card/diagnostics.json\` 获取结构化诊断。
5. 检查通过后，在 Electron 中安装当前源码或导出 \`.ulcard\`。

如果已从 Electron 安装 \`unilab-card-agent\`，Agent 也可以运行：

\`\`\`bash
unilab-card-agent workspace status --project . --wait --json
\`\`\`

CLI 只连接 Electron Local Authoring Bridge，不包含 Builder，也不会安装 npm 依赖。

Electron 只会写入受管理的诊断文件，不会修改 \`src/\`、Manifest 或业务文档。
`
}

function entryForProfile(profile: DeviceCardAuthoringProfile): string {
  if (profile === 'vue-web-component-v1') return 'src/card.vue'
  if (profile === 'react-web-component-v1') return 'src/card.tsx'
  return 'src/card.ts'
}

function safeIdentifier(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
  return normalized || 'unilab-device'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
