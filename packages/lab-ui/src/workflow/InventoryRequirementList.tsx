import { clsx } from 'clsx'
import sharedStyles from '../shared.module.scss'
import workflowStyles from '../workflow.module.scss'
import type { InventoryRequirement } from '@unilab-fe/core'

export interface InventoryRequirementListProps {
  readonly requirements: readonly InventoryRequirement[]
  readonly emptyDescription?: string
  /** 库存需求键对应的库位名，来自工作流图里的来源库位。 */
  readonly siteNames?: Readonly<Record<string, string>>
}

/** 工作流声明的物料/库存需求只读投影，不代表已经完成资源预留。 */
export function InventoryRequirementList({
  requirements,
  emptyDescription = '该工作流没有声明库存需求',
  siteNames = {},
}: InventoryRequirementListProps) {
  if (requirements.length === 0) {
    return <p className={clsx(sharedStyles['lab-ui-list-empty'])}>{emptyDescription}</p>
  }

  return (
    <ul className={clsx(workflowStyles['lab-ui-requirement-list'])} aria-label="库存需求列表">
      {requirements.map((requirement) => (
        <InventoryRequirementItem
          key={requirement.uuid}
          requirement={requirement}
          siteName={siteNames[requirement.requirementKey]}
        />
      ))}
    </ul>
  )
}

function InventoryRequirementItem({
  requirement,
  siteName,
}: {
  readonly requirement: InventoryRequirement
  readonly siteName?: string
}) {
  return (
    <li>
      <div>
        <strong>{requirement.requirementKey}</strong>
        {siteName ? <span>库位 {siteName}</span> : null}
        {requirement.description && <span>{requirement.description}</span>}
      </div>
      <span className={clsx(workflowStyles['lab-ui-requirement-list__quantity'])}>
        {requirement.requiredQuantity} {requirement.quantityUnit}
        {requirement.allowSplit ? ' · 可拆分' : ''}
      </span>
    </li>
  )
}
