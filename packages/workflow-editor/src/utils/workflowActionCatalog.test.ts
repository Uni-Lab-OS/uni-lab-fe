import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type {
  WorkflowActionCatalogSnapshot,
  WorkflowAuthoringGraph
} from '@unilab/services'

import {
  bindTypedActionWorkflowInput,
  connectTypedActionEdge,
  createTypedActionNode,
  projectTypedActionEditor,
  rehydrateTypedActionGraph,
  updateTypedActionLiteral
} from './workflowActionCatalog'
import { catalogConflictDecision } from './persistentAuthoringSession'

interface PublishedBoundaryModule {
  createPublishedWorkflowNode(
    catalog: WorkflowActionCatalogSnapshot,
    graph: WorkflowAuthoringGraph,
    input: { nodeUuid: string; templateUuid: string; name: string }
  ): WorkflowAuthoringGraph
}

const boundaryModule = await import('./workflowActionCatalog') as unknown as
  Partial<PublishedBoundaryModule>

const templateUuid = '20000000-0000-4000-8000-000000000001'
const sourceTemplateUuid = '20000000-0000-4000-8000-000000000002'
const nodeUuid = '40000000-0000-4000-8000-000000000001'
const sourceNodeUuid = '40000000-0000-4000-8000-000000000002'
const secondNodeUuid = '40000000-0000-4000-8000-000000000003'
const workflowUuid = '60000000-0000-4000-8000-000000000001'
const requiredHandleUuid = '30000000-0000-4000-8000-000000000001'
const defaultHandleUuid = '30000000-0000-4000-8000-000000000002'
const nullableHandleUuid = '30000000-0000-4000-8000-000000000003'
const enumHandleUuid = '30000000-0000-4000-8000-000000000004'
const objectHandleUuid = '30000000-0000-4000-8000-000000000005'
const listHandleUuid = '30000000-0000-4000-8000-000000000006'
const materialHandleUuid = '30000000-0000-4000-8000-000000000007'
const siteHandleUuid = '30000000-0000-4000-8000-000000000008'
const upstreamHandleUuid = '30000000-0000-4000-8000-000000000009'
const readyTargetHandleUuid = '30000000-0000-4000-8000-000000000010'
const readySourceHandleUuid = '30000000-0000-4000-8000-000000000011'
const publishedWorkflowTemplateUuid =
  '20000000-0000-4000-8000-000000000010'
const publishedWorkflowUuid = '60000000-0000-4000-8000-000000000010'
const publishedInvocationUuid = '40000000-0000-4000-8000-000000000010'
const publishedInputHandleUuid = '30000000-0000-4000-8000-000000000020'
const publishedOutputHandleUuid = '30000000-0000-4000-8000-000000000021'
const publishedReadyTargetUuid = '30000000-0000-4000-8000-000000000022'
const publishedReadySourceUuid = '30000000-0000-4000-8000-000000000023'
const internalTargetNodeUuid = '40000000-0000-4000-8000-000000000020'
const internalSourceNodeUuid = '40000000-0000-4000-8000-000000000021'
const fingerprint = `sha256:${'a'.repeat(64)}`

