import {
  strToU8,
  zipSync,
  type Zippable
} from 'fflate'
import type {
  DeviceCardAuthoringContext,
  DeviceCardAuthoringProfile
} from '@unilab/device-card-sdk'

import {
  CARD_MANIFEST_SCHEMA,
  DEVICE_CARD_SDK_VERSION,
  DEVICE_CARD_TOOLING_VERSION,
  DEVICE_CARD_UI_CATALOG,
  DEVICE_CARD_UI_CATALOG_VERSION,
  SDK_DECLARATION,
  UI_ELEMENTS_DECLARATION,
  VUE_SHIM_DECLARATION
} from './catalog'
import type {
  CreateDeviceCardAuthoringKitInput,
  DeviceCardAuthoringKitMetadata,
  GeneratedDeviceCardAuthoringKit
} from './contracts'
import { createDeviceCardProjectFiles } from './project'

const MAX_KIT_BYTES = 10 * 1024 * 1024
const ZIP_MTIME = new Date('1980-01-01T00:00:00.000Z')
const PROFILES: readonly DeviceCardAuthoringProfile[] = [
  'vue-web-component-v1',
  'react-web-component-v1',
  'web-component-lite-v1'
]

export async function createDeviceCardAuthoringKit(
  input: CreateDeviceCardAuthoringKitInput
): Promise<GeneratedDeviceCardAuthoringKit> {
  assertContext(input.context)
  if (!PROFILES.includes(input.profile)) {
    throw new Error(`不支持的卡片开发 Profile：${String(input.profile)}`)
  }
  const generatedAt = normalizeGeneratedAt(input.generatedAt)
  const rootDirectory = `${safePathSegment(input.context.deviceTypeId)}.unilab-card-kit`
  const canonicalContext = stringifyStable(input.context)
  const metadata: DeviceCardAuthoringKitMetadata = {
    kitVersion: 1,
    generatedAt,
    deviceTypeId: input.context.deviceTypeId,
    ...(input.context.deviceId ? { deviceId: input.context.deviceId } : {}),
    authoringProfile: input.profile,
    authoringContextDigest: await sha256(canonicalContext),
    sdkVersion: DEVICE_CARD_SDK_VERSION,
    toolingVersion: DEVICE_CARD_TOOLING_VERSION,
    hostProtocolVersion: 1,
    uiCatalogVersion: DEVICE_CARD_UI_CATALOG_VERSION
  }
  const files = kitFiles(input.context, input.profile, metadata)
  const entries: Zippable = {}
  for (const path of Object.keys(files).sort()) {
    entries[`${rootDirectory}/${path}`] = [
      strToU8(files[path]),
      { mtime: ZIP_MTIME }
    ]
  }
  const archive = zipSync(entries, { level: 9 })
  if (archive.byteLength > MAX_KIT_BYTES) {
    throw new Error('Authoring Kit ZIP 超过 10 MiB。')
  }
  return {
    fileName: `${safePathSegment(input.context.deviceTypeId)}.unilab-card-kit.zip`,
    rootDirectory,
    archive,
    metadata
  }
}

function kitFiles(
  context: DeviceCardAuthoringContext,
  profile: DeviceCardAuthoringProfile,
  metadata: DeviceCardAuthoringKitMetadata
): Record<string, string> {
  const files: Record<string, string> = {
    'README.md': kitReadme(context, profile),
    'AGENTS.md': kitAgentRules(context),
    'CARD_SPEC.md': kitCardSpec(context),
    'kit-metadata.json': stringifyStable(metadata),
    'authoring-context.json': stringifyStable(context),
    'card-manifest.schema.json': stringifyStable(CARD_MANIFEST_SCHEMA),
    'ui-catalog.json': stringifyStable(DEVICE_CARD_UI_CATALOG),
    'sdk/index.d.ts': SDK_DECLARATION,
    'sdk/ui-elements.d.ts': UI_ELEMENTS_DECLARATION,
    'sdk/vue-shim.d.ts': VUE_SHIM_DECLARATION,
    'sdk/protocol-version.json': stringifyStable({
      hostProtocolVersion: 1,
      sdkVersion: DEVICE_CARD_SDK_VERSION,
      toolingVersion: DEVICE_CARD_TOOLING_VERSION,
      uiCatalogVersion: DEVICE_CARD_UI_CATALOG_VERSION
    }),
    'mocks/default-state.json': stringifyStable(context.sampleState),
    'examples/status-card/card.vue': statusExample(context),
    'examples/action-card/card.vue': actionExample(context),
    'examples/rack-card/card.vue': rackExample(),
    'examples/trend-card/card.vue': trendExample()
  }
  addProject(files, 'card-project', createDeviceCardProjectFiles(
    context,
    profile
  ))
  for (const candidate of PROFILES) {
    addProject(
      files,
      `templates/${profileDirectory(candidate)}`,
      createDeviceCardProjectFiles(context, candidate)
    )
  }
  return files
}

