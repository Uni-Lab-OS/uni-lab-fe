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
    return <p className="lab-ui-list-empty">{emptyDescription}</p>
  }

  return (
    <ul className="lab-ui-requirement-list" aria-label="库存需求列表">
      {requirements.map((requirement) => (
        <InventoryRequirementItem
          key={requirement.uuid}
          requirement={requirement}
        />
      ))}
    </ul>
  )
}

function InventoryRequirementItem({
  requirement,
}: {
  readonly requirement: InventoryRequirement
}) {
  return (
    <li>
      <div>
        <strong>{requirement.requirementKey}</strong>
        {requirement.description && <span>{requirement.description}</span>}
      </div>
      <span className="lab-ui-requirement-list__quantity">
        {requirement.requiredQuantity} {requirement.quantityUnit}
        {requirement.allowSplit ? ' · 可拆分' : ''}
      </span>
    </li>
  )
}
