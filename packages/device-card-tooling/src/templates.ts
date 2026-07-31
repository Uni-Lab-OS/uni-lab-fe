export type StarterProfile = 'vue' | 'react' | 'lite'

export function starterFiles(
  profile: StarterProfile
): Record<string, string> {
  const profileName = profile === 'vue'
    ? 'vue-web-component-v1'
    : profile === 'react'
      ? 'react-web-component-v1'
      : 'web-component-lite-v1'
  const entry = profile === 'vue'
    ? 'src/card.vue'
    : profile === 'react'
      ? 'src/card.tsx'
      : 'src/card.ts'
  return {
    'card.manifest.json': `${JSON.stringify({
      schemaVersion: 1,
      id: 'example.device.card',
      version: '0.1.0',
      title: '设备自定义卡片',
      deviceTypes: ['example_device'],
      sdkVersion: '^0.1.0',
      hostProtocolVersion: 1,
      authoringProfile: profileName,
      entry,
      uiFeatures: ['core'],
      permissions: {
        state: ['status', 'temperature'],
        actions: ['start'],
        media: []
      },
      config: {
        version: 1,
        defaults: {},
        schema: {}
      }
    }, null, 2)}\n`,
    'authoring-context.json': `${JSON.stringify({
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
    }, null, 2)}\n`,
    [entry]: sourceFor(profile),
    'README.md': `# Uni-Lab 设备卡片

该项目由 \`unilab-card init\` 生成。卡片不能直接访问网络或 Node.js，只能通过
\`@unilab/device-card-sdk\` 的 Host Bridge 读取状态和调用 manifest 已授权的 Action。

\`\`\`bash
unilab-card check .
unilab-card dev .
unilab-card test .
unilab-card pack .
\`\`\`
`
  }
}

function sourceFor(profile: StarterProfile): string {
  if (profile === 'vue') {
    return `<script setup lang="ts">
import { computed } from 'vue'
import { useDeviceCard } from '@unilab/device-card-sdk/vue'

const card = useDeviceCard({ state: ['status', 'temperature'] })
const temperature = computed(() => String(card.state.temperature ?? '—'))
</script>

<template>
  <u-card title="示例设备" subtitle="Vue → Web Component">
    <div class="metrics">
      <u-status label="状态" :value="String(card.state.status ?? 'unknown')" />
      <u-metric label="温度" :value="temperature" unit="°C" />
    </div>
    <u-action-button action="start">启动</u-action-button>
  </u-card>
</template>

<style>
.metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
</style>
`
  }
  if (profile === 'react') {
    return `import { useDeviceCard } from '@unilab/device-card-sdk/react'

export default function Card(): React.JSX.Element {
  const card = useDeviceCard({ state: ['status', 'temperature'] })
  return (
    <u-card title="示例设备" subtitle="React → Web Component">
      <u-status label="状态" value={String(card.state.status ?? 'unknown')} />
      <u-metric
        label="温度"
        value={String(card.state.temperature ?? '—')}
        unit="°C"
      />
      <u-action-button action="start">启动</u-action-button>
    </u-card>
  )
}
`
  }
  return `import { getDeviceCardBridge } from '@unilab/device-card-sdk'

export default class ExampleDeviceCard extends HTMLElement {
  private unsubscribe: (() => void) | null = null

  async connectedCallback(): Promise<void> {
    const bridge = getDeviceCardBridge()
    const context = await bridge.getContext()
    this.render(context.state)
    this.unsubscribe = bridge.subscribeState(
      ['status', 'temperature'],
      (state) => this.render(state)
    )
  }

  disconnectedCallback(): void {
    this.unsubscribe?.()
  }

  private render(state: Record<string, unknown>): void {
    this.innerHTML = \`
      <u-card title="示例设备" subtitle="Web Component Lite">
        <u-status label="状态" value="\${String(state.status ?? 'unknown')}"></u-status>
        <u-metric label="温度" value="\${String(state.temperature ?? '—')}" unit="°C"></u-metric>
        <u-action-button action="start">启动</u-action-button>
      </u-card>
    \`
  }
}
`
}
