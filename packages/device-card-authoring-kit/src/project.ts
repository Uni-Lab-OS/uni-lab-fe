import type {
  DeviceCardAuthoringContext,
  DeviceCardAuthoringProfile,
  DeviceCardManifest
} from '@unilab/device-card-sdk'

import {
  DEVICE_CARD_SDK_VERSION,
  DEVICE_CARD_TOOLING_VERSION,
  SDK_DECLARATION,
  UI_ELEMENTS_DECLARATION,
  VUE_SHIM_DECLARATION
} from './catalog'
import type { DeviceCardProjectFiles } from './contracts'

export function createDeviceCardProjectFiles(
  context: DeviceCardAuthoringContext,
  profile: DeviceCardAuthoringProfile
): DeviceCardProjectFiles {
  const stateKeys = Object.keys(context.stateSchema).sort()
  const actions = context.actions.map((action) => action.action).sort()
  const manifest: DeviceCardManifest = {
    schemaVersion: 1,
    id: `${safeIdentifier(context.deviceTypeId)}.card`,
    version: '0.1.0',
    title: `${context.title}自定义卡片`,
    deviceTypes: [context.deviceTypeId],
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
      name: `${safeIdentifier(context.deviceTypeId)}-device-card`,
      version: '0.1.0',
      private: true,
      type: 'module',
      packageManager: 'pnpm@10.13.1',
      scripts: {
        check: 'unilab-card check .',
        dev: 'unilab-card dev .',
        test: 'unilab-card test .',
        build: 'unilab-card build .',
        pack: 'unilab-card pack .'
      },
      devDependencies: {
        '@unilab/device-card-tooling': DEVICE_CARD_TOOLING_VERSION
      }
    }),
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
    '.unilab-card/vue-shim.d.ts': VUE_SHIM_DECLARATION,
    [entryForProfile(profile)]: sourceForProfile(context, profile)
  }
}

export function createExampleAuthoringContext(): DeviceCardAuthoringContext {
  return {
    schemaVersion: 'device-card-authoring-context/v1',
    deviceTypeId: 'example_device',
    deviceId: 'example_device_1',
    title: '示例设备',
    actions: [{
      action: 'start',
      label: '启动',
      inputSchema: {},
      outputSchema: {}
    }],
    stateSchema: {
      status: { type: 'string' },
      temperature: { type: 'number' }
    },
    sampleState: {
      status: 'idle',
      temperature: 24.6
    },
    media: []
  }
}

function sourceForProfile(
  context: DeviceCardAuthoringContext,
  profile: DeviceCardAuthoringProfile
): string {
  const stateKeys = Object.keys(context.stateSchema).sort()
  const primaryState = stateKeys[0] ?? 'status'
  const secondaryState = stateKeys[1] ?? primaryState
  const action = context.actions[0]?.action
  const actionLabel = context.actions[0]?.label ?? action
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
- 禁止使用 Node.js、Electron、fetch、WebSocket、XMLHttpRequest、eval、Worker 和动态 import。
- 禁止新增 npm 依赖、运行第三方脚本或注册额外全局 Custom Element。
- Action 必须经 Host Bridge 调用，参数必须符合对应 JSON Schema。
- 权限变化必须同步修改 \`card.manifest.json\`。
- 必须支持 Mock 模式，并在交付前通过 \`pnpm check\`、\`pnpm test\` 和 \`pnpm pack\`。
- 不要编辑 \`.unilab-card/\` 中的 SDK 类型；重新导出 Kit 更新它们。
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

${Object.keys(context.stateSchema).sort().map((key) => `- \`${key}\``).join('\n') || '- 无'}

## Actions

${context.actions.map((action) => `- \`${action.action}\`：${action.label}`).join('\n') || '- 无'}

## 交付

上传的是 \`.ulcard\` 源码归档。Electron 会重新校验并使用固定 Builder 构建，
本地预览结果不是正式运行时权威。
`
}

function projectReadme(
  context: DeviceCardAuthoringContext,
  profile: DeviceCardAuthoringProfile
): string {
  return `# ${context.title}设备卡片

该项目由 Uni-Lab Authoring Kit 生成，Profile 为 \`${profile}\`。

\`\`\`bash
pnpm install --frozen-lockfile=false
pnpm dev
pnpm check
pnpm test
pnpm pack
\`\`\`

开发工具包版本固定为 \`${DEVICE_CARD_TOOLING_VERSION}\`。如果公司内部 npm
Registry 尚未发布该版本，请在 Uni-Lab 前端仓库中执行等价命令：

\`\`\`bash
pnpm card dev /absolute/path/to/this/card-project
pnpm card check /absolute/path/to/this/card-project
pnpm card pack /absolute/path/to/this/card-project
\`\`\`
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
