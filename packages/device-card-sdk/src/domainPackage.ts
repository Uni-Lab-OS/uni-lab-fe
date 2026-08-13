import type {
  DeviceCardAuthoringContext,
  DeviceCardDefinitionTarget,
  DeviceCardManifest,
  DeviceDefinitionReference,
  DevicePackageCatalogReference
} from './contracts'

const DEFINITION_FQID = /^community\.[a-z_][a-z0-9_]*\.[A-Za-z0-9_]+$/u
const IMPORT_PACKAGE = /^[a-z_][a-z0-9_]*$/u
const DIGEST = /^sha256:[0-9a-f]{64}$/u

/**
 * 判断字符串是否为 Core #147 的规范设备定义 FQID。
 *
 * @param value 待验证的 wire 值。
 * @returns 值满足 `community.<import_package>.<definition_id>` 时为 true。
 */
export function isDeviceDefinitionFqid(value: unknown): value is string {
  return typeof value === 'string' && DEFINITION_FQID.test(value)
}

/**
 * 校验 PackageCatalog 来源证据，避免前端从目录或实例身份反推软件包。
 *
 * @param value 待验证的 PackageCatalog 引用。
 * @returns 字段完整且摘要、命名空间一致时为 true。
 */
export function isDevicePackageCatalogReference(
  value: unknown
): value is DevicePackageCatalogReference {
  if (!isRecord(value) || value.schemaVersion !== '1') return false
  const distribution = value.distribution
  if (!isRecord(distribution)) return false
  return typeof distribution.name === 'string' && distribution.name.length > 0 &&
    typeof distribution.normalizedName === 'string' &&
    IMPORT_PACKAGE.test(distribution.normalizedName) &&
    typeof distribution.version === 'string' && distribution.version.length > 0 &&
    typeof value.importPackage === 'string' &&
    value.importPackage === distribution.normalizedName &&
    typeof value.namespace === 'string' &&
    value.namespace === `community.${value.importPackage}` &&
    typeof value.contentDigest === 'string' && DIGEST.test(value.contentDigest) &&
    typeof value.catalogDigest === 'string' && DIGEST.test(value.catalogDigest)
}

/**
 * 校验设备定义与其软件包目录（PackageCatalog）来源证据。
 *
 * @param value 待验证的设备定义引用。
 * @returns FQID、源码身份、摘要和软件包命名空间自洽时为 true。
 */
export function isDeviceDefinitionReference(
  value: unknown
): value is DeviceDefinitionReference {
  if (!isRecord(value) || !isDevicePackageCatalogReference(value.packageCatalog)) {
    return false
  }
  return isDeviceDefinitionFqid(value.fqid) &&
    value.fqid.startsWith(`${value.packageCatalog.namespace}.`) &&
    typeof value.version === 'string' && value.version.length > 0 &&
    typeof value.contentHash === 'string' && DIGEST.test(value.contentHash) &&
    typeof value.sourceIdentity === 'string' && value.sourceIdentity.includes(':') &&
    typeof value.title === 'string' && value.title.length > 0 &&
    typeof value.description === 'string' &&
    Array.isArray(value.category) &&
    value.category.every(item => typeof item === 'string') &&
    typeof value.manufacturer === 'string'
}

/**
 * 从当前设备定义生成卡片可持久化的 authored-against 目标。
 *
 * @param definition OS 从软件包目录（PackageCatalog）投影的设备定义。
 * @returns 只包含兼容身份与漂移证据的卡片目标。
 */
export function createDeviceCardDefinitionTarget(
  definition: DeviceDefinitionReference
): DeviceCardDefinitionTarget {
  if (!isDeviceDefinitionReference(definition)) {
    throw new Error('设备定义缺少完整的软件包目录来源证据。')
  }
  return {
    definitionFqid: definition.fqid,
    authoredAgainst: {
      definitionVersion: definition.version,
      definitionContentHash: definition.contentHash,
      packageCatalogDigest: definition.packageCatalog.catalogDigest
    }
  }
}

/**
 * 返回 Manifest 的规范 definition 目标；v1 Manifest 没有该证据。
 *
 * @param manifest 已解析的卡片 Manifest。
 * @returns v2 目标的防御性副本，v1 返回空数组。
 */
export function deviceCardManifestDefinitionTargets(
  manifest: DeviceCardManifest
): DeviceCardDefinitionTarget[] {
  return manifest.schemaVersion === 2
    ? manifest.targets.map(target => structuredClone(target))
    : []
}

