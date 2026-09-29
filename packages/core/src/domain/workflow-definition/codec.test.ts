import { describe, expect, it } from 'vitest'
import {
  decodePublishedWorkflow,
  decodePublishedWorkflowList
} from './codec'

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
        workflow: {
          uuid: 'wf-1',
          revision: 3,
          meta_data: {
            unilab: {
              input_contract: {
                version: 1,
                parameters: [
                  {
                    name: 'volume',
                    required: true,
                    schema: { type: 'number', minimum: 0 }
                  },
                  {
                    name: 'enabled',
                    required: false,
                    default: true,
                    schema: { type: 'boolean' }
                  }
                ]
              }
            }
          }
        },
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
    expect(result.graph.inputParameters).toEqual([
      { name: 'volume', required: true, schema: { type: 'number', minimum: 0 } },
      { name: 'enabled', required: false, defaultValue: true, schema: { type: 'boolean' } }
    ])
  })

  it('rejects an unsupported workflow type', () => {
    expect(() => decodePublishedWorkflow(
      { uuid: 'wf-1', name: 'Unknown', revision: 1, workflow_type: 'future', status: 'published' },
      { workflow: { uuid: 'wf-1' }, nodes: [], edges: [], node_templates: [], handle_templates: [] }
    )).toThrowError('unsupported')
  })

  it('unwraps the published list envelope and rejects duplicate identities', () => {
    expect(decodePublishedWorkflowList({
      code: 0,
      data: {
        items: [{
          uuid: 'wf-1', name: 'Published', revision: 1,
          workflow_type: 'workflow', status: 'published'
        }],
        page: 1,
        page_size: 20,
        has_more: false
      }
    })).toMatchObject([{ workflowUuid: 'wf-1', revision: 1 }])

    expect(() => decodePublishedWorkflowList({
      items: [
        { uuid: 'wf-1', name: 'One', revision: 1, workflow_type: 'workflow', status: 'published' },
        { uuid: 'wf-1', name: 'Duplicate', revision: 2, workflow_type: 'workflow', status: 'published' }
      ]
    })).toThrow('duplicate workflow uuid')
  })

  it('normalizes SZLab source workflows into the regular workflow type', () => {
    expect(decodePublishedWorkflowList({
      items: [{
        uuid: 'wf-source',
        name: 'Source workflow',
        revision: 2,
        workflow_type: 'normal',
        status: 'source'
      }]
    })).toMatchObject([{
      workflowUuid: 'wf-source',
      workflowType: 'workflow',
      status: 'source'
    }])
  })

  it('rejects revision drift between the summary and graph snapshot', () => {
    expect(() => decodePublishedWorkflow(
      { uuid: 'wf-1', name: 'Published', revision: 2, workflow_type: 'workflow', status: 'published' },
      {
        code: 0,
        data: {
          workflow: { uuid: 'wf-1', revision: 1 },
          nodes: [],
          edges: [],
          node_templates: [],
          handle_templates: [],
          inventory_requirements: []
        }
      }
    )).toThrow('revisions differ')
  })
})
