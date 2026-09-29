import type { ReagentInfo } from '@unilab-fe/core'

export function ReagentCatalogDetail({ info }: { readonly info: ReagentInfo }) {
  const rows = [
    ['名称', info.name],
    ['英文名', info.nameEn],
    ['CAS 号', info.cas],
    ['分子式', info.molecularFormula],
    ['物态', info.physicalState],
    ['分子量', info.molecularWeight == null ? null : `${info.molecularWeight} g/mol`],
    ['描述', info.description],
  ] as const
  return (
    <dl className="lab-ui-reagent-catalog-detail">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || '未提供'}</dd>
        </div>
      ))}
    </dl>
  )
}
