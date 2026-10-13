import type { ManualOperationEntry } from './manualHandlingModel'

/**
 * 人工处理弹窗的草稿。
 *
 * 为什么必须持久化：这个界面在设备旁边用，会锁屏、会切后台、会被别人叫走。
 * 如果关掉弹窗就丢，模态就变成了危险容器。
 *
 * 三条自我约束（和 OS 控制台同一套规则）：
 * 1. **只恢复输入草稿，绝不从浏览器存储恢复任何人工确认**（勾选、承担风险之类）——
 *    那些必须是本次操作员当场做出的。
 * 2. 未提交的请求身份（幂等键）由 provider 独立保存，不和草稿混在一起。
 * 3. 存储不可用时不能让功能失效：读失败退化成空草稿，写失败静默忽略。
 */
export interface ManualHandlingDraft {
  readonly entries: readonly ManualOperationEntry[]
  readonly note: string
  readonly deviceId: string
  readonly actionId: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly materialUuid: string
  /** 空串表示「移出当前库位 / 不指定库位」—— 与 OS 的线协议一致。 */
  readonly parentUuid: string
  readonly siteUuid: string
  readonly occupancyIds: readonly string[]
  readonly occupancyReason: string
  /** 物料位置登记的「登记原因」；和占用释放的原因分开，两个表单不能串味。 */
  readonly materialReason: string
}

export const EMPTY_MANUAL_DRAFT: ManualHandlingDraft = {
  entries: [],
  note: '',
  deviceId: '',
  actionId: '',
  parameters: {},
  materialUuid: '',
  parentUuid: '',
  siteUuid: '',
  occupancyIds: [],
  occupancyReason: '',
  materialReason: '',
}

/** 草稿必须与会话绑定：换了会话（另一条错误）不能把上一个会话的输入带进来。 */
export function manualDraftKey(apiUrl: string, stationId: string, sessionId: string): string {
  return `unilab:manual-draft:${apiUrl}:${stationId}:${sessionId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readEntries(value: unknown): readonly ManualOperationEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const { id, kind, label, commandUuid, manualCommandId, createdAt } = item
    if (typeof id !== 'string' || typeof label !== 'string' || typeof createdAt !== 'string')
      return []
    if (kind !== 'device' && kind !== 'material' && kind !== 'occupancy') return []
    return [
      {
        id,
        kind,
        label,
        commandUuid: typeof commandUuid === 'string' ? commandUuid : null,
        manualCommandId: typeof manualCommandId === 'string' ? manualCommandId : null,
        createdAt,
      },
    ]
  })
}

function readStringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * 读取草稿。任何形状不对的字段都退回默认值 —— 宁可让用户重填一项，
 * 也不能把半截数据当成可信输入送进提交。
 */
export function loadManualDraft(key: string): ManualHandlingDraft {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (!isRecord(parsed)) return EMPTY_MANUAL_DRAFT
    return {
      entries: readEntries(parsed.entries),
      note: typeof parsed.note === 'string' ? parsed.note : '',
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : '',
      actionId: typeof parsed.actionId === 'string' ? parsed.actionId : '',
      parameters: isRecord(parsed.parameters) ? parsed.parameters : {},
      materialUuid: typeof parsed.materialUuid === 'string' ? parsed.materialUuid : '',
      parentUuid: typeof parsed.parentUuid === 'string' ? parsed.parentUuid : '',
      siteUuid: typeof parsed.siteUuid === 'string' ? parsed.siteUuid : '',
      occupancyIds: readStringList(parsed.occupancyIds),
      occupancyReason: typeof parsed.occupancyReason === 'string' ? parsed.occupancyReason : '',
      materialReason: typeof parsed.materialReason === 'string' ? parsed.materialReason : '',
    }
  } catch {
    return EMPTY_MANUAL_DRAFT
  }
}

export function saveManualDraft(key: string, draft: ManualHandlingDraft): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // 存储不可用（隐私模式 / 配额满）时仍保留本次打开期间的输入。
  }
}

export function clearManualDraft(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // 同上：清不掉也不能让提交路径失败。
  }
}
