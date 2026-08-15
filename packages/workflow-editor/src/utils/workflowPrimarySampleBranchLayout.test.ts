import { describe, expect, it } from 'vitest'

import type { WorkflowNode } from './parseWorkflow'
import {
  packWorkflowSupportingBranches,
  WORKFLOW_SUPPORTING_BRANCH_MATERIAL_SOURCE_PITCH,
  WORKFLOW_SUPPORTING_BRANCH_NODE_GAP,
  type WorkflowSupportingBranch
} from './workflowPrimarySampleBranchLayout'

describe('packWorkflowSupportingBranches', () => {
  /** 验证共享接入动作的短支线优先横向扇入，而不是形成长距离竖塔。 */
  it('fans sibling branches into the same compact band', () => {
    const branches: WorkflowSupportingBranch[] = [
      supportingBranch('reagent-a', 0),
      supportingBranch('reagent-b', 1),
      supportingBranch('reagent-c', 2)
    ]

    const bands = packWorkflowSupportingBranches(branches, 72, 328, 4)
    const firstBandX = bands[0]?.map(({ x }) => x) ?? []

    expect(bands).toHaveLength(1)
    expect(firstBandX).toEqual([
      72 - WORKFLOW_SUPPORTING_BRANCH_NODE_GAP -
        2 * WORKFLOW_SUPPORTING_BRANCH_MATERIAL_SOURCE_PITCH,
      72 - WORKFLOW_SUPPORTING_BRANCH_NODE_GAP -
        WORKFLOW_SUPPORTING_BRANCH_MATERIAL_SOURCE_PITCH,
      72 - WORKFLOW_SUPPORTING_BRANCH_NODE_GAP
    ])
    expect(firstBandX[1]! - firstBandX[0]!)
      .toBe(WORKFLOW_SUPPORTING_BRANCH_MATERIAL_SOURCE_PITCH)
    expect(firstBandX[2]! - firstBandX[1]!)
      .toBe(WORKFLOW_SUPPORTING_BRANCH_MATERIAL_SOURCE_PITCH)
    expect(bands.flat()).toHaveLength(3)
  })

  /** 反向蛇形行的来源簇仍应位于接入点右侧，并保持相同紧凑节距。 */
  it('keeps a compact source cluster in front of a reverse row attachment', () => {
    const branches: WorkflowSupportingBranch[] = [
      supportingBranch('consumable-a', 0, 4, 3),
      supportingBranch('consumable-b', 1, 4, 3),
      supportingBranch('consumable-c', 2, 4, 3)
    ]
    const anchorX = 72 + 3 * 328

    const bands = packWorkflowSupportingBranches(branches, 72, 328, 4)
    const positions = bands[0]?.map(({ x }) => x) ?? []

    expect(bands).toHaveLength(1)
    expect(positions.every((x) => x > anchorX)).toBe(true)
    expect(positions[1]! - positions[0]!)
      .toBe(WORKFLOW_SUPPORTING_BRANCH_MATERIAL_SOURCE_PITCH)
    expect(positions[2]! - positions[1]!)
      .toBe(WORKFLOW_SUPPORTING_BRANCH_MATERIAL_SOURCE_PITCH)
  })

})

/** 创建接入第一列主样品动作的单节点辅助物料支线。 */
function supportingBranch(
  id: string,
  order: number,
  anchorIndex = 0,
  anchorColumn = 0
): WorkflowSupportingBranch {
  const node: WorkflowNode = {
    id,
    name: id,
    type: 'material_source',
    className: 'MaterialSource',
    labNodeType: 'MaterialSource'
  }
  return {
    nodes: [node],
    anchorIndex,
    anchorColumn,
    order,
    flowDirection: 'into-primary'
  }
}