describe('typed Action editor projection', () => {
  it('projects persisted version two Action contracts in node properties', () => {
    const versionTwoCatalog = structuredClone(catalog)
    const extension = versionTwoCatalog.actionTemplates[0]?.schema[
      'x-unilabos-action-contract'
    ] as Record<string, unknown>
    extension.version = 2

    const projected = projectTypedActionEditor(
      versionTwoCatalog,
      graph,
      nodeUuid,
      []
    )

    expect(projected.templateUuid).toBe(templateUuid)
    expect(projected.fields.map((field) => field.dataKey)).toEqual([
      'count',
      'temperature',
      'note',
      'mode',
      'options',
      'samples',
      'material',
      'site'
    ])
  })

  it('narrows a generic material input through the node passthrough override', () => {
    const dynamicCatalog = structuredClone(catalog)
    const dynamicTemplate = dynamicCatalog.actionTemplates[0]!
    const materialInput = dynamicTemplate.handles.find(
      (handle) => handle.uuid === materialHandleUuid
    )!
    materialInput.allowedResourceTemplateUuids = null
    const materialOutputUuid = '30000000-0000-4000-8000-000000000012'
    dynamicTemplate.handles.push({
      ...materialInput,
      uuid: materialOutputUuid,
      ioType: 'source',
      dataSource: 'result'
    })
    const dynamicGraph = structuredClone(graph)
    const dynamicNode = dynamicGraph.nodes.find(
      (node) => node.uuid === nodeUuid
    )!
    dynamicNode.meta_data = {
      unilab: {
        material_passthrough_handles: {
          [materialOutputUuid]: materialHandleUuid
        },
        output_schema_overrides: {
          [materialOutputUuid]: {
            $slot: 'ResourceSlot',
            allowed_resource_template_uuids: [sourceTemplateUuid]
          }
        }
      }
    }

    const projected = projectTypedActionEditor(
      dynamicCatalog,
      dynamicGraph,
      nodeUuid,
      []
    )

    expect(projected.fields.find(
      (field) => field.handleUuid === materialHandleUuid
    )?.allowedResourceTemplateUuids).toEqual([sourceTemplateUuid])
  })

  it('inserts one Published child invocation with only parent-owned state', () => {
    expect(boundaryModule.createPublishedWorkflowNode).toBeTypeOf('function')
    const catalogWithChild = publishedBoundaryCatalog()
    const initial: WorkflowAuthoringGraph = {
      ...graph,
      nodes: [],
      edges: [],
      node_templates: [],
      handle_templates: []
    }
    const before = structuredClone(initial)

    const created = boundaryModule.createPublishedWorkflowNode!(
      catalogWithChild,
      initial,
      {
        nodeUuid: publishedInvocationUuid,
        templateUuid: publishedWorkflowTemplateUuid,
        name: 'prepare_child'
      }
    )

    expect(initial).toEqual(before)
    expect(created.nodes).toEqual([{
      uuid: publishedInvocationUuid,
      workflow_node_template_uuid: publishedWorkflowTemplateUuid,
      name: 'prepare_child',
      status: 'idle',
      type: 'workflow',
      pose: {},
      param: {},
      execution_policy: {},
      disabled: false,
      minimized: false,
      meta_data: { unilab: { input_bindings: {} } }
    }])
    expect(created.nodes[0]?.meta_data).not.toHaveProperty(
      'unilab.composite'
    )
    expect(created.node_templates).toEqual([
      expect.objectContaining({
        uuid: publishedWorkflowTemplateUuid,
        name: `workflow:${publishedWorkflowUuid}`,
        type: 'workflow',
        node_type: 'workflow'
      })
    ])
    expect(created.handle_templates.map((item) => item.uuid)).toEqual([
      publishedInputHandleUuid,
      publishedOutputHandleUuid,
      publishedReadyTargetUuid,
      publishedReadySourceUuid
    ])
    expect(created.handle_templates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        uuid: publishedInputHandleUuid,
        workflow_node_template_uuid: publishedWorkflowTemplateUuid,
        io_type: 'target',
        data_source: 'goal'
      }),
      expect.objectContaining({
        uuid: publishedOutputHandleUuid,
        workflow_node_template_uuid: publishedWorkflowTemplateUuid,
        io_type: 'source',
        data_source: 'result'
      }),
      expect.objectContaining({
        uuid: publishedReadyTargetUuid,
        io_type: 'target',
        data_source: 'dependency'
      }),
      expect.objectContaining({
        uuid: publishedReadySourceUuid,
        io_type: 'source',
        data_source: 'dependency'
      })
    ]))
    expect(created.edges).toEqual([])
  })

  it('reuses the typed ResourceSlot editor and preserves OS diagnostics', () => {
    const catalogWithChild = publishedBoundaryCatalog()
    const boundary = publishedBoundaryGraph()
    const diagnostic = {
      severity: 'error' as const,
      code: 'composite_resource_constraint_empty',
      message: 'ResourceSlot allowlist intersection is empty',
      node_id: publishedInvocationUuid,
      path: '/nodes/prepare_child/param/sample',
      workflow_handle_template_uuid: publishedInputHandleUuid
    }

    const projected = projectTypedActionEditor(
      catalogWithChild,
      boundary,
      publishedInvocationUuid,
      [diagnostic]
    )

    expect(projected.templateUuid).toBe(publishedWorkflowTemplateUuid)
    expect(projected.fields).toEqual([expect.objectContaining({
      handleUuid: publishedInputHandleUuid,
      dataKey: 'sample',
      displayName: 'sample',
      required: true,
      editorControl: 'material_port',
      valueSchema: resourceSlotValueSchema(),
      providerKind: 'missing'
    })])
    expect(projected.diagnostics).toContainEqual({
      handleUuid: publishedInputHandleUuid,
      fieldPath: diagnostic.path,
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message
    })
  })

  it('switches Published boundary providers without creating private mappings', () => {
    const catalogWithChild = publishedBoundaryCatalog()
    const boundary = publishedBoundaryGraph()
    const literal = updateTypedActionLiteral(
      catalogWithChild,
      boundary,
      publishedInvocationUuid,
      publishedInputHandleUuid,
      { uuid: '70000000-0000-4000-8000-000000000001' }
    )
    expect(literal.nodes.find((node) =>
      node.uuid === publishedInvocationUuid
    )?.param).toEqual({
      sample: { uuid: '70000000-0000-4000-8000-000000000001' }
    })

    const bound = bindTypedActionWorkflowInput(
      catalogWithChild,
      literal,
      publishedInvocationUuid,
      publishedInputHandleUuid,
      'sample_input'
    )
    const boundInvocation = bound.nodes.find((node) =>
      node.uuid === publishedInvocationUuid
    )!
    expect(boundInvocation.param).toEqual({})
    expect(boundInvocation.meta_data).toEqual({
      unilab: {
        input_bindings: {
          [publishedInputHandleUuid]: { parameter: 'sample_input' }
        }
      }
    })
    expect(boundInvocation.meta_data).not.toHaveProperty('unilab.composite')

    const connected = connectTypedActionEdge(catalogWithChild, bound, {
      sourceNodeUuid,
      sourceHandleUuid: upstreamHandleUuid,
      targetNodeUuid: publishedInvocationUuid,
      targetHandleUuid: publishedInputHandleUuid
    })
    expect(connected.edges).toEqual([expect.objectContaining({
      source_node_uuid: sourceNodeUuid,
      source_handle_uuid: upstreamHandleUuid,
      target_node_uuid: publishedInvocationUuid,
      target_handle_uuid: publishedInputHandleUuid
    })])
    const connectedInvocation = connected.nodes.find((node) =>
      node.uuid === publishedInvocationUuid
    )!
    expect(connectedInvocation.param).toEqual({})
    expect(connectedInvocation.meta_data).toEqual({
      unilab: { input_bindings: {} }
    })

    const outputConnected = connectTypedActionEdge(
      catalogWithChild,
      publishedBoundaryGraph(),
      {
        sourceNodeUuid: publishedInvocationUuid,
        sourceHandleUuid: publishedOutputHandleUuid,
        targetNodeUuid: nodeUuid,
        targetHandleUuid: materialHandleUuid
      }
    )
    expect(outputConnected.edges).toEqual([expect.objectContaining({
      source_node_uuid: publishedInvocationUuid,
      source_handle_uuid: publishedOutputHandleUuid,
      target_node_uuid: nodeUuid,
      target_handle_uuid: materialHandleUuid
    })])
  })

  it('denies parent writes and external Edges through expanded private Handles', () => {
    const catalogWithChild = publishedBoundaryCatalog()
    const boundary = publishedBoundaryGraph(true)

    expect(() => updateTypedActionLiteral(
      catalogWithChild,
      boundary,
      internalTargetNodeUuid,
      materialHandleUuid,
      { uuid: '70000000-0000-4000-8000-000000000001' }
    )).toThrow(/internal|private|boundary|只读/i)
    expect(() => bindTypedActionWorkflowInput(
      catalogWithChild,
      boundary,
      internalTargetNodeUuid,
      materialHandleUuid,
      'sample_input'
    )).toThrow(/internal|private|boundary|只读/i)
    expect(() => connectTypedActionEdge(catalogWithChild, boundary, {
      sourceNodeUuid,
      sourceHandleUuid: upstreamHandleUuid,
      targetNodeUuid: internalTargetNodeUuid,
      targetHandleUuid: materialHandleUuid
    })).toThrow(/internal|private|boundary|只读/i)
    expect(() => connectTypedActionEdge(catalogWithChild, boundary, {
      sourceNodeUuid: internalSourceNodeUuid,
      sourceHandleUuid: upstreamHandleUuid,
      targetNodeUuid: publishedInvocationUuid,
      targetHandleUuid: publishedInputHandleUuid
    })).toThrow(/internal|private|boundary|只读/i)
  })

  it('adds one Action without rewriting a mixed Published/control graph', () => {
    const mixedCatalog = {
      ...catalog,
      actionTemplates: [actionTemplate()],
      workflowTemplates: [publishedWorkflowTemplate()]
    } satisfies WorkflowActionCatalogSnapshot
    const mixedGraph = mixedAuthoringGraph()
    const before = structuredClone(mixedGraph)

    const created = createTypedActionNode(mixedCatalog, mixedGraph, {
      nodeUuid: secondNodeUuid,
      templateUuid,
      name: 'transfer_2'
    })

    expect(mixedGraph).toEqual(before)
    expect(created.workflow).toEqual(before.workflow)
    expect(created.edges).toEqual(before.edges)
    expect(created.nodes.slice(0, before.nodes.length)).toEqual(before.nodes)
    expect(created.node_templates.slice(0, before.node_templates.length))
      .toEqual(before.node_templates)
    expect(created.handle_templates.slice(0, before.handle_templates.length))
      .toEqual(before.handle_templates)

    expect(created.nodes.at(-1)).toMatchObject({
      uuid: secondNodeUuid,
      workflow_node_template_uuid: templateUuid,
      name: 'transfer_2',
      action_name: 'transfer',
      type: 'device'
    })
    expect(created.node_templates.slice(before.node_templates.length))
      .toEqual([expect.objectContaining({
        uuid: templateUuid,
        name: 'transfer',
        type: 'UniLabJsonCommand'
      })])
    const addedHandles = created.handle_templates.slice(
      before.handle_templates.length
    )
    expect(addedHandles.map((handle) => handle.uuid)).toEqual(
      actionTemplate().handles.map((handle) => handle.uuid)
    )
    expect(addedHandles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        uuid: readyTargetHandleUuid,
        io_type: 'target',
        type: 'boolean',
        data_source: 'dependency',
        meta_data: {
          unilab: expect.objectContaining({
            structural_role: 'ready',
            implicit_passthrough: false
          })
        }
      }),
      expect.objectContaining({
        uuid: readySourceHandleUuid,
        io_type: 'source',
        type: 'boolean',
        data_source: 'dependency',
        meta_data: {
          unilab: expect.objectContaining({
            structural_role: 'ready',
            implicit_passthrough: false
          })
        }
      })
    ]))
    const nodeTemplateUuids = created.node_templates.map((item) => item.uuid)
    const handleTemplateUuids = created.handle_templates.map((item) => item.uuid)
    expect(new Set(nodeTemplateUuids).size).toBe(nodeTemplateUuids.length)
    expect(new Set(handleTemplateUuids).size).toBe(handleTemplateUuids.length)
  })

  it('keeps Action creation on the Action side of an executable union', () => {
    const executableCatalog = {
      authorityId: catalog.authorityId,
      authorityKind: catalog.authorityKind,
      fingerprint: catalog.fingerprint,
      actionTemplates: catalog.actionTemplates,
      workflowTemplates: [{
        uuid: '20000000-0000-4000-8000-000000000099',
        displayName: 'Published child must not become an Action'
      }]
    } as unknown as WorkflowActionCatalogSnapshot
    const emptyGraph: WorkflowAuthoringGraph = {
      ...graph,
      nodes: [],
      edges: []
    }

    const created = createTypedActionNode(executableCatalog, emptyGraph, {
      nodeUuid: secondNodeUuid,
      templateUuid,
      name: 'transfer_2'
    })

    expect(created.nodes).toHaveLength(1)
    expect(created.nodes[0]).toMatchObject({
      uuid: secondNodeUuid,
      workflow_node_template_uuid: templateUuid,
      name: 'transfer_2',
      action_name: 'transfer',
      type: 'device'
    })
  })

  it('creates a Backend-shaped Node without materializing schema defaults', () => {
    const emptyGraph: WorkflowAuthoringGraph = {
      ...graph,
      nodes: [],
      edges: []
    }
    const created = createTypedActionNode(catalog, emptyGraph, {
      nodeUuid: '40000000-0000-4000-8000-000000000003',
      templateUuid,
      name: 'transfer_2'
    })

    expect(created.nodes).toEqual([{
      uuid: '40000000-0000-4000-8000-000000000003',
      workflow_node_template_uuid: templateUuid,
      name: 'transfer_2',
      status: 'idle',
      type: 'device',
      pose: {},
      param: {},
      action_name: 'transfer',
      execution_policy: {},
      disabled: false,
      minimized: false,
      meta_data: {
        unilab: {
          input_bindings: {}
        }
      }
    }])
    expect(created.nodes[0]?.param).not.toHaveProperty('options')
    expect(created.handle_templates.map((item) => item.uuid)).toEqual(
      expect.arrayContaining(actionTemplate().handles.map((handle) => handle.uuid))
    )
    expect(created.handle_templates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        uuid: readyTargetHandleUuid,
        handle_key: 'ready',
        io_type: 'target'
      }),
      expect.objectContaining({
        uuid: readySourceHandleUuid,
        handle_key: 'ready',
        io_type: 'source'
      })
    ]))
    expect(created.node_templates.map((item) => item.uuid)).toContain(templateUuid)
    expect(() => createTypedActionNode(catalog, emptyGraph, {
      nodeUuid: '40000000-0000-4000-8000-000000000004',
      templateUuid: '20000000-0000-4000-8000-000000000099',
      name: 'unknown'
    })).toThrow(/模板/i)

    const catalogWithAuto: WorkflowActionCatalogSnapshot = {
      ...catalog,
      actionTemplates: [
        ...catalog.actionTemplates,
        {
          ...actionTemplate(),
          uuid: '20000000-0000-4000-8000-000000000003',
          name: 'auto-health',
          schema: {}
        }
      ]
    }
    expect(() => createTypedActionNode(catalogWithAuto, emptyGraph, {
      nodeUuid: '40000000-0000-4000-8000-000000000005',
      templateUuid: '20000000-0000-4000-8000-000000000003',
      name: 'health'
    })).toThrow(/类型化|操作|模板/i)
  })

  it('persists an exact canvas position when a template is dropped', () => {
    const emptyGraph: WorkflowAuthoringGraph = {
      ...graph,
      nodes: [],
      edges: []
    }
    const created = createTypedActionNode(catalog, emptyGraph, {
      nodeUuid: secondNodeUuid,
      templateUuid,
      name: 'positioned_action',
      position: { x: 420, y: 168 }
    })

    expect(created.nodes[0]?.pose).toEqual({
      position: { x: 420, y: 168 }
    })
  })

  it('switches atomically between workflow input, literal and edge providers', () => {
    const withLiteral = updateTypedActionLiteral(
      catalog,
      graph,
      nodeUuid,
      requiredHandleUuid,
      3
    )
    const withWorkflowInput = bindTypedActionWorkflowInput(
      catalog,
      withLiteral,
      nodeUuid,
      requiredHandleUuid,
      'count_input'
    )
    expect(withWorkflowInput.nodes[0]?.param).not.toHaveProperty('count')
    expect(withWorkflowInput.edges).toEqual([])
    expect(
      (withWorkflowInput.nodes[0]?.meta_data as {
        unilab: { input_bindings: Record<string, unknown> }
      }).unilab.input_bindings
    ).toEqual({
      [requiredHandleUuid]: { parameter: 'count_input' }
    })
    expect(projectTypedActionEditor(
      catalog,
      withWorkflowInput,
      nodeUuid,
      []
    ).fields.find((field) => field.handleUuid === requiredHandleUuid))
      .toEqual(expect.objectContaining({
        providerKind: 'workflow_input',
        workflowInput: 'count_input',
        workflowInputOptions: ['count_input', 'sample_input']
      }))

    const cleared = updateTypedActionLiteral(
      catalog,
      withWorkflowInput,
      nodeUuid,
      requiredHandleUuid,
      undefined
    )
    expect(
      (cleared.nodes[0]?.meta_data as {
        unilab: { input_bindings: Record<string, unknown> }
      }).unilab.input_bindings
    ).toEqual({})
    expect(projectTypedActionEditor(
      catalog,
      cleared,
      nodeUuid,
      []
    ).fields.find((field) => field.handleUuid === requiredHandleUuid))
      .toEqual(expect.objectContaining({
        providerKind: 'missing',
        workflowInput: null
      }))

    expect(() => bindTypedActionWorkflowInput(
      catalog,
      graph,
      nodeUuid,
      requiredHandleUuid,
      'missing_input'
    )).toThrow(/工作流入参/)
  })

  it('rejects workflow input bindings that are not schema-assignable', () => {
    const incompatibleGraph = structuredClone(graph)
    const inputContract = (
      incompatibleGraph.workflow.meta_data as {
        unilab: {
          input_contract: {
            parameters: Array<{ name: string; schema: Record<string, unknown> }>
          }
        }
      }
    ).unilab.input_contract
    inputContract.parameters[0]!.schema = { type: 'number' }

    expect(() => bindTypedActionWorkflowInput(
      catalog,
      incompatibleGraph,
      nodeUuid,
      requiredHandleUuid,
      'count_input'
    )).toThrow(/Schema|类型|兼容|可赋值/i)
  })

  it('checks complete schemas instead of only valueType when connecting', () => {
    const boundedCatalog = structuredClone(catalog)
    const sourceHandle = boundedCatalog.actionTemplates[1]!.handles[0]!
    const targetHandle = boundedCatalog.actionTemplates[0]!.handles.find(
      handle => handle.uuid === requiredHandleUuid
    )!
    sourceHandle.valueType = 'integer'
    sourceHandle.valueSchema = { type: 'integer' }
    targetHandle.valueType = 'integer'
    targetHandle.valueSchema = { type: 'integer', minimum: 1 }

    expect(() => connectTypedActionEdge(boundedCatalog, graph, {
      sourceNodeUuid,
      sourceHandleUuid: upstreamHandleUuid,
      targetNodeUuid: nodeUuid,
      targetHandleUuid: requiredHandleUuid
    })).toThrow(/Schema|类型|兼容|可赋值/i)

    sourceHandle.valueSchema = { type: 'integer', minimum: 2 }
    expect(connectTypedActionEdge(boundedCatalog, graph, {
      sourceNodeUuid,
      sourceHandleUuid: upstreamHandleUuid,
      targetNodeUuid: nodeUuid,
      targetHandleUuid: requiredHandleUuid
    }).edges).toHaveLength(1)
  })

  it('preserves required/default/null/enum/object/list/ResourceSlot semantics', () => {
    const projected = projectTypedActionEditor(
      catalog,
      graph,
      nodeUuid,
      []
    )

    expect(projected.templateUuid).toBe(templateUuid)
    expect(projected.fields.map((field) => ({
      handleUuid: field.handleUuid,
      dataKey: field.dataKey,
      required: field.required,
      hasDefault: field.hasDefault,
      defaultValue: field.defaultValue,
      nullable: field.nullable,
      editorControl: field.editorControl,
      valueState: field.valueState,
      enumValues: field.enumValues
    }))).toEqual([
      {
        handleUuid: requiredHandleUuid,
        dataKey: 'count',
        required: true,
        hasDefault: false,
        defaultValue: undefined,
        nullable: false,
        editorControl: 'variable_selector',
        valueState: 'missing',
        enumValues: null
      },
      {
        handleUuid: defaultHandleUuid,
        dataKey: 'temperature',
        required: false,
        hasDefault: true,
        defaultValue: 25,
        nullable: false,
        editorControl: 'variable_selector',
        valueState: 'missing',
        enumValues: null
      },
      {
        handleUuid: nullableHandleUuid,
        dataKey: 'note',
        required: false,
        hasDefault: true,
        defaultValue: null,
        nullable: true,
        editorControl: 'variable_selector',
        valueState: 'null',
        enumValues: null
      },
      {
        handleUuid: enumHandleUuid,
        dataKey: 'mode',
        required: false,
        hasDefault: true,
        defaultValue: 'safe',
        nullable: false,
        editorControl: 'variable_selector',
        valueState: 'missing',
        enumValues: ['safe', 'fast']
      },
      {
        handleUuid: objectHandleUuid,
        dataKey: 'options',
        required: false,
        hasDefault: false,
        defaultValue: undefined,
        nullable: false,
        editorControl: 'variable_selector',
        valueState: 'value',
        enumValues: null
      },
      {
        handleUuid: listHandleUuid,
        dataKey: 'samples',
        required: false,
        hasDefault: false,
        defaultValue: undefined,
        nullable: false,
        editorControl: 'variable_selector',
        valueState: 'value',
        enumValues: null
      },
      {
        handleUuid: materialHandleUuid,
        dataKey: 'material',
        required: true,
        hasDefault: false,
        defaultValue: undefined,
        nullable: false,
        editorControl: 'material_port',
        valueState: 'missing',
        enumValues: null
      },
      {
        handleUuid: siteHandleUuid,
        dataKey: 'site',
        required: false,
        hasDefault: false,
        defaultValue: undefined,
        nullable: false,
        editorControl: 'site_selector',
        valueState: 'missing',
        enumValues: null
      }
    ])
    expect(projected.diagnostics).toEqual([
      expect.objectContaining({
        handleUuid: requiredHandleUuid,
        fieldPath: '/param/count',
        severity: 'error'
      }),
      expect.objectContaining({
        handleUuid: materialHandleUuid,
        fieldPath: '/param/material',
        severity: 'error'
      })
    ])
    expect(graph.nodes[0]?.param).toEqual({
      note: null,
      options: {},
      samples: []
    })
    expect(graph.nodes[0]?.param).not.toHaveProperty('temperature')
    expect(graph.nodes[0]?.param).not.toHaveProperty('mode')
  })

  it('does not collapse missing, null, empty object, or empty list on update', () => {
    const withValue = updateTypedActionLiteral(
      catalog,
      graph,
      nodeUuid,
      requiredHandleUuid,
      0
    )
    const withNull = updateTypedActionLiteral(
      catalog,
      withValue,
      nodeUuid,
      nullableHandleUuid,
      null
    )
    const withEmptyObject = updateTypedActionLiteral(
      catalog,
      withNull,
      nodeUuid,
      objectHandleUuid,
      {}
    )
    const withEmptyList = updateTypedActionLiteral(
      catalog,
      withEmptyObject,
      nodeUuid,
      listHandleUuid,
      []
    )
    const cleared = updateTypedActionLiteral(
      catalog,
      withEmptyList,
      nodeUuid,
      nullableHandleUuid,
      undefined
    )

    expect(cleared.nodes[0]?.param).toEqual({
      count: 0,
      options: {},
      samples: []
    })
    expect(withEmptyList.nodes[0]?.param).not.toHaveProperty('temperature')
    expect(() => updateTypedActionLiteral(
      catalog,
      graph,
      nodeUuid,
      materialHandleUuid,
      'material-1'
    )).toThrow(/操作参数规范/)
  })

  it('creates and rehydrates edges only by real Handle UUID', () => {
    const occupiedGraph: WorkflowAuthoringGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.uuid !== nodeUuid
        ? node
        : {
            ...node,
            param: {
              ...(node.param as Record<string, unknown> || {}),
              material: { uuid: 'material-1' }
            },
            meta_data: {
              unilab: {
                input_bindings: {
                  [materialHandleUuid]: { parameter: 'sample' }
                }
              }
            }
          })
    }
    const connected = connectTypedActionEdge(catalog, occupiedGraph, {
      sourceNodeUuid,
      sourceHandleUuid: upstreamHandleUuid,
      targetNodeUuid: nodeUuid,
      targetHandleUuid: materialHandleUuid
    })
    const roundTripped = rehydrateTypedActionGraph(
      catalog,
      JSON.parse(JSON.stringify(connected)) as WorkflowAuthoringGraph
    )

    expect(roundTripped.edges).toEqual([
      expect.objectContaining({
        uuid: '4fa4270e-168f-5bd4-a2e5-1f6da91cf55d',
        source_node_uuid: sourceNodeUuid,
        source_handle_uuid: upstreamHandleUuid,
        target_node_uuid: nodeUuid,
        target_handle_uuid: materialHandleUuid
      })
    ])
    expect(roundTripped.nodes[0]?.workflow_node_template_uuid)
      .toBe(templateUuid)
    expect(roundTripped.node_templates.map((item) => item.uuid)).toEqual([
      templateUuid,
      sourceTemplateUuid
    ])
    expect(roundTripped.handle_templates.map((item) => item.uuid))
      .toContain(materialHandleUuid)
    expect(roundTripped.nodes[0]?.param).not.toHaveProperty('material')
    expect(
      (roundTripped.nodes[0]?.meta_data as Record<string, unknown>)?.unilab
    ).toEqual(expect.objectContaining({ input_bindings: {} }))
    expect(occupiedGraph.nodes[0]?.param).toEqual(expect.objectContaining({
      material: { uuid: 'material-1' }
    }))
    expect(
      (occupiedGraph.nodes[0]?.meta_data as {
        unilab: { input_bindings: Record<string, unknown> }
      }).unilab.input_bindings
    ).toHaveProperty(materialHandleUuid)
    const withLiteralProvider = updateTypedActionLiteral(
      catalog,
      connected,
      nodeUuid,
      materialHandleUuid,
      { uuid: 'material-2' }
    )
    expect(withLiteralProvider.edges).toEqual([])
    expect(withLiteralProvider.nodes[0]?.param).toEqual(expect.objectContaining({
      material: { uuid: 'material-2' }
    }))
    expect(
      (withLiteralProvider.nodes[0]?.meta_data as {
        unilab: { input_bindings: Record<string, unknown> }
      }).unilab.input_bindings
    ).not.toHaveProperty(materialHandleUuid)
    expect(connected.edges).toHaveLength(1)
    expect(() => connectTypedActionEdge(catalog, connected, {
      sourceNodeUuid,
      sourceHandleUuid: upstreamHandleUuid,
      targetNodeUuid: nodeUuid,
      targetHandleUuid: materialHandleUuid
    })).toThrow('操作目标端口已有数据来源')
  })

  it('rejects a real-handle connection that would create a workflow cycle', () => {
    const graphWithReturnPath: WorkflowAuthoringGraph = {
      ...graph,
      edges: [{
        uuid: 'existing-return-path',
        source_node_uuid: nodeUuid,
        source_handle_uuid: readySourceHandleUuid,
        target_node_uuid: sourceNodeUuid,
        target_handle_uuid: readyTargetHandleUuid,
        meta_data: {}
      }]
    }

    expect(() => connectTypedActionEdge(catalog, graphWithReturnPath, {
      sourceNodeUuid,
      sourceHandleUuid: upstreamHandleUuid,
      targetNodeUuid: nodeUuid,
      targetHandleUuid: materialHandleUuid
    })).toThrow('工作流连线会形成环路')
  })

  it('rehydrates only typed Actions while preserving framework wire records', () => {
    const frameworkTemplateUuid = '21000000-0000-4000-8000-000000000001'
    const frameworkHandleUuid = '31000000-0000-4000-8000-000000000001'
    const frameworkNodeUuid = '41000000-0000-4000-8000-000000000001'
    const frameworkTemplate = {
      uuid: frameworkTemplateUuid,
      name: 'material_source',
      type: 'material_source',
      node_type: 'material_source',
      meta_data: { unilab: { framework: true, extension: 'preserve-me' } }
    }
    const frameworkHandle = {
      uuid: frameworkHandleUuid,
      workflow_node_template_uuid: frameworkTemplateUuid,
      handle_key: 'material',
      io_type: 'source',
      type: 'ResourceSlot',
      meta_data: { unilab: { framework: true, extension: 'preserve-me' } }
    }
    const mixedGraph: WorkflowAuthoringGraph = {
      ...graph,
      nodes: [
        graph.nodes[0]!,
        {
          uuid: frameworkNodeUuid,
          workflow_node_template_uuid: frameworkTemplateUuid,
          name: 'sample',
          type: 'material_source',
          param: { resource_template_uuid: 'plate-96' }
        }
      ],
      edges: [{
        uuid: '51000000-0000-4000-8000-000000000001',
        source_node_uuid: frameworkNodeUuid,
        source_handle_uuid: frameworkHandleUuid,
        target_node_uuid: nodeUuid,
        target_handle_uuid: materialHandleUuid,
        meta_data: { extension: 'preserve-me' }
      }],
      node_templates: [
        { uuid: templateUuid, stale: true },
        frameworkTemplate
      ],
      handle_templates: [
        { uuid: materialHandleUuid, stale: true },
        frameworkHandle
      ]
    }

    const rehydrated = rehydrateTypedActionGraph(catalog, mixedGraph)

    expect(rehydrated.nodes).toEqual(mixedGraph.nodes)
    expect(rehydrated.edges).toEqual(mixedGraph.edges)
    expect(rehydrated.node_templates).toContainEqual(frameworkTemplate)
    expect(rehydrated.handle_templates).toContainEqual(frameworkHandle)
    expect(rehydrated.node_templates.find((item) => item.uuid === templateUuid))
      .not.toHaveProperty('stale')
    expect(rehydrated.handle_templates.find(
      (item) => item.uuid === materialHandleUuid
    )).not.toHaveProperty('stale')
  })

  it('scopes edge providers by Node instance and suppresses provided diagnostics', () => {
    const twoTargets: WorkflowAuthoringGraph = {
      ...graph,
      nodes: [
        ...graph.nodes.map((node) => node.uuid !== nodeUuid
          ? node
          : {
              ...node,
              meta_data: {
                unilab: {
                  input_bindings: {
                    [requiredHandleUuid]: { parameter: 'count_input' }
                  }
                }
              }
            }),
        {
          ...graph.nodes[0]!,
          uuid: secondNodeUuid,
          name: 'transfer_2'
        }
      ]
    }
    const firstConnected = connectTypedActionEdge(catalog, twoTargets, {
      sourceNodeUuid,
      sourceHandleUuid: upstreamHandleUuid,
      targetNodeUuid: nodeUuid,
      targetHandleUuid: materialHandleUuid
    })
    const bothConnected = connectTypedActionEdge(catalog, firstConnected, {
      sourceNodeUuid,
      sourceHandleUuid: upstreamHandleUuid,
      targetNodeUuid: secondNodeUuid,
      targetHandleUuid: materialHandleUuid
    })

    expect(bothConnected.edges).toHaveLength(2)
    expect(projectTypedActionEditor(
      catalog,
      bothConnected,
      nodeUuid,
      []
    ).diagnostics).toEqual([])
    expect(() => connectTypedActionEdge(catalog, bothConnected, {
      sourceNodeUuid,
      sourceHandleUuid: upstreamHandleUuid,
      targetNodeUuid: nodeUuid,
      targetHandleUuid: materialHandleUuid
    })).toThrow('操作目标端口已有数据来源')
  })

  it('retains both dirty buffers after a catalog fingerprint conflict', () => {
    expect(catalogConflictDecision({
      dirty: true,
      localPython: 'pump.transfer(mode="fast")\n',
      localGraph: graph,
      observedFingerprint: fingerprint,
      currentFingerprint: `sha256:${'b'.repeat(64)}`
    })).toEqual({
      kind: 'refresh_catalog_and_recompile',
      retainLocalPython: 'pump.transfer(mode="fast")\n',
      retainLocalGraph: graph,
      clearDirty: false
    })
  })

  it('the Persistent Authoring module owns Catalog load and typed projection', () => {
    const source = [
      '../hooks/usePersistentWorkflowAuthoring.ts',
      '../hooks/usePersistentWorkflowCatalogs.ts',
      '../hooks/usePersistentWorkflowCanvasNodeEditor.ts',
      '../components/PersistentWorkflowAuthoringView.tsx',
      '../components/PersistentWorkflowOverlays.tsx'
    ].map((relative) => readFileSync(fileURLToPath(new URL(
      relative,
      import.meta.url
    )), 'utf8')).join('\n')
    const drawerSource = readFileSync(fileURLToPath(new URL(
      '../components/WorkflowActionParameterDrawer.tsx',
      import.meta.url
    )), 'utf8')

    expect(source).toContain('runtime.getWorkflowActionCatalog')
    expect(source).toContain('createTypedActionNode')
    expect(source).toContain('connectTypedActionEdge')
    expect(source).toContain('bindTypedActionWorkflowInput')
    expect(source).toContain('WorkflowActionParameterDrawer')
    expect(drawerSource).toContain('参数来源')
    expect(drawerSource).toContain('实验室物料')
    expect(drawerSource).toContain('WorkflowResourceSelector')
    expect(drawerSource).not.toContain('物料引用（JSON）')
    expect(source).toContain('projectTypedActionEditor')
    expect(drawerSource).toContain('data-workflow-handle-template-uuid')
    expect(source).not.toContain('lastIndexOf')
    expect(source).not.toMatch(/split\([^)]*[.][^)]*\)/)
  })
})

