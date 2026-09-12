import type { WorkflowLoadingRow } from '@unilab/services'
export type { WorkflowLoadingRow } from '@unilab/services'

/** 只读 UI 模型，不是上料提交 DTO；确认协议冻结后由 services 显式适配。 */
export interface WorkflowLoadingView {
  title: string
  description?: string
  rows: readonly WorkflowLoadingRow[]
  status: 'open' | 'selected'
  deliveryStatus: 'none' | 'pending' | 'accepted' | 'unknown'
}

export function loadingConfirmationDisabledReason(
  view: WorkflowLoadingView,
  online: boolean,
  busy: boolean,
  confirmationAvailable: boolean
): string | null {
  if (!online) return '连接离线，恢复并重新读取后才能确认'
  if (busy) return '正在提交，请等待服务确认'
  if (view.status !== 'open') return '确认已提交，等待服务更新库存'
  if (!confirmationAvailable) return '当前服务尚未提供入库确认能力'
  if (!view.rows.length) return '服务尚未提供待入库明细'
  if (view.rows.some(row => !Number.isFinite(row.quantity) || row.quantity <= 0 || !row.unit.trim())) {
    return '入库数量或单位缺失，请重新读取'
  }
  const unavailable = view.rows.find(row => !row.availability.allowed)
  return unavailable ? unavailable.availability.reason || '部分目标库位不可用，请重新读取' : null
}
