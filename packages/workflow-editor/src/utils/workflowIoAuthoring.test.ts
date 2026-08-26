import { describe, expect, it } from 'vitest'

import type {
  WorkflowAuthoringGraph,
  WorkflowInputDescriptor,
  WorkflowOutputDescriptor,
  WorkflowValueSchema
} from '@unilab/services'

import {
  addWorkflowInput,
  addWorkflowOutput,
  bindWorkflowInput,
  bindWorkflowOutput,
  projectWorkflowIoBindingOptions,
  removeWorkflowInput,
  removeWorkflowOutput,
  unbindWorkflowInput,
  updateWorkflowInput,
  updateWorkflowOutput
} from './workflowIoAuthoring'

const workflowUuid = '60000000-0000-4000-8000-000000000001'
const targetNodeUuid = '40000000-0000-4000-8000-000000000001'
const sourceNodeUuid = '40000000-0000-4000-8000-000000000002'
const otherNodeUuid = '40000000-0000-4000-8000-000000000003'
const targetTemplateUuid = '20000000-0000-4000-8000-000000000001'
const sourceTemplateUuid = '20000000-0000-4000-8000-000000000002'
const otherTemplateUuid = '20000000-0000-4000-8000-000000000003'
const targetHandleUuid = '30000000-0000-4000-8000-000000000001'
const sourceHandleUuid = '30000000-0000-4000-8000-000000000002'
const foreignSourceHandleUuid = '30000000-0000-4000-8000-000000000003'
const resourceSourceHandleUuid = '30000000-0000-4000-8000-000000000004'
const resourceTemplateUuid = '70000000-0000-4000-8000-000000000001'
const otherResourceTemplateUuid = '70000000-0000-4000-8000-000000000002'

