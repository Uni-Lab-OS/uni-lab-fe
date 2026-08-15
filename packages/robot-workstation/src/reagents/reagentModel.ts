import type { ReagentLedgerRow, ReagentRecord } from '../types'

export interface ReagentRegistrationInput {
  reagentId: string
  densityValue: number
  densityUnit: string
  densityCondition: string
  supplier: string
  registeredOn: string
  expiresOn: string
  quantity: number
  unit: string
  siteId: string
  custom: ReagentLedgerRow['custom']
}

/** 可用量始终是剩余量减预留量，且不允许出现负值。 */
export function calculateAvailableQuantity(row: Pick<ReagentLedgerRow, 'remainingQuantity' | 'reservedQuantity'>): number {
  return Math.max(0, roundQuantity(row.remainingQuantity - row.reservedQuantity))
}

/** 验证登记不变量，避免无效日期、非正数量或负可用量进入台账。 */
export function validateRegistration(input: ReagentRegistrationInput): string | null {
  if (!input.reagentId || !input.siteId) return '请选择有效试剂和库位'
  if (!Number.isFinite(input.densityValue) || input.densityValue <= 0) return '密度必须为正数'
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return '初始数量必须为正数'
  if (!input.supplier.trim()) return '供应商不能为空'
  if (!input.registeredOn || !input.expiresOn || input.expiresOn < input.registeredOn) {
    return '有效期不能早于登记日期'
  }
  return null
}

/** 只有可信 success 记录才能改变数量；未知执行结果仅追加审计记录。 */
export function applyReagentRecord(row: ReagentLedgerRow, record: ReagentRecord): ReagentLedgerRow {
  const next = { ...row, records: [...row.records, record] }
  if (record.result !== 'success' || !record.trusted) return next
  if (record.quantityDelta === null) return next
  const remainingQuantity = Math.max(row.reservedQuantity, roundQuantity(row.remainingQuantity + record.quantityDelta))
  return { ...next, remainingQuantity }
}

/** 生成稳定的前端演示身份；不会冒充库存或物料权威标识。 */
export function createLocalIdentity(prefix: string, sequence: number): string {
  const random = globalThis.crypto?.randomUUID?.()
  return random ? `${prefix}-${random}` : `${prefix}-${Date.now()}-${sequence}`
}

function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