const catalog = {
  authorityId: 'os-local',
  authorityKind: 'local',
  fingerprint,
  actionTemplates: [
    actionTemplate(),
    sourceTemplate()
  ],
  workflowTemplates: []
} satisfies WorkflowActionCatalogSnapshot

const graph: WorkflowAuthoringGraph = {
  workflow: {
    uuid: workflowUuid,
    revision: 1,
    meta_data: {
      unilab: {
        input_contract: {
          version: 1,
          parameters: [
            {
              name: 'count_input',
              schema: { type: 'integer' },
              required: true
            },
            {
              name: 'sample_input',
              schema: {
                $slot: 'ResourceSlot',
                allowed_resource_template_uuids: [
                  '10000000-0000-4000-8000-000000000001'
                ]
              },
              required: true
            }
          ]
        }
      }
    }
  },
  nodes: [
    {
      uuid: nodeUuid,
      workflow_node_template_uuid: templateUuid,
      name: 'transfer',
      param: {
        note: null,
        options: {},
        samples: []
      }
    },
    {
      uuid: sourceNodeUuid,
      workflow_node_template_uuid: sourceTemplateUuid,
      name: 'source',
      param: {}
    }
  ],
  edges: [],
  node_templates: [],
  handle_templates: []
}

function mixedAuthoringGraph(): WorkflowAuthoringGraph {
  const framework = [
    frameworkFixture('control', 11),
    frameworkFixture('group', 12),
    frameworkFixture('branch', 13),
    frameworkFixture('join', 14)
  ]
  const published = publishedWorkflowTemplate()
  return {
    workflow: {
      uuid: workflowUuid,
      revision: 7,
      meta_data: {
        unilab: {
          fixture_sentinel: 'preserve-mixed-workflow'
        }
      }
    },
    nodes: [
      {
        uuid: publishedInvocationUuid,
        workflow_node_template_uuid: publishedWorkflowTemplateUuid,
        name: 'prepare_child',
        type: 'workflow',
        param: { sample: 'S-17' },
        meta_data: {
          unilab: {
            composite: {
              version: 1,
              child_workflow_uuid: publishedWorkflowUuid,
              fixture_sentinel: 'published-invocation'
            }
          }
        }
      },
      ...framework.map((item) => ({
        uuid: item.nodeUuid,
        workflow_node_template_uuid: item.templateUuid,
        name: `${item.kind}_node`,
        type: item.kind,
        param: {},
        meta_data: { fixture_sentinel: `${item.kind}-node` }
      }))
    ],
    edges: [
      {
        uuid: '50000000-0000-4000-8000-000000000010',
        source_node_uuid: framework[2]!.nodeUuid,
        source_handle_uuid: framework[2]!.sourceHandleUuid,
        target_node_uuid: publishedInvocationUuid,
        target_handle_uuid: publishedReadyTargetUuid,
        meta_data: { fixture_sentinel: 'branch-to-child' }
      },
      {
        uuid: '50000000-0000-4000-8000-000000000011',
        source_node_uuid: publishedInvocationUuid,
        source_handle_uuid: publishedReadySourceUuid,
        target_node_uuid: framework[3]!.nodeUuid,
        target_handle_uuid: framework[3]!.targetHandleUuid,
        meta_data: { fixture_sentinel: 'child-to-join' }
      }
    ],
    node_templates: [
      publishedWorkflowWireValue(),
      ...framework.map((item) => item.nodeTemplate)
    ],
    handle_templates: [
      ...published.handles.map((handle) => handleWireValue(handle)),
      ...framework.flatMap((item) => item.handles)
    ]
  }
}

