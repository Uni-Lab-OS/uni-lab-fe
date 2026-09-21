import { ServiceError } from './errors'

/** 解析闭合对象；参数是原始值与允许键，返回记录，出现缺失/额外键时关闭失败。 */
export function closedRecord(
  raw: unknown,
  keys: string[]
): Record<string, unknown> {
  const value = recordValue(raw)
  requireKeys(value, keys)
  return value
}

/**
 * 解析闭合对象，并允许一组可选键。
 *
 * @param raw 未信任对象。
 * @param required 必须出现的键。
 * @param optional 允许出现、但可缺省的额外键。
 * @returns 已核对键集合的记录。
 * @throws 缺少必选键或出现未知键时关闭失败。
 */
export function closedRecordAllowing(
  raw: unknown,
  required: string[],
  optional: string[] = []
): Record<string, unknown> {
  const value = recordValue(raw)
  requireKeysAllowing(value, required, optional)
  return value
}

/** 核对对象键集合；参数是记录与允许键，无返回值，不完全相同时关闭失败。 */
export function requireKeys(
  raw: Record<string, unknown>,
  keys: string[]
): void {
  if (!sameStrings(Object.keys(raw).sort(), [...keys].sort())) invalidCatalog()
}

/**
 * 核对对象键集合：必须包含 required，且不得出现 required∪optional 之外的键。
 *
 * @param raw 已解析对象。
 * @param required 必须出现的键。
 * @param optional 允许出现、但可缺省的额外键。
 * @throws 缺少必选键或出现未知键时关闭失败。
 */
export function requireKeysAllowing(
  raw: Record<string, unknown>,
  required: string[],
  optional: string[] = []
): void {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) invalidCatalog()
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) invalidCatalog()
  }
}

/** 解析唯一字符串数组；参数是原始值，返回原顺序数组，重复值时关闭失败。 */
export function uniqueStringArray(raw: unknown): string[] {
  const values = stringArray(raw)
  if (new Set(values).size !== values.length) invalidCatalog()
  return values
}

/** 比较字符串数组顺序；参数是左右数组，返回逐项一致性，不主动抛错。 */
export function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index])
}

/** 比较字符串集合；参数是左右数组，返回无重复集合一致性，不主动抛错。 */
export function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.every((value) => right.includes(value))
}

/** 比较 JSON 结构语义；参数是左右值，返回忽略对象键顺序的一致性，不主动抛错。 */
export function jsonEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonEquals(item, right[index]))
  }
  if (
    !left || typeof left !== 'object' ||
    !right || typeof right !== 'object'
  ) return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return sameStrings(leftKeys, rightKeys) && leftKeys.every((key) =>
    jsonEquals(leftRecord[key], rightRecord[key])
  )
}

/** 解析 sha256 摘要；参数是原始值，返回规范摘要，格式非法时关闭失败。 */
export function digestValue(raw: unknown): string {
  const value = stringValue(raw)
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) invalidCatalog()
  return value
}

/** 解析绝对 Python 模块名；参数是原始值，返回模块路径，相对或非法标识时关闭失败。 */
export function absoluteModule(raw: unknown): string {
  const value = stringValue(raw)
  if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(value)) invalidCatalog()
  return value
}

/** 解析 Unicode Python 标识符；参数是原始值，返回符号名，语法非法时关闭失败。 */
export function identifierValue(raw: unknown): string {
  const value = stringValue(raw)
  if (!/^(?:[_\p{ID_Start}])(?:[_\p{ID_Continue}])*$/u.test(value)) {
    invalidCatalog()
  }
  return value
}

/** 解析 UUID；参数是原始值，返回小写 UUID，格式非法时关闭失败。 */
export function uuidValue(raw: unknown): string {
  const value = stringValue(raw)
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  ) invalidCatalog()
  return value.toLowerCase()
}

/** 解析非空且唯一的 UUID 白名单；参数是原始值，返回数组或 null，非法时关闭失败。 */
export function allowlistValue(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null
  const values = stringArray(raw).map(uuidValue)
  if (values.length === 0 || new Set(values).size !== values.length) {
    invalidCatalog()
  }
  return values
}

/** 解析普通对象；参数是原始值，返回记录，null、数组或非对象时关闭失败。 */
export function recordValue(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidCatalog()
  return raw as Record<string, unknown>
}

/** 解析节点模板详情中的对象或数据库 JSON 文本 Schema。 */
export function templateSchemaValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return recordValue(JSON.parse(raw) as unknown)
  } catch {
    return invalidCatalog()
  }
}

/** 解析对象数组；参数是原始值，返回记录数组，数组或项目无效时关闭失败。 */
export function recordArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) invalidCatalog()
  return raw.map(recordValue)
}

/** 解析字符串数组；参数是原始值，返回原数组，任一项目非字符串时关闭失败。 */
export function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
    invalidCatalog()
  }
  return raw as string[]
}

/** 解析非空字符串；参数是原始值，返回字符串，类型或长度非法时关闭失败。 */
export function stringValue(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) invalidCatalog()
  return raw
}

/** 解析可空字符串；参数是原始值，返回字符串或 null，非空值非法时关闭失败。 */
export function nullableString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  return stringValue(raw)
}

/** 解析布尔值；参数是原始值，返回布尔值，类型非法时关闭失败。 */
export function booleanValue(raw: unknown): boolean {
  if (typeof raw !== 'boolean') invalidCatalog()
  return raw
}

/** 解析正整数；参数是原始值，返回大于零整数，类型或范围非法时关闭失败。 */
export function positiveInteger(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    invalidCatalog()
  }
  return raw
}

/** 解析 ready 结构角色；参数是原始值，返回 ready 或 null，其他值时关闭失败。 */
export function structuralRoleValue(raw: unknown): 'ready' | null {
  if (raw === undefined || raw === null) return null
  if (raw !== 'ready') invalidCatalog()
  return raw
}

/** 抛出动作目录不可重试错误；无参数，永不返回。 */
export function invalidCatalog(): never {
  throw new ServiceError({
    code: 'INVALID_API_RESPONSE',
    message: 'Workflow Action Catalog 返回了无效响应',
    retryable: false
  })
}