describe('Workflow I/O authoring', () => {
  it('adds, renames, binds, and removes an input by real target Handle UUID', () => {
    const added = addWorkflowInput(emptyIoGraph(), input('count'))
    const bound = bindWorkflowInput(added, {
      parameter: 'count',
      workflowNodeUuid: targetNodeUuid,
      targetHandleUuid
    })
    const renamed = updateWorkflowInput(
      bound,
      'count',
      input('attempts')
    )

    expect(inputParameters(renamed).map(({ name }) => name))
      .toEqual(['attempts'])
    expect(nodeInputBindings(renamed, targetNodeUuid)).toEqual({
      [targetHandleUuid]: { parameter: 'attempts' }
    })
    expect(nodeInputBindings(renamed, targetNodeUuid))
      .not.toHaveProperty('count')

    const removed = removeWorkflowInput(renamed, 'attempts')
    expect(inputParameters(removed)).toEqual([])
    expect(nodeInputBindings(removed, targetNodeUuid)).toEqual({})
    expect(renamed).not.toBe(bound)
    expect(nodeInputBindings(bound, targetNodeUuid)).toEqual({
      [targetHandleUuid]: { parameter: 'count' }
    })
  })

  it('rejects a label, data key, source Handle, or foreign Handle as a target', () => {
    const graph = addWorkflowInput(emptyIoGraph(), input('count'))

    for (const notATargetHandle of [
      'count',
      'target_value',
      sourceHandleUuid,
      foreignSourceHandleUuid
    ]) {
      expect(() => bindWorkflowInput(graph, {
        parameter: 'count',
        workflowNodeUuid: targetNodeUuid,
        targetHandleUuid: notATargetHandle
      })).toThrow(/Handle|target|owner|节点/i)
    }
  })

  it.each([
    ['$slot', { $slot: 'ResourceSlot' }],
    ['nullable $slot', {
      anyOf: [{ $slot: 'ResourceSlot' }, { type: 'null' }]
    }],
    ['list $slot', {
      type: 'array',
      items: { $slot: 'ResourceSlot' }
    }]
  ] satisfies Array<[string, WorkflowValueSchema]>)
  ('maintains an exact same-name implicit output for a %s input',
    (_label, schema) => {
      const descriptor: WorkflowInputDescriptor = {
        name: 'sample',
        schema,
        required: !('anyOf' in schema),
        ...('anyOf' in schema ? { default: null } : {})
      }
      const added = addWorkflowInput(emptyIoGraph(), descriptor)

      expect(outputDescriptors(added)).toEqual([{
        name: 'sample',
        schema,
        implicit: true
      }])
      expect(outputBindings(added)).toEqual({
        sample: { kind: 'workflow_input', parameter: 'sample' }
      })

      const renamed = updateWorkflowInput(added, 'sample', {
        ...descriptor,
        name: 'specimen'
      })
      expect(outputDescriptors(renamed)).toEqual([{
        name: 'specimen',
        schema,
        implicit: true
      }])
      expect(outputBindings(renamed)).toEqual({
        specimen: { kind: 'workflow_input', parameter: 'specimen' }
      })
      expect(outputDescriptors(removeWorkflowInput(renamed, 'specimen')))
        .toEqual([])
    })

  it('keeps implicit pass-through outputs server-managed', () => {
    const graph = addWorkflowInput(emptyIoGraph(), {
      name: 'sample',
      schema: { $slot: 'ResourceSlot' },
      required: true
    })

    expect(() => updateWorkflowOutput(graph, 'sample', {
      name: 'renamed',
      schema: { $slot: 'ResourceSlot' },
      implicit: true
    })).toThrow(/系统生成|不可修改/i)
    expect(() => removeWorkflowOutput(graph, 'sample'))
      .toThrow(/系统生成|不可删除/i)
    expect(() => bindWorkflowOutput(graph, 'sample', {
      kind: 'node_output',
      workflow_node_uuid: sourceNodeUuid,
      source_handle_uuid: sourceHandleUuid
    })).toThrow(/系统生成|绑定不可修改/i)
  })

  it('preserves an assignable same-name explicit ResourceSlot output', () => {
    const graph = explicitResourceSlotOutputGraph()
    const withCount = addWorkflowInput(graph, input('count'))
    const renamed = updateWorkflowInput(
      withCount,
      'count',
      input('repeat_count')
    )

    expect(inputParameters(renamed)).toEqual([
      {
        name: 'sample',
        schema: { $slot: 'ResourceSlot' },
        required: true
      },
      input('repeat_count')
    ])
    expect(outputDescriptors(renamed)).toEqual([{
      name: 'sample',
      schema: { $slot: 'ResourceSlot' },
      implicit: false
    }])
    expect(outputBindings(renamed)).toEqual({
      sample: {
        kind: 'node_output',
        workflow_node_uuid: sourceNodeUuid,
        source_handle_uuid: resourceSourceHandleUuid
      }
    })
  })

  it('renames and removes an explicit output without changing its source identity', () => {
    const graph = addWorkflowOutput(emptyIoGraph(), output('report'))
    const bound = bindWorkflowOutput(graph, 'report', {
      kind: 'node_output',
      workflow_node_uuid: sourceNodeUuid,
      source_handle_uuid: sourceHandleUuid
    })
    const renamed = updateWorkflowOutput(
      bound,
      'report',
      output('analysis')
    )

    expect(outputDescriptors(renamed).map(({ name }) => name))
      .toEqual(['analysis'])
    expect(outputBindings(renamed)).toEqual({
      analysis: {
        kind: 'node_output',
        workflow_node_uuid: sourceNodeUuid,
        source_handle_uuid: sourceHandleUuid
      }
    })

    const removed = removeWorkflowOutput(renamed, 'analysis')
    expect(outputDescriptors(removed)).toEqual([])
    expect(outputBindings(removed)).toEqual({})
    expect(outputBindings(bound)).toHaveProperty('report')
  })

  it('binds an explicit output only to a real input or owned source Handle', () => {
    const withInput = addWorkflowInput(emptyIoGraph(), input('count'))
    const graph = addWorkflowOutput(withInput, output('echo'))

    const bound = bindWorkflowOutput(graph, 'echo', {
      kind: 'workflow_input',
      parameter: 'count'
    })
    expect(outputBindings(bound).echo).toEqual({
      kind: 'workflow_input',
      parameter: 'count'
    })
    expect(() => bindWorkflowOutput(graph, 'echo', {
      kind: 'workflow_input',
      parameter: 'missing'
    })).toThrow(/入参|参数/i)
    expect(() => bindWorkflowOutput(graph, 'echo', {
      kind: 'node_output',
      workflow_node_uuid: sourceNodeUuid,
      source_handle_uuid: targetHandleUuid
    })).toThrow(/Handle|source|owner|节点/i)
    expect(() => bindWorkflowOutput(graph, 'echo', {
      kind: 'node_output',
      workflow_node_uuid: sourceNodeUuid,
      source_handle_uuid: foreignSourceHandleUuid
    })).toThrow(/Handle|source|owner|节点/i)
  })

  it('projects binding choices by Handle direction and owning Node', () => {
    const graph = addWorkflowInput(emptyIoGraph(), input('count'))

    expect(projectWorkflowIoBindingOptions(graph)).toEqual({
      inputTargets: [{
        workflowNodeUuid: targetNodeUuid,
        targetHandleUuid
      }],
      outputSources: [
        { kind: 'workflow_input', parameter: 'count' },
        {
          kind: 'node_output',
          workflowNodeUuid: sourceNodeUuid,
          sourceHandleUuid
        },
        {
          kind: 'node_output',
          workflowNodeUuid: sourceNodeUuid,
          sourceHandleUuid: resourceSourceHandleUuid
        },
        {
          kind: 'node_output',
          workflowNodeUuid: otherNodeUuid,
          sourceHandleUuid: foreignSourceHandleUuid
        }
      ]
    })

    const boundInput = bindWorkflowInput(graph, {
      parameter: 'count',
      workflowNodeUuid: targetNodeUuid,
      targetHandleUuid
    })
    expect(nodeInputBindings(boundInput, targetNodeUuid)).toEqual({
      [targetHandleUuid]: { parameter: 'count' }
    })
    expect(JSON.stringify(nodeInputBindings(boundInput, targetNodeUuid)))
      .not.toMatch(/label|data_key|ordinal/)

    const withOutput = bindWorkflowOutput(
      addWorkflowOutput(graph, output('report')),
      'report',
      {
        kind: 'node_output',
        workflow_node_uuid: sourceNodeUuid,
        source_handle_uuid: sourceHandleUuid
      }
    )
    expect(JSON.stringify(outputBindings(withOutput)))
      .not.toMatch(/label|data_key|ordinal/)
  })

  it('ignores visual group nodes without a Workflow Node template UUID', () => {
    const graph = addWorkflowInput(emptyIoGraph(), input('count'))
    graph.nodes.push({
      uuid: '40000000-0000-4000-8000-000000000004',
      type: 'group',
      name: '只用于画布编组'
    })

    expect(projectWorkflowIoBindingOptions(graph)).toEqual({
      inputTargets: [{
        workflowNodeUuid: targetNodeUuid,
        targetHandleUuid
      }],
      outputSources: [
        { kind: 'workflow_input', parameter: 'count' },
        {
          kind: 'node_output',
          workflowNodeUuid: sourceNodeUuid,
          sourceHandleUuid
        },
        {
          kind: 'node_output',
          workflowNodeUuid: sourceNodeUuid,
          sourceHandleUuid: resourceSourceHandleUuid
        },
        {
          kind: 'node_output',
          workflowNodeUuid: otherNodeUuid,
          sourceHandleUuid: foreignSourceHandleUuid
        }
      ]
    })
  })

  it('preserves the complete closed v1 schema while editing a descriptor', () => {
    const schemas: WorkflowValueSchema[] = [
      {
        type: 'number',
        enum: [20, 40],
        minimum: 10,
        maximum: 80
      },
      {
        type: 'array',
        items: {
          type: 'string',
          enum: ['fast', 'safe'],
          minLength: 4,
          maxLength: 8
        },
        minItems: 1,
        maxItems: 3
      },
      { type: 'array', items: { type: 'object' } },
      {
        $slot: 'ResourceSlot',
        allowed_resource_template_uuids: [
          resourceTemplateUuid,
          otherResourceTemplateUuid
        ]
      }
    ]
    let edited = emptyIoGraph()
    for (const [index, schema] of schemas.entries()) {
      edited = addWorkflowInput(edited, {
        name: `field_${index}`,
        schema,
        required: true
      })
    }

    edited = updateWorkflowInput(edited, 'field_1', {
      name: 'labels',
      schema: schemas[1] as WorkflowValueSchema,
      required: true,
      title: 'Labels',
      description: 'Preserve recursive item constraints'
    })

    expect(inputParameters(edited)).toEqual([
      { name: 'field_0', schema: schemas[0], required: true },
      {
        name: 'labels',
        schema: schemas[1],
        required: true,
        title: 'Labels',
        description: 'Preserve recursive item constraints'
      },
      { name: 'field_2', schema: schemas[2], required: true },
      { name: 'field_3', schema: schemas[3], required: true }
    ])

    const withOutput = updateWorkflowOutput(
      addWorkflowOutput(edited, {
        name: 'metrics',
        schema: {
          type: 'array',
          items: { type: 'number', minimum: 0, maximum: 1 },
          minItems: 1,
          maxItems: 8
        },
        implicit: false
      }),
      'metrics',
      {
        name: 'normalized_metrics',
        schema: {
          type: 'array',
          items: { type: 'number', minimum: 0, maximum: 1 },
          minItems: 1,
          maxItems: 8
        },
        title: 'Normalized metrics',
        implicit: false
      }
    )
    expect(outputDescriptors(withOutput)).toEqual([
      {
        name: 'field_3',
        schema: schemas[3],
        implicit: true
      },
      {
        name: 'normalized_metrics',
        schema: {
          type: 'array',
          items: { type: 'number', minimum: 0, maximum: 1 },
          minItems: 1,
          maxItems: 8
        },
        title: 'Normalized metrics',
        implicit: false
      }
    ])
  })

  it.each([
    ['ResourceSlot', { $slot: 'ResourceSlot' }],
    ['list[ResourceSlot]', {
      type: 'array',
      items: { $slot: 'ResourceSlot' }
    }]
  ] satisfies Array<[string, WorkflowValueSchema]>)
  ('requires nullable schema instead of inventing a default for optional %s',
    (_label, schema) => {
      const required = addWorkflowInput(emptyIoGraph(), {
        name: 'sample',
        schema,
        required: true
      })

      expect(() => updateWorkflowInput(required, 'sample', {
        name: 'sample',
        schema,
        required: false
      })).toThrow(/允许为空|资源位|默认值/i)
      expect(inputParameters(required)).toEqual([{
        name: 'sample',
        schema,
        required: true
      }])

      const nullableSchema: WorkflowValueSchema = {
        anyOf: [schema as Exclude<WorkflowValueSchema, { anyOf: unknown }>, {
          type: 'null'
        }]
      }
      const optional = updateWorkflowInput(required, 'sample', {
        name: 'sample',
        schema: nullableSchema,
        required: false,
        default: null
      })
      expect(inputParameters(optional)).toEqual([{
        name: 'sample',
        schema: nullableSchema,
        required: false,
        default: null
      }])
    })

  it('reorders ordered descriptors without changing binding identity', async () => {
    const authoring = await import('./workflowIoAuthoring') as unknown as {
      moveWorkflowInput?: (
        graph: WorkflowAuthoringGraph,
        name: string,
        direction: 'up' | 'down'
      ) => WorkflowAuthoringGraph
      moveWorkflowOutput?: (
        graph: WorkflowAuthoringGraph,
        name: string,
        direction: 'up' | 'down'
      ) => WorkflowAuthoringGraph
    }
    expect(authoring.moveWorkflowInput).toBeTypeOf('function')
    expect(authoring.moveWorkflowOutput).toBeTypeOf('function')
    if (!authoring.moveWorkflowInput || !authoring.moveWorkflowOutput) return

    let graph = bindWorkflowInput(
      addWorkflowInput(
        addWorkflowInput(emptyIoGraph(), input('first')),
        input('second')
      ),
      {
        parameter: 'second',
        workflowNodeUuid: targetNodeUuid,
        targetHandleUuid
      }
    )
    graph = bindWorkflowOutput(
      addWorkflowOutput(
        addWorkflowOutput(graph, output('alpha')),
        output('beta')
      ),
      'beta',
      {
        kind: 'node_output',
        workflow_node_uuid: sourceNodeUuid,
        source_handle_uuid: sourceHandleUuid
      }
    )

    const inputsMoved = authoring.moveWorkflowInput(graph, 'second', 'up')
    const outputsMoved = authoring.moveWorkflowOutput(inputsMoved, 'beta', 'up')

    expect(inputParameters(outputsMoved).map(({ name }) => name))
      .toEqual(['second', 'first'])
    expect(outputDescriptors(outputsMoved).map(({ name }) => name))
      .toEqual(['beta', 'alpha'])
    expect(nodeInputBindings(outputsMoved, targetNodeUuid)).toEqual({
      [targetHandleUuid]: { parameter: 'second' }
    })
    expect(outputBindings(outputsMoved).beta).toEqual({
      kind: 'node_output',
      workflow_node_uuid: sourceNodeUuid,
      source_handle_uuid: sourceHandleUuid
    })
  })

  it('directly unbinds one input target without deleting its descriptor', () => {
    const withSecondTarget = structuredClone(emptyIoGraph())
    withSecondTarget.handle_templates.push({
      uuid: '30000000-0000-4000-8000-000000000005',
      workflow_node_template_uuid: targetTemplateUuid,
      handle_key: 'other_target',
      io_type: 'target'
    })
    let bound = addWorkflowInput(withSecondTarget, input('count'))
    bound = bindWorkflowInput(bound, {
      parameter: 'count',
      workflowNodeUuid: targetNodeUuid,
      targetHandleUuid
    })
    bound = bindWorkflowInput(bound, {
      parameter: 'count',
      workflowNodeUuid: targetNodeUuid,
      targetHandleUuid: '30000000-0000-4000-8000-000000000005'
    })

    const unbound = unbindWorkflowInput(
      bound,
      targetNodeUuid,
      targetHandleUuid
    )

    expect(inputParameters(unbound)).toEqual([input('count')])
    expect(nodeInputBindings(unbound, targetNodeUuid)).toEqual({
      '30000000-0000-4000-8000-000000000005': { parameter: 'count' }
    })
  })
})

