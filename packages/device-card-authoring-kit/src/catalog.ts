export const DEVICE_CARD_SDK_VERSION = '0.1.0'
export const DEVICE_CARD_TOOLING_VERSION = '0.1.0'
export const DEVICE_CARD_UI_CATALOG_VERSION = '0.1.0'

export const CARD_MANIFEST_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://unilab.local/schemas/device-card-manifest-v2.json',
  title: 'Uni-Lab Device Card Manifest',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'version',
    'title',
    'targets',
    'sdkVersion',
    'hostProtocolVersion',
    'authoringProfile',
    'entry',
    'uiFeatures',
    'permissions'
  ],
  properties: {
    schemaVersion: { const: 2 },
    id: {
      type: 'string',
      pattern: '^[a-z0-9](?:[a-z0-9._-]{1,126}[a-z0-9])?$'
    },
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$'
    },
    title: { type: 'string', minLength: 1 },
    targets: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['definitionFqid', 'authoredAgainst'],
        properties: {
          definitionFqid: {
            type: 'string',
            pattern: '^community\\.[a-z_][a-z0-9_]*\\.[A-Za-z0-9_]+$'
          },
          authoredAgainst: {
            type: 'object',
            additionalProperties: false,
            required: [
              'definitionVersion',
              'definitionContentHash',
              'packageCatalogDigest'
            ],
            properties: {
              definitionVersion: {
                type: 'string',
                minLength: 1
              },
              definitionContentHash: {
                type: 'string',
                pattern: '^sha256:[0-9a-f]{64}$'
              },
              packageCatalogDigest: {
                type: 'string',
                pattern: '^sha256:[0-9a-f]{64}$'
              }
            }
          }
        }
      }
    },
    sdkVersion: { type: 'string', minLength: 1 },
    hostProtocolVersion: { const: 1 },
    authoringProfile: {
      enum: [
        'web-component-lite-v1',
        'vue-web-component-v1',
        'react-web-component-v1'
      ]
    },
    entry: {
      type: 'string',
      pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$'
    },
    uiFeatures: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', minLength: 1 }
    },
    permissions: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'actions', 'media'],
      properties: {
        state: stringArraySchema(),
        actions: stringArraySchema(),
        media: stringArraySchema()
      }
    },
    config: {
      type: 'object',
      additionalProperties: false,
      required: ['version', 'defaults', 'schema'],
      properties: {
        version: { type: 'integer', minimum: 1 },
        defaults: { type: 'object' },
        schema: { type: 'object' }
      }
    }
  }
} as const

export const DEVICE_CARD_UI_CATALOG = {
  schemaVersion: 'device-card-ui-catalog/v1',
  version: DEVICE_CARD_UI_CATALOG_VERSION,
  features: ['core'],
  elements: [
    element('u-card', '卡片布局容器', [
      attribute('title', 'string'),
      attribute('subtitle', 'string')
    ]),
    element('u-metric', '带单位的指标', [
      attribute('label', 'string'),
      attribute('value', 'string'),
      attribute('unit', 'string'),
      attribute('tone', 'neutral | success | warning | danger')
    ]),
    element('u-status', '状态标记', [
      attribute('label', 'string'),
      attribute('value', 'string'),
      attribute('tone', 'neutral | success | warning | danger')
    ]),
    element('u-action-button', '调用 Manifest 已授权 Action', [
      attribute('action', 'string'),
      attribute('variant', 'primary | danger'),
      attribute('disabled', 'boolean')
    ]),
    {
      ...element('u-rack-grid', '层架/槽位网格'),
      properties: [
        { name: 'slots', type: 'Array<{ id; label?; status? }>' },
        { name: 'columns', type: 'number' }
      ],
      events: [{ name: 'u-slot-select', detail: '{ slotId: string }' }]
    },
    {
      ...element('u-well-plate', '孔板视图'),
      properties: [
        { name: 'wells', type: 'Array<{ id; state }>' },
        { name: 'columns', type: 'number' }
      ],
      events: [{ name: 'u-well-select', detail: '{ wellId: string }' }]
    },
    {
      ...element('u-timeseries', '轻量时序折线图'),
      properties: [{
        name: 'points',
        type: 'Array<number | { x: number; y: number }>'
      }]
    },
    {
      ...element('u-log-console', '结构化日志列表'),
      properties: [{
        name: 'entries',
        type: 'Array<{ timestamp?; level?; message }>'
      }]
    }
  ],
  themeTokens: [
    '--u-color-surface',
    '--u-color-surface-subtle',
    '--u-color-text',
    '--u-color-muted',
    '--u-color-border',
    '--u-color-primary',
    '--u-color-danger',
    '--u-radius-card',
    '--u-font-sans',
    '--u-font-mono'
  ]
} as const

