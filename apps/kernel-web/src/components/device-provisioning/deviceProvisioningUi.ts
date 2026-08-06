import type {
  LocalDeviceProvisioning,
  LocalDeviceProvisioningStatus
} from '@unilab/device-provisioning'

export type DeviceProvisioningApi = NonNullable<
  NonNullable<Window['api']>['deviceProvisioning']
>

export type ProvisioningTone = 'neutral' | 'working' | 'ready' | 'danger'

export interface ProvisioningStatusView {
  label: string
  description: string
  tone: ProvisioningTone
}

export interface ConfigurationField {
  name: string
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array'
  required: boolean
  secret: boolean
  defaultValue: unknown
  annotation: string
}

export interface DeviceSquarePageCursor {
  /** 当前筛选条件下已进入 Renderer 投影的去重设备数。 */
  loadedItems: number
  /** 最近一次成功响应的 Backend 正整数页码。 */
  loadedPage: number
  /** Backend 对当前筛选条件返回的权威总数。 */
  total: number
}

const STATUS_VIEW: Record<
  LocalDeviceProvisioningStatus,
  ProvisioningStatusView
> = {
  requested: { label: '已登记', description: '等待解析云端发布信息', tone: 'working' },
  resolving: { label: '解析中', description: '正在确认设备定义与包摘要', tone: 'working' },
  downloading: { label: '下载中', description: '正在下载并校验设备包', tone: 'working' },
  package_cached: { label: '已缓存', description: '设备包已进入 OS 受管缓存', tone: 'working' },
  configuration_required: { label: '待配置', description: '填写驱动初始化参数后写入设备图', tone: 'working' },
  graph_staged: { label: '已写图', description: '设备实例已原子写入当前设备图', tone: 'working' },
  restart_required: { label: '待激活', description: '重启当前 Edge 并对账设备与 Action', tone: 'working' },
  activating: { label: '激活中', description: '正在受控重启本地 Edge', tone: 'working' },
  driver_ready: { label: '驱动已加载', description: '设备在线，正在核验 Action 合同', tone: 'working' },
  ready: { label: '可运行', description: '设备在线且 Action 合同可用', tone: 'ready' },
  failed: { label: '失败', description: '查看诊断并按可用方式处理', tone: 'danger' },
  canceled: { label: '已回滚', description: '设备图已恢复到接入前状态', tone: 'neutral' },
  removing: { label: '移除中', description: '正在安全移除本地设备实例', tone: 'working' },
  removed: { label: '已移除', description: '设备实例已从当前设备图移除', tone: 'neutral' }
}

/** 把接入状态投影为同时包含文字和色彩语义的界面描述。 */
export function provisioningStatusView(
  status: LocalDeviceProvisioningStatus
): ProvisioningStatusView {
  return STATUS_VIEW[status]
}

/** 把 OS 固定 JSON Schema 投影为首版可编辑字段集合。 */
export function configurationFields(
  schema: Record<string, unknown>
): ConfigurationField[] {
  const properties = record(schema.properties)
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : []
  )
  return Object.entries(properties).map(([name, raw]) => {
    const property = record(raw)
    return {
      name,
      type: configurationType(property.type),
      required: required.has(name),
      secret: property['x-unilab-secret'] === true,
      defaultValue: property.default,
      annotation: typeof property['x-python-annotation'] === 'string'
        ? property['x-python-annotation']
        : ''
    }
  })
}

/** 用 Schema 静态默认值初始化表单草稿，不伪造必填值。 */
export function initialConfigurationDraft(
  fields: readonly ConfigurationField[],
  existing: Record<string, unknown> | null
): Record<string, string | boolean> {
  const draft: Record<string, string | boolean> = {}
  for (const field of fields) {
    if (field.secret) {
      draft[field.name] = ''
      continue
    }
    const value = existing?.[field.name] ?? field.defaultValue
    if (field.type === 'boolean') {
      draft[field.name] = value === true
    } else if (value === undefined) {
      draft[field.name] = ''
    } else if (field.type === 'object' || field.type === 'array') {
      draft[field.name] = JSON.stringify(value, null, 2)
    } else {
      draft[field.name] = String(value)
    }
  }
  return draft
}

