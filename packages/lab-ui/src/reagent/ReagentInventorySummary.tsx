import type { Reagent } from '@unilab-fe/core'
import { ReagentStatusBadge } from './ReagentStatusBadge'

export function ReagentInventorySummary({ reagent }: { readonly reagent: Reagent }) {
  return (
    <div className="primary-cell">
      <strong>{reagent.name}</strong>
      <span>
        {reagent.containerName ?? '容器未提供'}
        {reagent.containerBarcode ? ` / ${reagent.containerBarcode}` : ''}
      </span>
    </div>
  )
}

export function ReagentQuantitySummary({ reagent }: { readonly reagent: Reagent }) {
  return (
    <div className="amount-cell">
      <strong>
        {reagent.quantity == null ? '未提供' : `${reagent.quantity} ${reagent.quantityUnit ?? ''}`}
      </strong>
      {reagent.status && <ReagentStatusBadge status={reagent.status} />}
    </div>
  )
}
