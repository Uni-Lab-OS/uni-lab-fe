import { clsx } from 'clsx'
import materialStyles from '../material.module.scss'
import runStyles from '../run.module.scss'
import sharedStyles from '../shared.module.scss'
import workflowStyles from '../workflow.module.scss'
import type { InventoryRequirement } from '@unilab-fe/core'

export interface InventoryRequirementListProps {
  readonly requirements: readonly InventoryRequirement[]
  readonly emptyDescription?: string
}

/** 工作流声明的物料/库存需求只读投影，不代表已经完成资源预留。 */
export function InventoryRequirementList({
  requirements,
  emptyDescription = '该工作流没有声明库存需求',
}: InventoryRequirementListProps) {
  if (requirements.length === 0) {
    return <p className={clsx(sharedStyles['lab-ui-list-empty'])}>{emptyDescription}</p>
  }

  return (
    <ul
      className={clsx(
        materialStyles['lab-ui-requirement-list'],
        runStyles['lab-ui-requirement-list'],
        workflowStyles['lab-ui-requirement-list'],
      )}
      aria-label="库存需求列表"
    >
      {requirements.map((requirement) => (
        <InventoryRequirementItem key={requirement.uuid} requirement={requirement} />
      ))}
    </ul>
  )
}

function InventoryRequirementItem({ requirement }: { readonly requirement: InventoryRequirement }) {
  return (
    <li>
      <div>
        <strong>{requirement.requirementKey}</strong>
        {requirement.description && <span>{requirement.description}</span>}
      </div>
      <span className={clsx(workflowStyles['lab-ui-requirement-list__quantity'])}>
        {requirement.requiredQuantity} {requirement.quantityUnit}
        {requirement.allowSplit ? ' · 可拆分' : ''}
      </span>
    </li>
  )
}
