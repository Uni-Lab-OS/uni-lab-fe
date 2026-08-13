import { ServiceError } from './errors'
import { requestData, type HttpClient } from './http'

export interface DeviceSquareManufacturer {
  uuid: string
  name: string
  code: string
  website: string
}

export interface DeviceSquareListQuery {
  page?: number
  pageSize?: number
  manufacturerUuid?: string
  tags?: string[]
  keyword?: string
}

export interface DeviceSquareItem {
  templateUuid: string
  name: string
  displayName: string
  cover: string
  icon: string
  description: string
  tags: string[]
  resourceType: string
  createdAt: string
  manufacturer: DeviceSquareManufacturer | null
}

export interface DeviceSquarePage {
  total: number
  page: number
  pageSize: number
  items: DeviceSquareItem[]
}

export interface DeviceSquareDetail extends DeviceSquareItem {
  model: Record<string, unknown>
  deviceParams: Record<string, unknown>
  packageInfo: Record<string, unknown>
  sourceRegistry: Record<string, unknown>
  effectiveTemplate: Record<string, unknown>
}

export interface CloudDevicePackageCandidate {
  templateUuid: string
  definitionFqid: string
  artifactDigest: string
  packageName: string
  version: string
  classNamespace: string
  catalogDigest: string
}

export interface DevicePackageSummary {
  name: string
  version: string
  sourceType: string
  sourceUrl: string
  installSpec: string
  deviceCount: number
}

export interface DevicePackageDetail extends DevicePackageSummary {
  summary: string
  license: string
  homepage: string
  classNamespace: string
  installCommand: string
  page: number
  pageSize: number
  devices: DeviceSquareItem[]
}

export interface DeviceSquareFilterOptions {
  manufacturers: DeviceSquareManufacturer[]
  partners: DeviceSquareManufacturer[]
  tags: string[]
}

export interface DeviceSquareService {
  listDevices: (query?: DeviceSquareListQuery) => Promise<DeviceSquarePage>
  getDeviceDetail: (templateUuid: string) => Promise<DeviceSquareDetail>
  resolvePackageCandidate: (
    templateUuid: string,
    detail?: DeviceSquareDetail
  ) => Promise<CloudDevicePackageCandidate>
  getFilterOptions: () => Promise<DeviceSquareFilterOptions>
  listPackages: () => Promise<DevicePackageSummary[]>
  getPackageDetail: (
    packageName: string,
    page?: number,
    pageSize?: number
  ) => Promise<DevicePackageDetail>
}

/**
 * 封装 Backend 现有公开设备广场接口，并把不稳定 JSON 收敛为 Electron 可复用投影。
 * 该 Adapter 只读取云端事实，不保存本地心愿单，也不启动 OS CLI。
 */
