import { clsx } from 'clsx'
import reagentStyles from '../reagent.module.scss'
export interface ReagentHistoryItem {
  readonly eventType: string
  readonly quantityDelta?: number | null
  readonly quantityUnit?: string | null
  readonly recordedAt: string
  readonly operatorType: string
}

export interface ReagentHistoryListProps {
  readonly items: readonly ReagentHistoryItem[]
  readonly emptyDescription?: string
}

export function ReagentHistoryList({
  items,
  emptyDescription = '暂无库存变更记录',
}: ReagentHistoryListProps) {
  if (items.length === 0) {
    return (
      <p className={clsx(reagentStyles['lab-ui-reagent-history__empty'])}>{emptyDescription}</p>
    )
  }

  return (
    <ul className={clsx(reagentStyles['history-list'], reagentStyles['lab-ui-reagent-history'])}>
      {items.map((item, index) => (
        <ReagentHistoryItemView key={`${item.recordedAt}-${item.eventType}-${index}`} item={item} />
      ))}
    </ul>
  )
}

function ReagentHistoryItemView({ item }: { readonly item: ReagentHistoryItem }) {
  const quantity =
    item.quantityDelta == null ? '数量未提供' : `${item.quantityDelta} ${item.quantityUnit ?? ''}`

  return (
    <li>
      <div>
        <strong>{item.eventType}</strong>
        <span>{quantity}</span>
      </div>
      <small>
        {item.recordedAt} / {item.operatorType}
      </small>
    </li>
  )
}