function addProject(
  target: Record<string, string>,
  directory: string,
  project: Record<string, string>
): void {
  for (const [path, content] of Object.entries(project)) {
    target[`${directory}/${path}`] = content
  }
}

function kitReadme(
  context: DeviceCardAuthoringContext,
  profile: DeviceCardAuthoringProfile
): string {
  return `# ${context.title} Authoring Kit

这是设备类型 \`${context.deviceTypeId}\` 的完整 Uni-Lab 卡片创作资料包。
已选择开发 Profile：\`${profile}\`。

## 开始开发

1. 进入 \`card-project/\`。
2. 让本地 Coding Agent 先阅读 \`AGENTS.md\`、\`CARD_SPEC.md\` 和
   \`authoring-context.json\`。
3. 安装固定版本工具链，执行 \`pnpm dev\` 查看 Mock 效果。
4. 执行 \`pnpm check && pnpm test && pnpm pack\`。
5. 将生成的 \`.ulcard\` 导入 Electron。

\`templates/\` 包含 Vue、React 和原生 Web Component 三套起始模板，
\`examples/\` 包含状态、Action、层架和趋势图示例。

Authoring Kit 只用于本地创作。Electron 会重新构建导入源码，并在 Live 打开时
对照当前 OS 设备目录校验设备类型和 Action，不会信任 Kit 或本地构建产物。
`
}

function kitAgentRules(context: DeviceCardAuthoringContext): string {
  return `# Authoring Kit Agent Rules

- 当前设备类型只能是 \`${context.deviceTypeId}\`。
- 默认工作目录是 \`card-project/\`，不要修改 Kit 根目录的合同和 SDK 快照。
- 开始编码前必须读取 \`card-project/AGENTS.md\`、
  \`card-project/CARD_SPEC.md\`、\`authoring-context.json\` 和
  \`ui-catalog.json\`。
- 不得扩展 Authoring Context 中不存在的设备状态、Action 或媒体能力。
- 不得绕过 \`unilab-card check\`、Electron 权威重编译或权限校验。
`
}

function kitCardSpec(context: DeviceCardAuthoringContext): string {
  return `# Device Contract Snapshot

设备：${context.title}

- Device Type ID: \`${context.deviceTypeId}\`
- Device Instance ID: \`${context.deviceId ?? '未绑定'}\`
- State Contract: \`authoring-context.json#stateSchema\`
- Action Contract: \`authoring-context.json#actions\`
- UI Catalog: \`ui-catalog.json\`
- Host Protocol: \`1\`

状态字段标记为 \`unresolved/runtime-sample\` 时，仅能作为 Mock 创作提示，
不能将它当作 OS Registry 的正式状态合同。
`
}

function statusExample(context: DeviceCardAuthoringContext): string {
  const key = Object.keys(context.stateSchema).sort()[0] ?? 'status'
  return `<script setup lang="ts">
import { useDeviceCard } from '@unilab/device-card-sdk/vue'
const card = useDeviceCard({ state: [${JSON.stringify(key)}] })
</script>
<template>
  <u-status label=${JSON.stringify(key)} :value="String(card.state[${JSON.stringify(key)}] ?? '—')" />
</template>
`
}

