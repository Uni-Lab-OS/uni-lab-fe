import { clsx } from 'clsx'
import deviceStyles from '../device.module.scss'
import reagentStyles from '../reagent.module.scss'
import type { ReagentInfo } from '@unilab-fe/core'

export function ReagentCatalogSummary({ info }: { readonly info: ReagentInfo }) {
  return (
    <div className={clsx(deviceStyles['primary-cell'], reagentStyles['primary-cell'])}>
      <strong>{info.name}</strong>
      <span>
        {info.nameEn ?? '未提供英文名'}
        {info.molecularFormula ? ` / ${info.molecularFormula}` : ''}
      </span>
    </div>
  )
}
