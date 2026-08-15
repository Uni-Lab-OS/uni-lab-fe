import { describe, expect, it } from 'vitest'

import { workflowNodeVisualKind } from './workflowNodeVisualKind'

describe('workflowNodeVisualKind', () => {
  it.each([
    { symbol: 's_z_lab_标准物料转运' },
    { symbol: 'material_transfer' },
    { definitionFqid: 'szlab_poly_studio.workflows.material_transfer.s_z_lab_标准物料转运' },
  ])('recognizes a published standard material transfer identity', (source) => {
    expect(workflowNodeVisualKind(source)).toBe('robot-transfer')
  })

  it.each([
    { symbol: 'robot_a_material_transfer' },
    { symbol: 'robot_b_material_transfer' },
    {
      definitionFqid:
        'pylabrobot_unilab.workflows.material_transfer_robot_a.' +
        'robot_a_material_transfer'
    },
    {
      definitionFqid:
        'pylabrobot_unilab.workflows.material_transfer_robot_b.' +
        'robot_b_material_transfer'
    }
  ])('recognizes a uniquely prefixed standard material transfer symbol', (source) => {
    expect(workflowNodeVisualKind(source)).toBe('robot-transfer')
  })

  it.each([
    { definitionFqid: 'example.material_transfer.cleanup' },
    { definitionFqid: 'example.workflows.material_transfer' },
    { definitionFqid: 'community.pylabrobot_unilab.robot_a_material_transfer' },
    { definitionFqid: 'community.pylabrobot_unilab.robot_b_material_transfer' },
    { symbol: 'robot_a_material_transfer_preview' },
    { symbol: 's_z_lab_标准物料转运_preview' },
    { symbol: 'material_transfer_cleanup' },
    { definitionFqid: 'example.workflows.robot_b_material_transfer_draft' },
    { symbol: 'sample_material_transfer' },
    { definitionFqid: 'example.workflows.delete_material_transfer' }
  ])('does not match an unrelated similarly named workflow identity', (source) => {
    expect(workflowNodeVisualKind(source)).toBeUndefined()
  })

  it('does not infer transfer semantics from unrelated published identities', () => {
    expect(workflowNodeVisualKind({
      symbol: 'move_material_for_assay',
      definitionFqid: 'example.workflows.prepare_sample'
    })).toBeUndefined()
  })
})