function actionExample(context: DeviceCardAuthoringContext): string {
  const action = context.actions[0]
  if (!action) {
    return '<template><u-card title="该设备没有已登记 Action" /></template>\n'
  }
  return `<template>
  <u-action-button action=${JSON.stringify(action.action)}>
    ${escapeHtml(action.label)}
  </u-action-button>
</template>
`
}

function rackExample(): string {
  return `<script setup lang="ts">
import { onMounted, ref } from 'vue'
const rack = ref<HTMLElement | null>(null)
onMounted(() => {
  if (rack.value) {
    ;(rack.value as HTMLElement & { slots: unknown[] }).slots = [
      { id: 'A1', label: 'A1', status: 'occupied' },
      { id: 'A2', label: 'A2', status: 'empty' }
    ]
  }
})
</script>
<template><u-rack-grid ref="rack" /></template>
`
}

function trendExample(): string {
  return `<script setup lang="ts">
import { onMounted, ref } from 'vue'
const trend = ref<HTMLElement | null>(null)
onMounted(() => {
  if (trend.value) {
    ;(trend.value as HTMLElement & { points: number[] }).points = [2, 5, 3, 8, 6]
  }
})
</script>
<template><u-timeseries ref="trend" /></template>
`
}

function profileDirectory(profile: DeviceCardAuthoringProfile): string {
  if (profile === 'vue-web-component-v1') return 'vue-web-component'
  if (profile === 'react-web-component-v1') return 'react-web-component'
  return 'web-component-lite'
}

function assertContext(
  context: DeviceCardAuthoringContext
): void {
  if (
    !isRecord(context) ||
    context.schemaVersion !== 'device-card-authoring-context/v1' ||
    !nonEmpty(context.deviceTypeId) ||
    !nonEmpty(context.title) ||
    (
      context.deviceId !== undefined &&
      !nonEmpty(context.deviceId)
    ) ||
    !Array.isArray(context.actions) ||
    !isRecord(context.stateSchema) ||
    !isRecord(context.sampleState) ||
    !Array.isArray(context.media)
  ) {
    throw new Error('Authoring Context 结构无效。')
  }
  if (Object.keys(context.stateSchema).some((key) => !nonEmpty(key))) {
    throw new Error('Authoring Context 包含空状态字段名。')
  }
  const actionNames = new Set<string>()
  for (const action of context.actions) {
    if (
      !isRecord(action) ||
      !nonEmpty(action.action) ||
      !nonEmpty(action.label) ||
      !isRecord(action.inputSchema) ||
      !isRecord(action.outputSchema) ||
      actionNames.has(action.action)
    ) {
      throw new Error('Authoring Context 包含无效或重复的 Action。')
    }
    actionNames.add(action.action)
  }
  if (
    context.media.some((item) => !nonEmpty(item)) ||
    new Set(context.media).size !== context.media.length
  ) {
    throw new Error('Authoring Context 包含无效媒体能力。')
  }
  stableValue(context)
}

function normalizeGeneratedAt(value?: string): string {
  const date = value === undefined ? new Date() : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Authoring Kit generatedAt 无效。')
  }
  return date.toISOString()
}

function safePathSegment(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 100)
  return normalized || 'unilab-device'
}

function stringifyStable(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`
}

function stableValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Authoring Context 只能包含有限数字。')
    return value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Authoring Context 不能包含循环引用。')
    seen.add(value)
    const result = value.map((item) => stableValue(item, seen))
    seen.delete(value)
    return result
  }
  if (isRecord(value)) {
    if (seen.has(value)) throw new Error('Authoring Context 不能包含循环引用。')
    seen.add(value)
    const result = Object.fromEntries(
      Object.keys(value).sort().map((key) => {
        if (value[key] === undefined) {
          throw new Error(`Authoring Context 字段 ${key} 不能是 undefined。`)
        }
        return [key, stableValue(value[key], seen)]
      })
    )
    seen.delete(value)
    return result
  }
  throw new Error('Authoring Context 包含不可序列化值。')
}

async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前运行环境不支持 SHA-256。')
  const digest = await subtle.digest('SHA-256', strToU8(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
