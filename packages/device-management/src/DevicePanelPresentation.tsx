import type { DeviceAction, DeviceActionInputSchema } from '@unilab/services'

import type { ManagedDevice } from './deviceCatalog'
import type { DeviceActionArgumentDraft } from './deviceActionRun'
import { deviceClass } from './deviceStyles'

export type ArgumentDraft = DeviceActionArgumentDraft

export function Metric({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'success' | 'warning' | 'muted'
}): React.JSX.Element {
  return (
    <span className={deviceClass('edge-device__metric', tone && `is-${tone}`)}>
      <small>{label}</small>
      <strong title={value}>{value}</strong>
    </span>
  )
}

export function ActionParameterForm({
  action,
  draft,
  disabled,
  onChange
}: {
  action: DeviceAction
  draft: ArgumentDraft
  disabled: boolean
  onChange: (name: string, value: string | boolean) => void
}): React.JSX.Element {
  const fields = Object.entries(action.inputSchema)
  if (!fields.length) {
    return (
      <div className={deviceClass('edge-device__parameter-empty')}>
        此动作不需要输入参数，可直接运行。
      </div>
    )
  }
  return (
    <div className={deviceClass('edge-device__parameter-form')}>
      {fields.map(([name, schema]) => (
        <ActionField
          key={name}
          name={name}
          schema={schema}
          value={draft[name] ?? ''}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </div>
  )
}

function ActionField({
  name,
  schema,
  value,
  disabled,
  onChange
}: {
  name: string
  schema: DeviceActionInputSchema
  value: string | boolean
  disabled: boolean
  onChange: (name: string, value: string | boolean) => void
}): React.JSX.Element {
  const label = schema.title || name
  if (schema.type === 'boolean') {
    return (
      <label
        className={deviceClass('edge-device__field edge-device__field--boolean')}
        data-device-management="field"
      >
        <span>
          {label}
          {schema.required ? <em>必填</em> : null}
        </span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(name, event.target.checked)}
        />
        {schema.description ? <small>{schema.description}</small> : null}
      </label>
    )
  }
  const isStructured = schema.type === 'object' || schema.type === 'array'
  return (
    <label
      className={deviceClass('edge-device__field', isStructured && 'is-wide')}
      data-device-management="field"
    >
      <span>
        {label}
        {schema.required ? <em>必填</em> : null}
      </span>
      {schema.enum?.length ? (
        <select
          value={String(value)}
          disabled={disabled}
          onChange={(event) => onChange(name, event.target.value)}
        >
          {schema.enum.map((option) => (
            <option key={JSON.stringify(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      ) : isStructured ? (
        <textarea
          rows={2}
          value={String(value)}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => onChange(name, event.target.value)}
        />
      ) : (
        <input
          type={
            schema.type === 'number' || schema.type === 'integer'
              ? 'number'
              : 'text'
          }
          value={String(value)}
          min={schema.minimum}
          max={schema.maximum}
          step={schema.type === 'integer' ? 1 : 'any'}
          placeholder={schema.default !== undefined
            ? `默认值：${String(schema.default)}`
            : undefined}
          disabled={disabled}
          onChange={(event) => onChange(name, event.target.value)}
        />
      )}
      {schema.description ? <small>{schema.description}</small> : null}
    </label>
  )
}

export function DeviceIcon({ device }: { device: ManagedDevice }): React.JSX.Element {
  const text = [
    device.id,
    device.displayName,
    device.machineName
  ].join(' ').toLowerCase()
  if (text.includes('camera') || text.includes('相机')) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7.5h3l1.4-2h7.2l1.4 2h3v11H4z" />
        <circle cx="12" cy="13" r="3.4" />
      </svg>
    )
  }
  if (
    text.includes('robot')
    || text.includes('arm')
    || text.includes('机械臂')
  ) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 19h14M8 19v-3.5l3-1.5 1.2-4.1" />
        <circle cx="12.6" cy="8.5" r="1.7" />
        <path d="m14 7.4 2.4-2.1 2.1 2.2-2.2 2.1M16.2 9.7l1.8 2.1" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8M8 13h5M17 13h.01" />
    </svg>
  )
}

export function createArgumentDraft(
  schema: Record<string, DeviceActionInputSchema>
): ArgumentDraft {
  return Object.fromEntries(
    Object.entries(schema).map(([name, field]) => [
      name,
      draftValue(field)
    ])
  )
}

export function readArgumentDraft(
  storageKey: string | null,
  fallback: ArgumentDraft
): ArgumentDraft {
  if (!storageKey || typeof globalThis.localStorage === 'undefined') {
    return fallback
  }
  try {
    const parsed = JSON.parse(
      globalThis.localStorage.getItem(storageKey) ?? 'null'
    ) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallback
    }
    const persisted = Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) =>
          typeof value === 'string' || typeof value === 'boolean'
      )
    ) as ArgumentDraft
    return mergeArgumentDraft(fallback, persisted)
  } catch {
    return fallback
  }
}

/** Preserve current schema defaults when an older saved draft only cleared them. */
export function mergeArgumentDraft(
  fallback: ArgumentDraft,
  persisted: ArgumentDraft
): ArgumentDraft {
  return Object.fromEntries(
    Object.entries({ ...fallback, ...persisted }).map(([name, value]) => {
      const fallbackValue = fallback[name]
      return [
        name,
        value === '' && fallbackValue !== '' && fallbackValue !== undefined
          ? fallbackValue
          : value
      ]
    })
  )
}

export function writeArgumentDraft(
  storageKey: string | null,
  draft: ArgumentDraft
): void {
  if (!storageKey || typeof globalThis.localStorage === 'undefined') return
  try {
    globalThis.localStorage.setItem(storageKey, JSON.stringify(draft))
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

function draftValue(schema: DeviceActionInputSchema): string | boolean {
  if (schema.type === 'boolean') return Boolean(schema.default)
  if (schema.default !== undefined && schema.default !== null) {
    if (schema.type === 'object' || schema.type === 'array') {
      return JSON.stringify(schema.default, null, 2)
    }
    return String(schema.default)
  }
  if (schema.enum?.length) return String(schema.enum[0])
  if (schema.type === 'object') return '{}'
  if (schema.type === 'array') return '[]'
  return ''
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp)
}