/**
 * 返回卡片声明支持的规范设备定义 FQID。
 *
 * @param manifest 已解析的卡片 Manifest。
 * @returns v2 definition FQID；v1 返回空数组，避免把短类型误标为 FQID。
 */
export function deviceCardManifestDefinitionFqids(
  manifest: DeviceCardManifest
): string[] {
  return manifest.schemaVersion === 2
    ? manifest.targets.map(target => target.definitionFqid)
    : []
}

/**
 * 返回 v1 Manifest 中仅供 Mock 迁移的遗留设备类型。
 *
 * @param manifest 已解析的卡片 Manifest。
 * @returns v1 的 deviceTypes；v2 返回空数组。
 */
export function deviceCardManifestLegacyDeviceTypes(
  manifest: DeviceCardManifest
): string[] {
  return manifest.schemaVersion === 1 ? [...manifest.deviceTypes] : []
}

/**
 * 返回 Mock Host 可尝试使用的兼容标识集合。
 *
 * @param manifest 已解析的卡片 Manifest。
 * @returns v2 的规范 FQID，或 v1 的遗留 deviceTypes。
 */
export function deviceCardManifestCompatibilityIds(
  manifest: DeviceCardManifest
): string[] {
  return manifest.schemaVersion === 2
    ? manifest.targets.map(target => target.definitionFqid)
    : [...manifest.deviceTypes]
}

/**
 * 读取 Authoring Context 的规范设备定义身份。
 *
 * @param context v1 或 v2 开发上下文。
 * @returns v2 的 definition FQID；v1 只返回遗留 deviceTypeId。
 */
export function deviceCardAuthoringDefinitionFqid(
  context: DeviceCardAuthoringContext
): string {
  return context.schemaVersion === 'device-card-authoring-context/v2'
    ? context.definition.fqid
    : context.deviceTypeId
}

/**
 * 判断卡片是否声明当前规范设备定义；不使用实例 ID 或短 ID 猜测。
 *
 * @param targets 卡片 v2 持久化目标。
 * @param definitionFqid 当前设备定义 FQID。
 * @returns 存在完全相同 FQID 时为 true。
 */
export function deviceCardTargetsDefinition(
  targets: readonly DeviceCardDefinitionTarget[],
  definitionFqid: string
): boolean {
  return isDeviceDefinitionFqid(definitionFqid) && targets.some(
    target => target.definitionFqid === definitionFqid
  )
}

/**
 * 判断已安装卡片或源码工作区卡片是否能在 Mock 中匹配设备目录条目。
 *
 * @param card 卡片持久化的规范目标和显式遗留目标。
 * @param definitionFqid OS 当前设备定义 FQID；来源缺失时传 null。
 * @param legacyDeviceTypeId 仅供 v1 Mock 迁移的旧设备类型。
 * @returns v2 精确匹配 FQID，或没有规范目标的 v1 卡片匹配旧类型时为 true。
 */
export function deviceCardSupportsDevice(
  card: {
    definitionTargets: readonly DeviceCardDefinitionTarget[]
    legacyDeviceTypes: readonly string[]
  },
  definitionFqid: string | null,
  legacyDeviceTypeId: string
): boolean {
  if (card.definitionTargets.length > 0) {
    return definitionFqid !== null && deviceCardTargetsDefinition(
      card.definitionTargets,
      definitionFqid
    )
  }
  return card.legacyDeviceTypes.includes(legacyDeviceTypeId)
}

/**
 * 判断卡片 authored-against 证据与当前定义是否发生漂移。
 *
 * @param target 与当前 FQID 对应的卡片目标。
 * @param definition OS 当前设备定义。
 * @returns 摘要或定义版本变化时为 true；该结果只触发重验和提示。
 */
export function deviceCardDefinitionHasDrifted(
  target: DeviceCardDefinitionTarget,
  definition: DeviceDefinitionReference
): boolean {
  return target.definitionFqid === definition.fqid && (
    target.authoredAgainst.definitionVersion !== definition.version ||
    target.authoredAgainst.definitionContentHash !== definition.contentHash ||
    target.authoredAgainst.packageCatalogDigest !==
      definition.packageCatalog.catalogDigest
  )
}

/**
 * 将未知值收窄为普通 JSON 记录。
 *
 * @param value 待收窄的 wire 值。
 * @returns 值是非数组对象时为 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