function emptyIoGraph(): WorkflowAuthoringGraph {
  return {
    workflow: {
      uuid: workflowUuid,
      revision: 7,
      meta_data: {
        unilab: {
          input_contract: { version: 1, parameters: [] },
          output_contract: { version: 1, outputs: [] },
          output_bindings: {}
        }
      }
    },
    nodes: [
      node(targetNodeUuid, targetTemplateUuid, 'target'),
      node(sourceNodeUuid, sourceTemplateUuid, 'source'),
      node(otherNodeUuid, otherTemplateUuid, 'other_source')
    ],
    edges: [],
    node_templates: [
      { uuid: targetTemplateUuid, name: 'target' },
      { uuid: sourceTemplateUuid, name: 'source' },
      { uuid: otherTemplateUuid, name: 'other_source' }
    ],
    handle_templates: [
      {
        uuid: targetHandleUuid,
        workflow_node_template_uuid: targetTemplateUuid,
        handle_key: 'target_value',
        data_key: 'target_value',
        display_name: '目标值',
        io_type: 'target',
        value_schema: { type: 'integer' }
      },
      {
        uuid: sourceHandleUuid,
        workflow_node_template_uuid: sourceTemplateUuid,
        handle_key: 'result',
        data_key: 'result',
        display_name: '结果',
        io_type: 'source',
        value_schema: { type: 'object' }
      },
      {
        uuid: resourceSourceHandleUuid,
        workflow_node_template_uuid: sourceTemplateUuid,
        handle_key: 'sample',
        data_key: 'sample',
        display_name: '样品',
        io_type: 'source',
        value_schema: { $slot: 'ResourceSlot' }
      },
      {
        uuid: foreignSourceHandleUuid,
        workflow_node_template_uuid: otherTemplateUuid,
        handle_key: 'foreign_result',
        data_key: 'foreign_result',
        display_name: '另一结果',
        io_type: 'source',
        value_schema: { type: 'object' }
      }
    ]
  }
}