function publishedWorkflowTemplate(): WorkflowActionCatalogSnapshot[
  'workflowTemplates'
][number] {
  const inputSchema = { type: 'string' }
  const outputSchema = { type: 'string' }
  return {
    uuid: publishedWorkflowTemplateUuid,
    resourceTemplateUuid: '10000000-0000-4000-8000-000000000099',
    name: `workflow:${publishedWorkflowUuid}`,
    displayName: 'Prepare child',
    workflowClass: 'c1_published_lab.workflows.child:prepare_child',
    workflowUuid: publishedWorkflowUuid,
    workflowRevision: 7,
    appliedSourceHash: `sha256:${'b'.repeat(64)}`,
    contractDigest: `sha256:${'c'.repeat(64)}`,
    compositionAllowTransparent: false,
    inputOrder: ['sample'],
    outputOrder: ['prepared_sample'],
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        goal: {
          type: 'object',
          additionalProperties: false,
          properties: { sample: inputSchema },
          required: ['sample']
        },
        result: {
          type: 'object',
          additionalProperties: false,
          properties: { prepared_sample: outputSchema },
          required: ['prepared_sample']
        }
      },
      required: ['goal', 'result'],
      'x-unilabos-workflow-contract': {
        version: 1,
        compatibility_version: 1,
        workflow_uuid: publishedWorkflowUuid,
        workflow_revision: 7,
        applied_source_hash: `sha256:${'b'.repeat(64)}`,
        contract_digest: `sha256:${'c'.repeat(64)}`,
        composition_allow_transparent: false,
        input_order: ['sample'],
        output_order: ['prepared_sample']
      }
    },
    goal: { sample: 'sample' },
    goalDefault: {},
    result: { prepared_sample: 'prepared_sample' },
    source: {
      kind: 'package',
      definitionFqid: 'c1_published_lab.workflows.prepare_child',
      module: 'c1_published_lab.workflows.child',
      symbol: 'prepare_child',
      packageCatalogDigest: `sha256:${'d'.repeat(64)}`,
      definitionContentHash: `sha256:${'e'.repeat(64)}`
    },
    handles: [
      publishedHandle(
        publishedInputHandleUuid,
        'sample',
        'target',
        'goal',
        inputSchema,
        true
      ),
      publishedHandle(
        publishedOutputHandleUuid,
        'prepared_sample',
        'source',
        'result',
        outputSchema,
        false
      ),
      publishedReadyHandle(publishedReadyTargetUuid, 'target'),
      publishedReadyHandle(publishedReadySourceUuid, 'source')
    ]
  }
}

