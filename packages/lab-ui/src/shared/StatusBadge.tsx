import { clsx } from 'clsx'
import sharedStyles from '../shared.module.scss'
import { Icon } from '@unilab/design-v2/icons'
import type { IconName } from '@unilab/design-v2/icons'

export type StatusTone = 'success' | 'warning' | 'error' | 'neutral' | 'info'

export interface StatusMeta {
  readonly label: string
  readonly tone: StatusTone
  readonly icon: IconName
}

export interface StatusBadgeProps {
  readonly status?: string
  readonly meta?: StatusMeta
  readonly label?: string
  readonly className?: string
}

const commonStatusMeta: Readonly<Record<string, StatusMeta>> = {
  success: { label: '已完成', tone: 'success', icon: 'general/check-circle' },
  succeeded: { label: '已完成', tone: 'success', icon: 'general/check-circle' },
  completed: { label: '已完成', tone: 'success', icon: 'general/check-circle' },
  running: { label: '执行中', tone: 'warning', icon: 'media/play-circle' },
  waiting: { label: '等待中', tone: 'warning', icon: 'time/clock' },
  queued: { label: '待调度', tone: 'warning', icon: 'time/clock' },
  pending: { label: '未到达', tone: 'neutral', icon: 'general/minus-circle' },
  admission_blocked: { label: '阻断', tone: 'error', icon: 'alerts-feedback/alert-circle' },
  blocked: { label: '阻断', tone: 'error', icon: 'alerts-feedback/alert-circle' },
  attention: { label: '异常', tone: 'error', icon: 'alerts-feedback/alert-circle' },
  failed: { label: '失败', tone: 'error', icon: 'alerts-feedback/alert-circle' },
  timeout: { label: '已超时', tone: 'error', icon: 'alerts-feedback/alert-circle' },
  canceled: { label: '已取消', tone: 'neutral', icon: 'general/slash-circle-01' },
  cancelled: { label: '已取消', tone: 'neutral', icon: 'general/slash-circle-01' },
  skipped: { label: '已跳过', tone: 'neutral', icon: 'media/skip-forward' },
  offline: { label: '离线', tone: 'neutral', icon: 'general/slash-circle-01' },
  available: { label: '可用', tone: 'success', icon: 'general/check-circle' },
  empty: { label: '空', tone: 'neutral', icon: 'general/minus-circle' },
  quarantined: { label: '隔离', tone: 'error', icon: 'alerts-feedback/alert-circle' },
  manual: { label: '待人工确认', tone: 'warning', icon: 'users/user-check-01' },
  intervention_required: { label: '待人工确认', tone: 'warning', icon: 'users/user-check-01' },
  unknown: { label: '结果待核对', tone: 'error', icon: 'general/help-circle' },
}

/** 状态值到稳定呈现元数据的公共映射；领域 adapter 可覆盖返回值。 */
export function statusMeta(status: string): StatusMeta {
  return (
    commonStatusMeta[status.toLowerCase()] ?? {
      label: status || '状态未知',
      tone: 'neutral',
      icon: 'general/info-circle',
    }
  )
}

/** 不读取领域状态的状态胶囊；调用方通过 status 或显式 meta 提供语义。 */
export function StatusBadge({ status = 'unknown', meta, label, className }: StatusBadgeProps) {
  const resolved = meta ?? statusMeta(status)
  return (
    <span
      className={clsx(
        sharedStyles['lab-ui-status-badge'],
        sharedStyles[`lab-ui-status-badge--${resolved.tone}`],
        className,
      )}
      role="status"
    >
      <span className={clsx(sharedStyles['lab-ui-status-badge__icon'])} aria-hidden="true">
        <Icon name={resolved.icon} size={14} color="inherit" />
      </span>
      <span>{label ?? resolved.label}</span>
    </span>
  )
}