export function createDeviceSquareService(http: HttpClient): DeviceSquareService {
  /** 按模板 UUID 懒加载设备详情和包发布信息。 */
  const getDeviceDetail = async (
    templateUuid: string
  ): Promise<DeviceSquareDetail> => {
    assertPathIdentity(templateUuid, '设备模板 UUID')
    const raw = await requestData<Record<string, unknown>>(
      http,
      `/api/v1/lab/square/detail/${encodeURIComponent(templateUuid)}`
    )
    const detail = mapDeviceDetail(raw)
    if (detail.templateUuid !== templateUuid) {
      throw new ServiceError({
        code: 'INVALID_DEVICE_SQUARE_RESPONSE',
        message: '设备广场详情 UUID 与请求不一致',
        retryable: false
      })
    }
    return detail
  }

  return {
    /** 按分页与筛选条件读取设备模板列表。 */
    async listDevices(query = {}) {
      const params = new URLSearchParams()
      appendPositiveInteger(params, 'page', query.page)
      appendPositiveInteger(params, 'page_size', query.pageSize)
      if (query.manufacturerUuid) {
        params.set('manufacturer_uuid', query.manufacturerUuid)
      }
      if (query.keyword) params.set('keyword', query.keyword)
      for (const tag of query.tags ?? []) {
        if (tag) params.append('tags', tag)
      }
      const raw = await requestData<Record<string, unknown>>(
        http,
        withQuery('/api/v1/lab/square/list', params)
      )
      return mapDevicePage(raw)
    },

    getDeviceDetail,

    /**
     * 使用已校验详情或重新读取详情，冻结 CLI 下载所需的包候选。
     * 缺少当前 PackageCatalog 发布字段的遗留模板会失败关闭。
     *
     * @param templateUuid 云端设备模板稳定 UUID。
     * @param existingDetail 同一次 Main 操作已经读取并校验的可选详情。
     * @returns 与模板、定义和两个摘要绑定的下载候选。
     */
    async resolvePackageCandidate(templateUuid, existingDetail) {
      const detail = existingDetail ?? await getDeviceDetail(templateUuid)
      if (detail.templateUuid !== templateUuid) {
        throw new ServiceError({
          code: 'INVALID_DEVICE_SQUARE_RESPONSE',
          message: '设备广场详情 UUID 与请求不一致',
          retryable: false
        })
      }
      return packageCandidateFromDetail(detail)
    },

    /** 读取设备广场厂商和标签筛选项。 */
    async getFilterOptions() {
      const raw = await requestData<Record<string, unknown>>(
        http,
        '/api/v1/lab/square/manufacturers-and-tags'
      )
      return {
        manufacturers: recordArray(raw.manufacturers).map(mapManufacturer),
        partners: recordArray(raw.partners).map(mapManufacturer),
        tags: stringArray(raw.tags)
      }
    },

    /** 读取 Backend 按 package_info.name 聚合的公开设备包列表。 */
    async listPackages() {
      const raw = await requestData<Record<string, unknown>>(
        http,
        '/api/v1/lab/square/packages'
      )
      return recordArray(raw.data).map(mapPackageSummary)
    },

    /** 读取一个设备包的元信息与当前页设备模板。 */
    async getPackageDetail(packageName, page = 1, pageSize = 24) {
      assertPathIdentity(packageName, '设备包名称')
      const params = new URLSearchParams()
      appendPositiveInteger(params, 'page', page)
      appendPositiveInteger(params, 'page_size', pageSize)
      const raw = await requestData<Record<string, unknown>>(
        http,
        withQuery(
          `/api/v1/lab/square/packages/${encodeURIComponent(packageName)}`,
          params
        )
      )
      const summary = mapPackageSummary(raw)
      return {
        ...summary,
        summary: str(raw.summary),
        license: str(raw.license),
        homepage: str(raw.homepage),
        classNamespace: str(raw.class_namespace),
        installCommand: str(raw.install_command),
        page: positiveInteger(raw.page, page),
        pageSize: positiveInteger(raw.page_size, pageSize),
        devices: recordArray(raw.devices).map(mapPackageDevice)
      }
    }
  }
}

/**
 * 把详情中的现有 package_info/source_registry 收敛为 OS CLI 下载输入。
 *
 * @param detail 已按请求 UUID 校验的云端设备详情。
 * @returns 当前 OS CLI 可以安全下载和验证的固定包候选。
 * @throws 发布身份、摘要或目录身份缺失时抛出不可重试兼容性错误。
 */
function packageCandidateFromDetail(
  detail: DeviceSquareDetail
): CloudDevicePackageCandidate {
  const packageInfo = detail.packageInfo
  const sourceRegistry = detail.sourceRegistry
  const effectiveTemplate = detail.effectiveTemplate
  const classNamespace = str(packageInfo.class_namespace)
  const artifactDigest = str(
    packageInfo.artifact_digest ?? packageInfo.sha256
  )
  const definitionFqid = str(
    sourceRegistry.package_definition_fqid ??
      effectiveTemplate.package_definition_fqid
  )
  const catalogDigest = str(packageInfo.catalog_digest)
  if (!/^community\.[a-z_][a-z0-9_]*$/.test(classNamespace)) {
    throw incompatiblePackage(detail.templateUuid, '缺少合法 class_namespace')
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(artifactDigest)) {
    throw incompatiblePackage(detail.templateUuid, '缺少合法 artifact_digest')
  }
  if (!definitionFqid) {
    throw incompatiblePackage(
      detail.templateUuid,
      '当前发布缺少 package_definition_fqid，属于旧版设备包'
    )
  }
  if (
    !new RegExp(`^${escapeRegExp(classNamespace)}\\.[A-Za-z0-9_]+$`, 'u')
      .test(definitionFqid)
  ) {
    throw incompatiblePackage(detail.templateUuid, 'definition FQID 与包命名空间不一致')
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(catalogDigest)) {
    throw incompatiblePackage(
      detail.templateUuid,
      '当前发布缺少合法 catalog_digest，属于旧版设备包'
    )
  }
  return {
    templateUuid: detail.templateUuid,
    definitionFqid,
    artifactDigest,
    packageName: str(packageInfo.name),
    version: str(packageInfo.version),
    classNamespace,
    catalogDigest
  }
}

