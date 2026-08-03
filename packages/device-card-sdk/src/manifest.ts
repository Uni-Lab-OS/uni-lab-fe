import type {
  DeviceCardAuthoringProfile,
  DeviceCardDiagnostic,
  DeviceCardManifest,
  DeviceCardPermissions,
  JsonObject
} from './contracts'

const CARD_ID = /^[a-z0-9](?:[a-z0-9._-]{1,126}[a-z0-9])?$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/
const PROFILES: readonly DeviceCardAuthoringProfile[] = [
  'web-component-lite-v1',
  'vue-web-component-v1',
  'react-web-component-v1'
]

export function parseDeviceCardManifest(input: unknown): DeviceCardManifest {
  const diagnostics = validateDeviceCardManifest(input)
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new Error(
      diagnostics.map((diagnostic) =>
        `${diagnostic.path ?? 'manifest'}: ${diagnostic.message}`
      ).join('\n')
    )
  }
  return input as DeviceCardManifest
}

export function validateDeviceCardManifest(
  input: unknown
): DeviceCardDiagnostic[] {
  const diagnostics: DeviceCardDiagnostic[] = []
  if (!isRecord(input)) {
    return [error('manifest.invalid', 'Manifest 必须是 JSON object。')]
  }

  expectEqual(input, 'schemaVersion', 1, diagnostics)
  expectString(input, 'id', diagnostics, (value) => CARD_ID.test(value))
  expectString(input, 'version', diagnostics, (value) => VERSION.test(value))
  expectString(input, 'title', diagnostics, (value) => value.trim().length > 0)
  expectEqual(input, 'hostProtocolVersion', 1, diagnostics)
  expectString(input, 'sdkVersion', diagnostics)

  const profile = input.authoringProfile
  if (
    typeof profile !== 'string' ||
    !PROFILES.includes(profile as DeviceCardAuthoringProfile)
  ) {
    diagnostics.push(error(
      'manifest.profile',
      `authoringProfile 必须是 ${PROFILES.join('、')}。`,
      'authoringProfile'
    ))
  }

  const entry = expectString(
    input,
    'entry',
    diagnostics,
    (value) => RELATIVE_PATH.test(value)
  )
  if (entry && typeof profile === 'string') {
    const expectedExtension = profile === 'vue-web-component-v1'
      ? '.vue'
      : profile === 'react-web-component-v1'
        ? '.tsx'
        : '.ts'
    if (!entry.endsWith(expectedExtension)) {
      diagnostics.push(error(
        'manifest.entry_extension',
        `${profile} 的入口必须使用 ${expectedExtension}。`,
        'entry'
      ))
    }
  }

  expectStringArray(input, 'deviceTypes', diagnostics, false)
  expectStringArray(input, 'uiFeatures', diagnostics, true)
  validatePermissions(input.permissions, diagnostics)

  if (input.config !== undefined) {
    if (!isRecord(input.config)) {
      diagnostics.push(error(
        'manifest.config',
        'config 必须是 object。',
        'config'
      ))
    } else {
      if (
        typeof input.config.version !== 'number' ||
        !Number.isSafeInteger(input.config.version) ||
        input.config.version < 1
      ) {
        diagnostics.push(error(
          'manifest.config_version',
          'config.version 必须是正整数。',
          'config.version'
        ))
      }
      if (!isJsonObject(input.config.defaults)) {
        diagnostics.push(error(
          'manifest.config_defaults',
          'config.defaults 必须是 JSON object。',
          'config.defaults'
        ))
      }
      if (!isJsonObject(input.config.schema)) {
        diagnostics.push(error(
          'manifest.config_schema',
          'config.schema 必须是 JSON object。',
          'config.schema'
        ))
      }
    }
  }

  return diagnostics
}

function validatePermissions(
  input: unknown,
  diagnostics: DeviceCardDiagnostic[]
): input is DeviceCardPermissions {
  if (!isRecord(input)) {
    diagnostics.push(error(
      'manifest.permissions',
      'permissions 必须是 object。',
      'permissions'
    ))
    return false
  }
  expectStringArray(input, 'state', diagnostics, true, 'permissions')
  expectStringArray(input, 'actions', diagnostics, true, 'permissions')
  expectStringArray(input, 'media', diagnostics, true, 'permissions')
  return true
}

function expectEqual(
  input: Record<string, unknown>,
  key: string,
  expected: unknown,
  diagnostics: DeviceCardDiagnostic[]
): void {
  if (input[key] !== expected) {
    diagnostics.push(error(
      `manifest.${key}`,
      `${key} 必须是 ${String(expected)}。`,
      key
    ))
  }
}

function expectString(
  input: Record<string, unknown>,
  key: string,
  diagnostics: DeviceCardDiagnostic[],
  predicate: (value: string) => boolean = () => true
): string | null {
  const value = input[key]
  if (typeof value !== 'string' || !predicate(value)) {
    diagnostics.push(error(
      `manifest.${key}`,
      `${key} 无效。`,
      key
    ))
    return null
  }
  return value
}

function expectStringArray(
  input: Record<string, unknown>,
  key: string,
  diagnostics: DeviceCardDiagnostic[],
  allowEmpty: boolean,
  prefix = ''
): void {
  const value = input[key]
  const path = prefix ? `${prefix}.${key}` : key
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0) ||
    new Set(value).size !== value.length
  ) {
    diagnostics.push(error(
      `manifest.${path}`,
      `${path} 必须是${allowEmpty ? '' : '非空'}且不重复的字符串数组。`,
      path
    ))
  }
}

function error(
  code: string,
  message: string,
  path?: string
): DeviceCardDiagnostic {
  return { severity: 'error', code, message, path }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false
  return Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true
  }
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isJsonObject(value)
}