export const SDK_DECLARATION = `declare module '@unilab/device-card-sdk' {
  export type JsonPrimitive = string | number | boolean | null
  export type JsonValue =
    | JsonPrimitive
    | { [key: string]: JsonValue }
    | JsonValue[]
  export interface DeviceDefinitionReference {
    fqid: string
    version: string
    contentHash: string
    sourceIdentity: string
    title: string
    description: string
    category: string[]
    manufacturer: string
    packageCatalog: {
      schemaVersion: '1'
      distribution: { name: string; normalizedName: string; version: string }
      importPackage: string
      namespace: string
      contentDigest: string
      catalogDigest: string
    }
  }
  export interface DeviceCardRuntimeSnapshot {
    mode: 'mock' | 'live'
    device: {
      deviceId: string | null
      definitionFqid: string
      definition?: DeviceDefinitionReference
      /** @deprecated 使用 definitionFqid。 */
      deviceTypeId: string
      title: string
    }
    state: Record<string, unknown>
    config: Record<string, JsonValue>
    theme: 'light' | 'dark'
    locale: string
  }
  export interface DeviceCardActionRun {
    requestId: string
    action: string
    status:
      | 'SUBMITTED'
      | 'ACCEPTED'
      | 'RUNNING'
      | 'DONE'
      | 'ERROR'
      | 'CANCELLED'
      | 'TIMEOUT'
      | 'REJECTED'
    result?: JsonValue
    error?: string
  }
  export interface DeviceCardBridge {
    getContext(): Promise<DeviceCardRuntimeSnapshot>
    subscribeState(
      keys: readonly string[],
      listener: (state: Record<string, unknown>) => void
    ): () => void
    callAction(
      action: string,
      params?: Record<string, unknown>
    ): Promise<DeviceCardActionRun>
    saveConfig(
      patch: Record<string, JsonValue>
    ): Promise<Record<string, JsonValue>>
    log(level: 'info' | 'warn' | 'error', message: string): void
  }
  export function getDeviceCardBridge(): DeviceCardBridge
  export function defineDeviceCard(
    element: CustomElementConstructor
  ): { element: CustomElementConstructor }
}

declare module '@unilab/device-card-sdk/vue' {
  import type {
    DeviceCardActionRun,
    DeviceCardRuntimeSnapshot
  } from '@unilab/device-card-sdk'
  export function useDeviceCard(options: {
    state: readonly string[]
  }): {
    state: Record<string, unknown>
    context: Readonly<DeviceCardRuntimeSnapshot | null>
    callAction(
      action: string,
      params?: Record<string, unknown>
    ): Promise<DeviceCardActionRun>
  }
}

declare module '@unilab/device-card-sdk/react' {
  import type {
    DeviceCardActionRun,
    DeviceCardRuntimeSnapshot
  } from '@unilab/device-card-sdk'
  export function useDeviceCard(options: {
    state: readonly string[]
  }): {
    state: Record<string, unknown>
    context: DeviceCardRuntimeSnapshot | null
    callAction(
      action: string,
      params?: Record<string, unknown>
    ): Promise<DeviceCardActionRun>
  }
}
`

export const UI_ELEMENTS_DECLARATION = `type UniLabElementAttributes = {
  class?: string
  className?: string
  style?: string | Record<string, string | number>
  title?: string
  subtitle?: string
  label?: string
  value?: string
  unit?: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  action?: string
  variant?: 'primary' | 'danger'
  disabled?: boolean
  children?: unknown
}

declare global {
  interface HTMLElementTagNameMap {
    'u-card': HTMLElement
    'u-metric': HTMLElement
    'u-status': HTMLElement
    'u-action-button': HTMLElement
    'u-rack-grid': HTMLElement & {
      slots: Array<{ id: string; label?: string; status?: string }>
      columns: number
    }
    'u-well-plate': HTMLElement & {
      wells: Array<{ id: string; state: 'empty' | 'filled' | 'disabled' }>
      columns: number
    }
    'u-timeseries': HTMLElement & {
      points: Array<number | { x: number; y: number }>
    }
    'u-log-console': HTMLElement & {
      entries: Array<{
        timestamp?: string
        level?: 'info' | 'success' | 'warning' | 'error'
        message: string
      }>
    }
  }

  namespace JSX {
    interface IntrinsicElements {
      'u-card': UniLabElementAttributes
      'u-metric': UniLabElementAttributes
      'u-status': UniLabElementAttributes
      'u-action-button': UniLabElementAttributes
      'u-rack-grid': UniLabElementAttributes
      'u-well-plate': UniLabElementAttributes
      'u-timeseries': UniLabElementAttributes
      'u-log-console': UniLabElementAttributes
    }
  }
}

export {}
`

export const VUE_SHIM_DECLARATION = `declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
`

export const FRAMEWORK_DECLARATION = `declare namespace React {
  namespace JSX {
    interface Element {}
  }
}

declare module 'react' {
  export function useCallback<T extends (...args: never[]) => unknown>(
    callback: T,
    dependencies: readonly unknown[]
  ): T
  export function useEffect(
    effect: () => void | (() => void),
    dependencies?: readonly unknown[]
  ): void
  export function useMemo<T>(
    factory: () => T,
    dependencies: readonly unknown[]
  ): T
  export function useRef<T>(initialValue: T): { current: T }
  export function useState<T>(
    initialValue: T
  ): [T, (value: T | ((current: T) => T)) => void]
}

declare module 'react/jsx-runtime' {
  export const Fragment: unique symbol
  export function jsx(type: unknown, props: unknown, key?: unknown): React.JSX.Element
  export function jsxs(type: unknown, props: unknown, key?: unknown): React.JSX.Element
}

declare module 'vue' {
  export type DefineComponent<
    Props = Record<string, never>,
    RawBindings = Record<string, never>,
    Data = unknown
  > = unknown
  export function computed<T>(getter: () => T): Readonly<{ value: T }>
  export function onBeforeUnmount(callback: () => void): void
  export function onMounted(callback: () => void): void
  export function reactive<T extends object>(value: T): T
  export function ref<T>(value: T): { value: T }
}
`

function stringArraySchema(): {
  type: 'array'
  uniqueItems: true
  items: { type: 'string'; minLength: 1 }
} {
  return {
    type: 'array',
    uniqueItems: true,
    items: { type: 'string', minLength: 1 }
  }
}

function element(
  name: string,
  description: string,
  attributes: Array<{ name: string; type: string }> = []
): {
  name: string
  description: string
  attributes: Array<{ name: string; type: string }>
  properties: never[]
  events: never[]
} {
  return { name, description, attributes, properties: [], events: [] }
}

function attribute(
  name: string,
  type: string
): { name: string; type: string } {
  return { name, type }
}
