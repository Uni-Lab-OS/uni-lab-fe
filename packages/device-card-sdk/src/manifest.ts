import type {
  DeviceCardAuthoringProfile,
  DeviceCardDiagnostic,
  DeviceCardManifest,
  DeviceCardPermissions,
  JsonObject
} from './contracts'
import { isDeviceDefinitionFqid } from './domainPackage'

const CARD_ID = /^[a-z0-9](?:[a-z0-9._-]{1,126}[a-z0-9])?$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/
const PROFILES: readonly DeviceCardAuthoringProfile[] = [
  'web-component-lite-v1',
  'vue-web-component-v1',
  'react-web-component-v1'
]

/**
 * 解析并关闭式校验 v1/v2 设备卡 Manifest。
 *
 * @param input 未信任的 Manifest wire 值。
 * @returns 已通过全部结构校验的 Manifest。
 */
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

/**
 * 返回设备卡 Manifest 的全部结构化诊断。
 *
 * @param input 未信任的 Manifest wire 值。
 * @returns 不修改输入的错误诊断数组。
 */
export function validateDeviceCardManifest(
  input: unknown
): DeviceCardDiagnostic[] {
  const diagnostics: DeviceCardDiagnostic[] = []
  if (!isRecord(input)) {
    return [error('manifest.invalid', 'Manifest 必须是 JSON object。')]
  }

  if (input.schemaVersion !== 1 && input.schemaVersion !== 2) {
    diagnostics.push(error(
      'manifest.schemaVersion',
      'schemaVersion 必须是 1 或 2。',
      'schemaVersion'
    ))
  }
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

  if (input.schemaVersion === 2) {
    validateDefinitionTargets(input.targets, diagnostics)
    if (Object.prototype.hasOwnProperty.call(input, 'deviceTypes')) {
      diagnostics.push(error(
        'manifest.deviceTypes_legacy',
        'v2 Manifest 不得继续声明 deviceTypes，请使用 targets。',
        'deviceTypes'
      ))
    }
  } else {
    expectStringArray(input, 'deviceTypes', diagnostics, false)
  }
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

/**
 * 校验 v2 Manifest 的规范设备定义目标和 authored-against 证据。
 *
 * @param input 待验证的 targets wire 值。
 * @param diagnostics 收集结构化错误的目标数组。
 * @returns 无；全部错误追加到 diagnostics。
 */
function validateDefinitionTargets(
  input: unknown,
  diagnostics: DeviceCardDiagnostic[]
): void {
  if (!Array.isArray(input) || input.length === 0) {
    diagnostics.push(error(
      'manifest.targets',
      'targets 必须是非空设备定义目标数组。',
      'targets'
    ))
    return
  }
  const definitions = new Set<string>()
  input.forEach((value, index) => {
    const path = `targets.${index}`
    if (!isRecord(value)) {
      diagnostics.push(error('manifest.targets', '设备定义目标必须是 object。', path))
      return
    }
    const definitionFqid = value.definitionFqid
    if (!isDeviceDefinitionFqid(definitionFqid)) {
      diagnostics.push(error(
        'manifest.definition_fqid',
        'definitionFqid 必须是规范 community FQID。',
        `${path}.definitionFqid`
      ))
    } else if (definitions.has(definitionFqid)) {
      diagnostics.push(error(
        'manifest.definition_duplicate',
        'targets 不得重复声明同一个设备定义。',
        `${path}.definitionFqid`
      ))
    } else {
      definitions.add(definitionFqid)
    }
    validateAuthoredAgainst(value.authoredAgainst, path, diagnostics)
  })
}

/**
 * 校验一个目标绑定的定义版本和摘要证据。
 *
 * @param input 待验证的 authoredAgainst wire 值。
 * @param targetPath 当前目标的诊断路径。
 * @param diagnostics 收集结构化错误的目标数组。
 * @returns 无；错误以失败关闭方式追加。
 */
function validateAuthoredAgainst(
  input: unknown,
  targetPath: string,
  diagnostics: DeviceCardDiagnostic[]
): void {
  if (!isRecord(input)) {
    diagnostics.push(error(
      'manifest.authored_against',
      'authoredAgainst 必须是 object。',
      `${targetPath}.authoredAgainst`
    ))
    return
  }
  const digest = /^sha256:[0-9a-f]{64}$/u
  if (
    typeof input.definitionVersion !== 'string' ||
    input.definitionVersion.trim().length === 0
  ) {
    diagnostics.push(error(
      'manifest.definition_version',
      'definitionVersion 必须是非空版本字符串。',
      `${targetPath}.authoredAgainst.definitionVersion`
    ))
  }
  for (const key of ['definitionContentHash', 'packageCatalogDigest'] as const) {
    if (typeof input[key] !== 'string' || !digest.test(input[key])) {
      diagnostics.push(error(
        'manifest.definition_digest',
        `${key} 必须是 sha256 摘要。`,
        `${targetPath}.authoredAgainst.${key}`
      ))
    }
  }
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
