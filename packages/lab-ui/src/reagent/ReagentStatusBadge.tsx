import { cx } from '../classNames'
export interface ReagentStatusBadgeProps {
  readonly status: string
}

/** 试剂库存状态的统一呈现。状态值由后端保留，组件只负责视觉语义映射。 */
export function ReagentStatusBadge({ status }: ReagentStatusBadgeProps) {
  const tone = status === 'available' ? 'available' : status === 'empty' ? 'empty' : 'warning'
  return <span className={cx('lab-ui-reagent-status', `lab-ui-reagent-status--${tone}`)}>{status}</span>
}