/**
 * 为缺少当前设备包发布合同的旧模板构造可行动错误。
 *
 * @param templateUuid 云端设备模板稳定身份。
 * @param reason 已由解析器判定的具体不兼容原因。
 * @returns 不可自动重试、要求发布者迁移的服务错误。
 */
function incompatiblePackage(templateUuid: string, reason: string): ServiceError {
  return new ServiceError({
    code: 'DEVICE_PACKAGE_INCOMPATIBLE',
    message: `设备模板 ${templateUuid} 无法接入本地：${reason}，请使用当前 CLI 重新发布`,
    retryable: false
  })
}

/** 把 Backend PageResp 投影为稳定的设备广场分页。 */
function mapDevicePage(raw: Record<string, unknown>): DeviceSquarePage {
  return {
    total: nonNegativeInteger(raw.total),
    page: positiveInteger(raw.page, 1),
    pageSize: positiveInteger(raw.page_size, 1),
    items: recordArray(raw.data).map(mapDeviceItem)
  }
}

/** 把列表或详情的公共展示字段投影成 DeviceSquareItem。 */
function mapDeviceItem(raw: Record<string, unknown>): DeviceSquareItem {
  const name = str(raw.name)
  return {
    templateUuid: str(raw.uuid),
    name,
    displayName: str(raw.display_name) || name,
    cover: str(raw.cover),
    icon: str(raw.icon),
    description: str(raw.description),
    tags: stringArray(raw.tags),
    resourceType: str(raw.resource_type),
    createdAt: str(raw.created_at),
    manufacturer: raw.manufacturer
      ? mapManufacturer(asRecord(raw.manufacturer))
      : null
  }
}

/** 把设备详情额外 JSON 字段保留为只读记录供包候选解析。 */
function mapDeviceDetail(raw: Record<string, unknown>): DeviceSquareDetail {
  return {
    ...mapDeviceItem(raw),
    model: asRecord(raw.model),
    deviceParams: asRecord(raw.device_params),
    packageInfo: asRecord(raw.package_info),
    sourceRegistry: asRecord(raw.source_registry),
    effectiveTemplate: asRecord(raw.effective_template)
  }
}

/** 把设备包详情中的设备精简项补齐为统一卡片字段。 */
function mapPackageDevice(raw: Record<string, unknown>): DeviceSquareItem {
  return mapDeviceItem({ ...raw, display_name: raw.name })
}

/** 把设备包聚合 JSON 投影成稳定摘要。 */
function mapPackageSummary(raw: Record<string, unknown>): DevicePackageSummary {
  return {
    name: str(raw.name),
    version: str(raw.version),
    sourceType: str(raw.source_type),
    sourceUrl: str(raw.source_url),
    installSpec: str(raw.install_spec),
    deviceCount: nonNegativeInteger(raw.device_count)
  }
}

/** 把厂商 JSON 投影成稳定展示字段。 */
function mapManufacturer(raw: Record<string, unknown>): DeviceSquareManufacturer {
  return {
    uuid: str(raw.uuid),
    name: str(raw.name),
    code: str(raw.code),
    website: str(raw.website)
  }
}

/** 只向 query 写入合法正整数，省略无效调用方输入。 */
function appendPositiveInteger(
  params: URLSearchParams,
  name: string,
  value: number | undefined
): void {
  if (value != null && Number.isInteger(value) && value > 0) {
    params.set(name, String(value))
  }
}

/** 仅在存在查询参数时追加问号。 */
function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/** 拒绝会退化为空路径段的远端身份。 */
function assertPathIdentity(value: string, label: string): void {
  if (!value.trim()) {
    throw new ServiceError({
      code: 'INVALID_DEVICE_SQUARE_IDENTITY',
      message: `${label}不能为空`,
      retryable: false
    })
  }
}

/** 安全地把 unknown 读取为对象。 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** 安全地把 unknown 数组过滤为对象数组。 */
function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

/** 安全地把 unknown 数组过滤为字符串数组。 */
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/** 把 unknown 转为字符串，空值保持为空字符串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 把 unknown 转为非负整数，非法值回退到零。 */
function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0
}

/** 把 unknown 转为正整数，非法值采用调用方给定回退。 */
function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback
}

/** 转义正则表达式中的 namespace 字面量，避免把点号解释为任意字符。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
