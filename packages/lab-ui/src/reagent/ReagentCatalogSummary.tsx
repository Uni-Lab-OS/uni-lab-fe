import type { ReagentInfo } from '@unilab-fe/core'

import { cx } from '../classNames'
export function ReagentCatalogSummary({ info }: { readonly info: ReagentInfo }) {
  return (
    <div className={cx('primary-cell')}>
      <strong>{info.name}</strong>
      <span>
        {info.nameEn ?? '未提供英文名'}
        {info.molecularFormula ? ` / ${info.molecularFormula}` : ''}
      </span>
    </div>
  )
}