/**
 * 按字段类型把界面草稿还原为严格 JSON 配置。
 *
 * @param fields OS 设备定义生成的固定字段合同。
 * @param draft 用户当前表单输入。
 * @returns 可提交给 Main 的普通 JSON object。
 * @throws 必填值为空、数字无效或结构化 JSON 解析失败时抛出可行动错误。
 */
export function parseConfigurationDraft(
  fields: readonly ConfigurationField[],
  draft: Record<string, string | boolean>
): Record<string, unknown> {
  const configuration: Record<string, unknown> = {}
  for (const field of fields) {
    const value = draft[field.name]
    if (field.type === 'boolean') {
      configuration[field.name] = value === true
      continue
    }
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) {
      if (field.required) throw new Error(`${field.name} 是必填配置`)
      continue
    }
    if (field.type === 'integer' || field.type === 'number') {
      const number = Number(text)
      if (!Number.isFinite(number) || (field.type === 'integer' && !Number.isInteger(number))) {
        throw new Error(`${field.name} 必须是${field.type === 'integer' ? '整数' : '数字'}`)
      }
      configuration[field.name] = number
      continue
    }
    if (field.type === 'object' || field.type === 'array') {
      const parsed: unknown = JSON.parse(text)
      if (
        (field.type === 'array' && !Array.isArray(parsed))
        || (field.type === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)))
      ) {
        throw new Error(`${field.name} 必须是 JSON ${field.type}`)
      }
      configuration[field.name] = parsed
      continue
    }
    configuration[field.name] = text
  }
  return configuration
}

/** 为云端模板生成可编辑、稳定且不含空格的本地实例 ID 建议。 */
export function suggestedInstanceId(record: LocalDeviceProvisioning): string {
  const source = record.cloudDeviceName || record.cloudDisplayName || 'device'
  const normalized = source
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return `local-${normalized || 'device'}`.slice(0, 80)
}

/**
 * 按云端模板稳定 UUID 合并分页，保留已加载顺序并用新页刷新重复项。
 *
 * @param current 当前 Renderer 已投影的设备卡片。
 * @param incoming Backend 返回的新一页设备卡片。
 * @returns 不含重复模板 UUID 的完整已加载列表。
 */
export function mergeDeviceSquareItems<Item extends { templateUuid: string }>(
  current: readonly Item[],
  incoming: readonly Item[]
): Item[] {
  const incomingByTemplate = new Map(
    incoming.map((item) => [item.templateUuid, item] as const)
  )
  const merged = current.map(
    (item) => incomingByTemplate.get(item.templateUuid) ?? item
  )
  const knownTemplateUuids = new Set(
    current.map((item) => item.templateUuid)
  )
  for (const item of incoming) {
    if (knownTemplateUuids.has(item.templateUuid)) continue
    merged.push(item)
    knownTemplateUuids.add(item.templateUuid)
  }
  return merged
}

/**
 * 从 Backend 分页事实计算下一页，不用首屏 pageSize 猜测总量。
 *
 * @param cursor 已加载条数、最近成功页码和云端总数。
 * @returns 尚有设备时返回下一页页码，目录已完整时返回 null。
 */
export function nextDeviceSquarePage(
  cursor: DeviceSquarePageCursor
): number | null {
  if (cursor.loadedItems >= cursor.total) return null
  return Math.max(1, cursor.loadedPage + 1)
}

/** 把跨进程 unknown 异常收敛为界面可展示正文。 */
export function uiErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 把 unknown 安全收窄为普通对象；无效值按空对象处理。 */
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** 把 JSON Schema 类型收敛为首版支持集合，未知注解使用 object 编辑器。 */
function configurationType(value: unknown): ConfigurationField['type'] {
  return value === 'string'
    || value === 'integer'
    || value === 'number'
    || value === 'boolean'
    || value === 'array'
    || value === 'object'
    ? value
    : 'object'
}