function publishedBoundaryCatalog(): WorkflowActionCatalogSnapshot {
  return {
    ...catalog,
    actionTemplates: [actionTemplate(), sourceTemplate()],
    workflowTemplates: [publishedBoundaryTemplate()]
  }
}

function publishedBoundaryTemplate(): WorkflowActionCatalogSnapshot[
  'workflowTemplates'
][number] {
  const base = publishedWorkflowTemplate()
  const input = base.handles.find((handle) =>
    handle.uuid === publishedInputHandleUuid
  )!
  const output = base.handles.find((handle) =>
    handle.uuid === publishedOutputHandleUuid
  )!
  const schema = resourceSlotValueSchema()
  return {
    ...base,
    schema: {
      ...base.schema,
      properties: {
        goal: {
          type: 'object',
          additionalProperties: false,
          properties: { sample: schema },
          required: ['sample']
        },
        result: {
          type: 'object',
          additionalProperties: false,
          properties: { prepared_sample: schema },
          required: ['prepared_sample']
        }
      }
    },
    handles: base.handles.map((handle) => {
      if (handle.uuid !== input.uuid && handle.uuid !== output.uuid) {
        return handle
      }
      return {
        ...handle,
        valueType: 'ResourceSlot',
        valueSchema: schema,
        editorControl: 'material_port' as const,
        allowedResourceTemplateUuids: [
          '10000000-0000-4000-8000-000000000001'
        ]
      }
    })
  }
}

