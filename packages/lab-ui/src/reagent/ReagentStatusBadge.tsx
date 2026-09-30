import { StatusBadge, statusMeta } from '../shared/StatusBadge'

export interface ReagentStatusBadgeProps {
  readonly status: string
  readonly label?: string
}

/** 试剂库存状态的统一呈现。状态值由后端保留，组件只负责视觉语义映射。 */
export function ReagentStatusBadge({ status, label }: ReagentStatusBadgeProps) {
  const meta = status === 'available'
    ? statusMeta('available')
    : status === 'empty'
      ? statusMeta('empty')
      : { ...statusMeta('waiting'), label: label ?? status }
  return <StatusBadge status={status} meta={meta} label={label} />
}
