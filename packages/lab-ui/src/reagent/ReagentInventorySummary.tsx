import { clsx } from 'clsx'
import reagentStyles from '../reagent.module.scss'
import type { Reagent } from '@unilab-fe/core'
import { ReagentStatusBadge } from './ReagentStatusBadge'

export function ReagentQuantitySummary({ reagent }: { readonly reagent: Reagent }) {
  return (
    <div className={clsx(reagentStyles['amount-cell'])}>
      <strong>
        {reagent.quantity == null ? '未提供' : `${reagent.quantity} ${reagent.quantityUnit ?? ''}`}
      </strong>
      {reagent.status && <ReagentStatusBadge status={reagent.status} />}
    </div>
  )
}