function resourceSlotValueSchema(): Record<string, unknown> {
  return {
    $slot: 'ResourceSlot',
    allowed_resource_template_uuids: [
      '10000000-0000-4000-8000-000000000001'
    ]
  }
}

function publishedBoundaryGraph(
  includeExpandedPrivateNodes = false
): WorkflowAuthoringGraph {
  const actionTarget = structuredClone(graph.nodes[0]!)
  const actionSource = structuredClone(graph.nodes[1]!)
  const nodes: Array<Record<string, unknown>> = [
    actionTarget,
    actionSource,
    {
      uuid: publishedInvocationUuid,
      workflow_node_template_uuid: publishedWorkflowTemplateUuid,
      name: 'prepare_child',
      status: 'idle',
      type: 'workflow',
      pose: {},
      param: {},
      execution_policy: {},
      disabled: false,
      minimized: false,
      meta_data: { unilab: { input_bindings: {} } }
    }
  ]
  if (includeExpandedPrivateNodes) {
    nodes.push(
      {
        ...structuredClone(actionTarget),
        uuid: internalTargetNodeUuid,
        parent_uuid: publishedInvocationUuid,
        name: 'private_target'
      },
      {
        ...structuredClone(actionSource),
        uuid: internalSourceNodeUuid,
        parent_uuid: publishedInvocationUuid,
        name: 'private_source'
      }
    )
  }
  return {
    ...graph,
    nodes,
    edges: [],
    node_templates: [],
    handle_templates: []
  }
}

