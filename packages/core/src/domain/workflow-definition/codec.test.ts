import { describe, expect, it } from 'vitest'
import { decodePublishedWorkflow } from './codec'

describe('workflow definition codec', () => {
  it('maps a published experiment operation and its requirements', () => {
    const result = decodePublishedWorkflow(
      {
        uuid: 'wf-1',
        name: 'Transfer sample',
        revision: 3,
        workflow_type: 'experiment_operation',
        status: 'published'
      },
      {
        workflow: { uuid: 'wf-1', revision: 3 },
        nodes: [],
        edges: [],
        node_templates: [],
        handle_templates: [],
        inventory_requirements: [{
          uuid: 'req-1',
          consume_node_uuid: 'node-1',
          requirement_key: 'buffer',
          target_type: 'reagent',
          required_quantity: 100,
          quantity_unit: 'uL',
          allow_split: false,
          meta_data: { source: 'fixture' }
        }]
      }
    )

    expect(result.workflowType).toBe('experiment_operation')
    expect(result.graph.inventoryRequirements[0]).toMatchObject({
      requirementKey: 'buffer',
      requiredQuantity: 100,
      quantityUnit: 'uL'
    })
  })

  it('rejects an unsupported workflow type', () => {
    expect(() => decodePublishedWorkflow(
      { uuid: 'wf-1', name: 'Unknown', revision: 1, workflow_type: 'future', status: 'published' },
      { workflow: { uuid: 'wf-1' }, nodes: [], edges: [], node_templates: [], handle_templates: [] }
    )).toThrowError('unsupported')
  })
})