function explicitResourceSlotOutputGraph(): WorkflowAuthoringGraph {
  const graph = emptyIoGraph()
  return {
    ...graph,
    workflow: {
      ...graph.workflow,
      meta_data: {
        ...graph.workflow.meta_data,
        unilab: {
          input_contract: {
            version: 1,
            parameters: [{
              name: 'sample',
              schema: { $slot: 'ResourceSlot' },
              required: true
            }]
          },
          output_contract: {
            version: 1,
            outputs: [{
              name: 'sample',
              schema: { $slot: 'ResourceSlot' },
              implicit: false
            }]
          },
          output_bindings: {
            sample: {
              kind: 'node_output',
              workflow_node_uuid: sourceNodeUuid,
              source_handle_uuid: resourceSourceHandleUuid
            }
          }
        }
      }
    }
  }
}

function node(
  uuid: string,
  workflowNodeTemplateUuid: string,
  name: string
): Record<string, unknown> {
  return {
    uuid,
    workflow_node_template_uuid: workflowNodeTemplateUuid,
    name,
    param: {},
    meta_data: { unilab: { input_bindings: {} } }
  }
}

function input(name: string): WorkflowInputDescriptor {
  return { name, schema: { type: 'integer' }, required: true }
}

function output(name: string): WorkflowOutputDescriptor {
  return { name, schema: { type: 'object' }, implicit: false }
}

function unilab(graph: WorkflowAuthoringGraph): Record<string, unknown> {
  return graph.workflow.meta_data?.unilab ?? {}
}

function inputParameters(
  graph: WorkflowAuthoringGraph
): WorkflowInputDescriptor[] {
  return (unilab(graph).input_contract as {
    parameters: WorkflowInputDescriptor[]
  }).parameters
}

function outputDescriptors(
  graph: WorkflowAuthoringGraph
): WorkflowOutputDescriptor[] {
  return (unilab(graph).output_contract as {
    outputs: WorkflowOutputDescriptor[]
  }).outputs
}

function outputBindings(
  graph: WorkflowAuthoringGraph
): Record<string, Record<string, unknown>> {
  return unilab(graph).output_bindings as Record<
    string,
    Record<string, unknown>
  >
}

function nodeInputBindings(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string
): Record<string, unknown> {
  const node = graph.nodes.find(({ uuid }) => uuid === nodeUuid)
  return ((node?.meta_data as {
    unilab: { input_bindings: Record<string, unknown> }
  }).unilab.input_bindings)
}