function publishedWorkflowWireValue(): Record<string, unknown> {
  const template = publishedWorkflowTemplate()
  return {
    uuid: template.uuid,
    resource_template_uuid: template.resourceTemplateUuid,
    name: template.name,
    display_name: template.displayName,
    class: template.workflowClass,
    type: 'workflow',
    node_type: 'workflow',
    schema: template.schema,
    goal: template.goal,
    goal_default: template.goalDefault,
    feedback: {},
    result: template.result,
    meta_data: {
      unilab: {
        framework_owner_only: true,
        workflow_source: {
          kind: template.source.kind,
          definition_fqid: template.source.definitionFqid,
          module: template.source.module,
          symbol: template.source.symbol,
          package_catalog_digest: template.source.packageCatalogDigest,
          definition_content_hash: template.source.definitionContentHash
        },
        fixture_sentinel: 'published-template'
      }
    }
  }
}

function publishedHandle(
  uuid: string,
  key: string,
  ioType: 'source' | 'target',
  dataSource: 'goal' | 'result',
  valueSchema: Record<string, unknown>,
  required: boolean
): WorkflowActionCatalogSnapshot['workflowTemplates'][number]['handles'][number] {
  return {
    uuid,
    workflowNodeTemplateUuid: publishedWorkflowTemplateUuid,
    handleKey: key,
    ioType,
    displayName: key,
    valueType: 'string',
    required,
    dataSource,
    dataKey: key,
    valueSchema,
    editorControl: 'variable_selector',
    allowedResourceTemplateUuids: null,
    implicitPassthrough: false,
    structuralRole: null
  }
}

function publishedReadyHandle(
  uuid: string,
  ioType: 'source' | 'target'
): WorkflowActionCatalogSnapshot['workflowTemplates'][number]['handles'][number] {
  return {
    uuid,
    workflowNodeTemplateUuid: publishedWorkflowTemplateUuid,
    handleKey: 'ready',
    ioType,
    displayName: 'Ready',
    valueType: 'boolean',
    required: false,
    dataSource: 'dependency',
    dataKey: 'ready',
    valueSchema: { type: 'boolean' },
    editorControl: 'variable_selector',
    allowedResourceTemplateUuids: null,
    implicitPassthrough: false,
    structuralRole: 'ready'
  }
}

