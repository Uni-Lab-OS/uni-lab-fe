import { clsx } from 'clsx'
import reagentStyles from '../reagent.module.scss'
import type { ReagentInfo } from '@unilab-fe/core'

export function ReagentCatalogSummary({ info }: { readonly info: ReagentInfo }) {
  return (
    <div className={clsx(reagentStyles['primary-cell'])}>
      <strong>{info.name}</strong>
      <span>
        {info.nameEn ?? '未提供英文名'}
        {info.molecularFormula ? ` / ${info.molecularFormula}` : ''}
      </span>
    </div>
  )
}