function frameworkFixture(kind: string, suffix: number): {
  kind: string
  templateUuid: string
  nodeUuid: string
  targetHandleUuid: string
  sourceHandleUuid: string
  nodeTemplate: Record<string, unknown>
  handles: Record<string, unknown>[]
} {
  const digits = String(suffix).padStart(12, '0')
  const templateUuid = `21000000-0000-4000-8000-${digits}`
  const nodeUuid = `41000000-0000-4000-8000-${digits}`
  const targetHandleUuid = `31000000-0000-4000-8000-${digits}`
  const sourceHandleUuid = `32000000-0000-4000-8000-${digits}`
  return {
    kind,
    templateUuid,
    nodeUuid,
    targetHandleUuid,
    sourceHandleUuid,
    nodeTemplate: {
      uuid: templateUuid,
      resource_template_uuid: '10000000-0000-4000-8000-000000000099',
      name: kind,
      display_name: kind,
      class: `unilabos.workflow.authoring:${kind}`,
      type: kind,
      node_type: kind,
      schema: null,
      goal: {},
      goal_default: {},
      feedback: {},
      result: {},
      meta_data: {
        unilab: {
          framework_owner_only: true,
          fixture_sentinel: `${kind}-template`
        }
      }
    },
    handles: [
      frameworkReadyWire(
        targetHandleUuid,
        templateUuid,
        'target',
        `${kind}-ready-target`
      ),
      frameworkReadyWire(
        sourceHandleUuid,
        templateUuid,
        'source',
        `${kind}-ready-source`
      )
    ]
  }
}

function frameworkReadyWire(
  uuid: string,
  templateUuid: string,
  ioType: 'source' | 'target',
  sentinel: string
): Record<string, unknown> {
  return {
    uuid,
    workflow_node_template_uuid: templateUuid,
    handle_key: 'ready',
    io_type: ioType,
    display_name: 'Ready',
    type: 'boolean',
    required: false,
    data_source: 'dependency',
    data_key: 'ready',
    meta_data: {
      unilab: {
        value_schema: { type: 'boolean' },
        editor_control: 'variable_selector',
        allowed_resource_template_uuids: null,
        implicit_passthrough: false,
        structural_role: 'ready',
        fixture_sentinel: sentinel
      }
    }
  }
}

function handleWireValue(
  handle: WorkflowActionCatalogSnapshot['workflowTemplates'][number][
    'handles'
  ][number]
): Record<string, unknown> {
  return {
    uuid: handle.uuid,
    workflow_node_template_uuid: handle.workflowNodeTemplateUuid,
    handle_key: handle.handleKey,
    io_type: handle.ioType,
    display_name: handle.displayName,
    type: handle.valueType,
    required: handle.required,
    data_source: handle.dataSource,
    data_key: handle.dataKey,
    meta_data: {
      unilab: {
        value_schema: handle.valueSchema,
        editor_control: handle.editorControl,
        allowed_resource_template_uuids:
          handle.allowedResourceTemplateUuids,
        implicit_passthrough: handle.implicitPassthrough,
        structural_role: handle.structuralRole,
        fixture_sentinel: `published-${handle.handleKey}-${handle.ioType}`
      }
    }
  }
}

function actionTemplate(): WorkflowActionCatalogSnapshot['actionTemplates'][number] {
  return {
    uuid: templateUuid,
    resourceTemplateUuid: '10000000-0000-4000-8000-000000000001',
    name: 'transfer',
    displayName: '转移',
    actionClass: 'lab.devices:Pump',
    actionType: 'UniLabJsonCommand',
    schema: canonicalSchema(
      ['count', 'temperature', 'note', 'mode', 'options', 'samples', 'material', 'site'],
      []
    ),
    goal: {},
    goalDefault: { temperature: 25, mode: 'safe', note: null },
    handles: [
      readyHandle(readyTargetHandleUuid, 'target'),
      readyHandle(readySourceHandleUuid, 'source'),
      handle(requiredHandleUuid, 'count', { type: 'integer' }, true),
      handle(defaultHandleUuid, 'temperature', {
        type: 'number', default: 25
      }),
      handle(nullableHandleUuid, 'note', {
        anyOf: [{ type: 'string' }, { type: 'null' }], default: null
      }),
      handle(enumHandleUuid, 'mode', {
        type: 'string', enum: ['safe', 'fast'], default: 'safe'
      }),
      handle(objectHandleUuid, 'options', {
        type: 'object', additionalProperties: true
      }),
      handle(listHandleUuid, 'samples', {
        type: 'array', items: { type: 'integer' }
      }),
      handle(materialHandleUuid, 'material', { $slot: 'ResourceSlot' }, true, 'material_port'),
      handle(siteHandleUuid, 'site', { type: 'string' }, false, 'site_selector')
    ]
  }
}

function sourceTemplate(): WorkflowActionCatalogSnapshot['actionTemplates'][number] {
  return {
    uuid: sourceTemplateUuid,
    resourceTemplateUuid: '10000000-0000-4000-8000-000000000002',
    name: 'source',
    displayName: '来源',
    actionClass: 'lab.devices:Source',
    actionType: 'UniLabJsonCommand',
    schema: canonicalSchema([], ['material']),
    goal: {},
    goalDefault: {},
    handles: [{
      ...handle(upstreamHandleUuid, 'material', resourceSlotValueSchema()),
      workflowNodeTemplateUuid: sourceTemplateUuid,
      ioType: 'source',
      dataSource: 'result',
      allowedResourceTemplateUuids: [
        '10000000-0000-4000-8000-000000000001'
      ]
    }]
  }
}

function readyHandle(
  uuid: string,
  ioType: 'source' | 'target'
): WorkflowActionCatalogSnapshot['actionTemplates'][number]['handles'][number] {
  return {
    uuid,
    workflowNodeTemplateUuid: templateUuid,
    handleKey: 'ready',
    ioType,
    displayName: 'Ready',
    valueType: 'boolean',
    required: false,
    dataSource: 'dependency',
    dataKey: 'ready',
    valueSchema: { type: 'boolean' },
    editorControl: 'variable_selector',
    allowedResourceTemplateUuids: null,
    implicitPassthrough: false,
    structuralRole: 'ready'
  }
}

function canonicalSchema(
  inputOrder: string[],
  outputOrder: string[]
): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      goal: { type: 'object' },
      feedback: {},
      result: { type: 'object' }
    },
    'x-unilabos-action-contract': {
      version: 1,
      input_order: inputOrder,
      output_order: outputOrder,
      resource_template_symbols: { goal: {}, result: {} }
    }
  }
}

function handle(
  uuid: string,
  key: string,
  valueSchema: Record<string, unknown>,
  required = false,
  editorControl: 'material_port' | 'site_selector' | 'variable_selector' =
    'variable_selector'
): WorkflowActionCatalogSnapshot['actionTemplates'][number]['handles'][number] {
  return {
    uuid,
    workflowNodeTemplateUuid: templateUuid,
    handleKey: key,
    ioType: 'target',
    displayName: key,
    valueType: valueSchema.$slot === 'ResourceSlot'
      ? 'ResourceSlot'
      : String(valueSchema.type || 'object'),
    required,
    dataSource: 'goal',
    dataKey: key,
    valueSchema,
    editorControl,
    allowedResourceTemplateUuids: editorControl === 'material_port'
      ? ['10000000-0000-4000-8000-000000000001']
      : null,
    implicitPassthrough: false,
    structuralRole: null
  }
}
