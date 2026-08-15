import { describe, expect, it } from 'vitest'

import type { WorkflowAuthoringGraph } from '@unilab/services'

import {
  beautifyPersistentAuthoringGraph,
  parseWorkflowAuthoringGraphImport,
  projectPersistentAuthoringGraph,
  updatePersistentAuthoringNodeDisabled,
  updatePersistentAuthoringNodeName
} from './persistentAuthoringGraph'
import { projectNestedWorkflow } from './canonicalWorkflow'

const graph: WorkflowAuthoringGraph = {
  workflow: { uuid: 'workflow-1', revision: 7 },
  nodes: [
    { uuid: 'node-1', name: 'prepared', param: {} },
    { uuid: 'node-2', name: 'analyzed', param: {} }
  ],
  edges: [],
  node_templates: [],
  handle_templates: []
}

describe('persistent Authoring canvas graph edits', () => {
  it('projects explicit material-transfer safety without inferring it for ordinary nodes', () => {
    const projected = projectPersistentAuthoringGraph({
      ...graph,
      nodes: [
        {
          ...graph.nodes[0],
          meta_data: {
            bioyond: {
              material_transfer: {
                source: {
                  device: 'plate_hotel',
                  mount_resource: 'hotel-carrier',
                  site: 'interaction_site'
                },
                target: {
                  device: 'labeler',
                  mount_resource: 'labeler-carrier',
                  site: 'operator_slot_01'
                },
                hardware_executable: false,
                blockers: [
                  {
                    code: 'uncalibrated_robot_route',
                    message: 'RobotB 路线尚未标定'
                  }
                ]
              }
            }
          }
        },
        graph.nodes[1]!
      ]
    })

    expect(projected.nodes[0]?.materialTransferSafety).toEqual({
      hardwareExecutable: false,
      blockers: [{
        code: 'uncalibrated_robot_route',
        message: 'RobotB 路线尚未标定'
      }],
      source: {
        device: 'plate_hotel',
        mountResource: 'hotel-carrier',
        site: 'interaction_site'
      },
      target: {
        device: 'labeler',
        mountResource: 'labeler-carrier',
        site: 'operator_slot_01'
      }
    })
    expect(projected.nodes[1]).not.toHaveProperty('materialTransferSafety')
  })

  it('persists node disablement and projects a visible disabled marker', () => {
    const disabled = updatePersistentAuthoringNodeDisabled(graph, 'node-1', true)
    const projected = projectPersistentAuthoringGraph(disabled)

    expect(disabled.nodes[0]?.disabled).toBe(true)
    expect(graph.nodes[0]?.disabled).toBeUndefined()
    expect(projected.nodes[0]?.disabled).toBe(true)

    const enabled = updatePersistentAuthoringNodeDisabled(
      disabled,
      'node-1',
      false
    )
    expect(enabled.nodes[0]?.disabled).toBe(false)
  })

  it('projects localized action presentation while preserving an explicit custom title', () => {
    const projected = projectPersistentAuthoringGraph({
      ...graph,
      nodes: [
        {
          uuid: 'dose-node',
          name: 'dose_powder_with_two_materials',
          action_name: 'dose_powder_with_two_materials',
          description: '使用粗、精注粉桶向同一烧杯投粉',
          workflow_node_template_uuid: 'dose-template',
          param: {}
        },
        {
          uuid: 'custom-dose-node',
          name: '定制投粉步骤',
          action_name: 'dose_powder_with_two_materials',
          workflow_node_template_uuid: 'dose-template',
          param: {}
        }
      ],
      node_templates: [{
        uuid: 'dose-template',
        name: 'dose_powder_with_two_materials',
        display_name: 'S07 双粉桶注粉',
        description: '使用已装入 S07 的粗、精注粉桶向同一烧杯投粉（物料感知）',
        type: 'UniLabJsonCommand',
        node_type: 'ILab'
      }],
      handle_templates: []
    })

    expect(projected.nodes[0]).toMatchObject({
      name: 'S07 双粉桶注粉',
      description: '使用粗、精注粉桶向同一烧杯投粉'
    })
    expect(projected.nodes[1]).toMatchObject({
      name: '定制投粉步骤',
      description: '使用已装入 S07 的粗、精注粉桶向同一烧杯投粉（物料感知）'
    })
  })

  /** 验证自动布局写回节点姿态且不破坏 OS 持有的其它姿态字段。 */
  it('beautifies the graph immutably and preserves non-planar pose fields', () => {
    const source: WorkflowAuthoringGraph = {
      ...graph,
      nodes: [
        {
          ...graph.nodes[0],
          type: 'material_source',
          pose: {
            frame: 'workflow',
            position: { x: 940, y: 720, z: 12 }
          }
        },
        {
          ...graph.nodes[1],
          pose: { position: { x: 80, y: 40, z: 18 } }
        }
      ],
      edges: [{
        uuid: 'edge-1',
        source_node_uuid: 'node-1',
        target_node_uuid: 'node-2',
        source_handle_uuid: 'source-handle',
        target_handle_uuid: 'target-handle'
      }]
    }

    const updated = beautifyPersistentAuthoringGraph(source)

    expect(updated).not.toBe(source)
    expect(updated.nodes[0]).toMatchObject({
      pose: {
        frame: 'workflow',
        position: { x: 212, y: 16, z: 12 }
      }
    })
    expect(updated.nodes[1]).toMatchObject({
      pose: { position: { x: 180, y: 180, z: 18 } }
    })
    expect(source.nodes[0]).toMatchObject({
      pose: { position: { x: 940, y: 720, z: 12 } }
    })
  })

  it('projects real Handle UUIDs into ReactFlow nodes and edges', () => {
    const projected = projectPersistentAuthoringGraph({
      ...graph,
      nodes: [
        {
          uuid: 'node-1',
          name: 'prepared',
          workflow_node_template_uuid: 'template-1',
          param: {}
        },
        {
          uuid: 'node-2',
          name: 'analyzed',
          workflow_node_template_uuid: 'template-2',
          param: {}
        }
      ],
      node_templates: [
        { uuid: 'template-1', name: 'source', type: 'action' },
        { uuid: 'template-2', name: 'target', type: 'action' }
      ],
      handle_templates: [
        {
          uuid: 'source-handle',
          workflow_node_template_uuid: 'template-1',
          handle_key: 'sample',
          display_name: '样品输出',
          description: '处理后的样品',
          io_type: 'source',
          type: 'ResourceSlot',
          data_key: 'sample',
          meta_data: {
            unilab: {
              value_schema: { $slot: 'ResourceSlot' },
              editor_control: 'material_port',
              allowed_resource_template_uuids: ['plate-template'],
              implicit_passthrough: true
            }
          }
        },
        {
          uuid: 'target-handle',
          workflow_node_template_uuid: 'template-2',
          handle_key: 'sample',
          display_name: '样品输入',
          io_type: 'target',
          type: 'ResourceSlot',
          data_key: 'sample',
          meta_data: {
            unilab: {
              value_schema: { $slot: 'ResourceSlot' },
              editor_control: 'material_port',
              allowed_resource_template_uuids: ['plate-template'],
              implicit_passthrough: false
            }
          }
        }
      ],
      edges: [{
        uuid: 'edge-1',
        source_node_uuid: 'node-1',
        source_handle_uuid: 'source-handle',
        target_node_uuid: 'node-2',
        target_handle_uuid: 'target-handle',
        meta_data: {}
      }]
    })

    expect(projected.nodes[0]?.handles).toEqual([{
      uuid: 'source-handle',
      handleKey: 'sample',
      displayName: '样品输出',
      title: '样品输出',
      description: '处理后的样品',
      ioType: 'source',
      valueType: 'ResourceSlot',
      valueSchema: { $slot: 'ResourceSlot' },
      dataKey: 'sample',
      editorControl: 'material_port',
      allowedResourceTemplateUuids: ['plate-template'],
      implicitPassthrough: true
    }])
    expect(projected.nodes[1]?.handles).toEqual([
      expect.objectContaining({
        uuid: 'target-handle',
        ioType: 'target',
        title: '样品输入',
        valueType: 'ResourceSlot',
        valueSchema: { $slot: 'ResourceSlot' },
        dataKey: 'sample',
        editorControl: 'material_port',
        allowedResourceTemplateUuids: ['plate-template'],
        implicitPassthrough: false
      })
    ])
    expect(projected.links).toEqual([
      expect.objectContaining({
        sourceHandleUuid: 'source-handle',
        targetHandleUuid: 'target-handle'
      })
    ])
  })

  it('creates an immutable, Python-representable node rename', () => {
    const updated = updatePersistentAuthoringNodeName(
      graph,
      'node-1',
      'prepared_canvas'
    )

    expect(updated).not.toBe(graph)
    expect(updated.nodes[0]).not.toBe(graph.nodes[0])
    expect(updated.nodes[0]?.name).toBe('prepared_canvas')
    expect(updated.nodes[1]).toBe(graph.nodes[1])
    expect(graph.nodes[0]?.name).toBe('prepared')
  })

  it.each(['', 'not valid', '9starts_with_number', 'already-used'])(
    'rejects a node name that cannot safely round-trip: %s',
    (name) => {
      const source = name === 'already-used'
        ? {
            ...graph,
            nodes: graph.nodes.map((node, index) => index === 1
              ? { ...node, name: 'already-used' }
              : node)
          }
        : graph
      expect(() => updatePersistentAuthoringNodeName(source, 'node-1', name))
        .toThrow()
    }
  )
})

describe('C1 persistent Composite hierarchy', () => {
  /**
   * 验证 OS 数据库读投影中的 JSON 文本 Schema 仍能识别组合工作流调用。
   *
   * @returns 无返回值；投影缺少子工作流分组语义时由 Vitest 报告失败。
   * @throws 测试夹具或投影解析异常时由 Vitest 报告。
   */
  it('accepts the OS JSON string schema for Published workflow hierarchy', () => {
    const source = compositeGraph()
    source.node_templates = source.node_templates.map((template) =>
      template.uuid === 'outer-template'
        ? { ...template, schema: JSON.stringify(template.schema) }
        : template
    )

    const projected = projectPersistentAuthoringGraph(source)
    const outer = projected.nodes.find((node) => node.id === 'outer')

    expect(outer).toEqual(expect.objectContaining({
      groupKind: 'subworkflow',
      collapsedByDefault: true,
      openChildWorkflowUuid: 'workflow-child-outer'
    }))
  })

  it('projects the robot transfer visual from OS published source metadata', () => {
    const source = compositeGraph()
    source.node_templates = source.node_templates.map((template) =>
      template.uuid === 'outer-template'
        ? publishedTemplate(
            'outer-template',
            'workflow-child-outer',
            'sha256:outer-contract',
            's_z_lab_标准物料转运'
          )
        : template
    )

    const projected = projectPersistentAuthoringGraph(source)
    const byId = new Map(projected.nodes.map((node) => [node.id, node]))

    expect(byId.get('outer')?.visualKind).toBe('robot-transfer')
    expect(byId.get('inner')).not.toHaveProperty('visualKind')
  })

  it('uses OS parent_uuid and Published templates as the hierarchy authority', () => {
    const projected = projectPersistentAuthoringGraph(compositeGraph())
    const byId = new Map(projected.nodes.map((node) => [node.id, node]))

    expect(byId.get('outer')).toEqual(expect.objectContaining({
      groupKind: 'subworkflow',
      collapsedByDefault: true,
      childNodeIds: ['outer-action', 'inner'],
      descendantNodeIds: ['outer-action', 'inner', 'inner-action'],
      openChildWorkflowUuid: 'workflow-child-outer'
    }))
    expect(byId.get('inner')).toEqual(expect.objectContaining({
      groupKind: 'subworkflow',
      parentGroupId: 'outer',
      childNodeIds: ['inner-action'],
      descendantNodeIds: ['inner-action'],
      authoringReadOnly: true,
      openChildWorkflowUuid: 'workflow-child-inner'
    }))
    expect(byId.get('outer-action')).toEqual(expect.objectContaining({
      parentGroupId: 'outer',
      authoringReadOnly: true,
      openChildWorkflowUuid: 'workflow-child-outer'
    }))
    expect(byId.get('inner-action')).toEqual(expect.objectContaining({
      parentGroupId: 'inner',
      authoringReadOnly: true,
      openChildWorkflowUuid: 'workflow-child-inner'
    }))
    expect(byId.get('root-source')).not.toHaveProperty('parentGroupId')
  })

  it('collapses to boundaries, expands one level at a time, and never rewires external endpoints', () => {
    const graph = compositeGraph()
    const before = structuredClone(graph)
    const projected = projectPersistentAuthoringGraph(graph)

    const collapsed = projectNestedWorkflow(
      projected.nodes,
      projected.links,
      new Set()
    )
    expect(collapsed.nodes.map((node) => node.id)).toEqual([
      'root-source',
      'outer',
      'root-sink'
    ])
    expect(collapsed.links.map(edgeIdentity)).toEqual([
      'root-source:source-boundary->outer:outer-input',
      'outer:outer-output->root-sink:sink-boundary'
    ])

    const outerExpanded = projectNestedWorkflow(
      projected.nodes,
      projected.links,
      new Set(['outer'])
    )
    expect(outerExpanded.nodes.map((node) => node.id)).toEqual([
      'root-source',
      'outer',
      'outer-action',
      'inner',
      'root-sink'
    ])

    const fullyExpanded = projectNestedWorkflow(
      projected.nodes,
      projected.links,
      new Set(['outer', 'inner'])
    )
    expect(fullyExpanded.nodes.map((node) => node.id)).toEqual([
      'root-source',
      'outer',
      'outer-action',
      'inner',
      'inner-action',
      'root-sink'
    ])
    expect(fullyExpanded.links.map(edgeIdentity)).toContain(
      'root-source:source-boundary->outer:outer-input'
    )
    expect(fullyExpanded.links.map(edgeIdentity)).toContain(
      'outer:outer-output->root-sink:sink-boundary'
    )
    expect(graph).toEqual(before)
  })

  it('changes the Composite projection signature when the OS graph revision changes', () => {
    const first = projectPersistentAuthoringGraph(compositeGraph())
    const nextGraph = compositeGraph()
    nextGraph.workflow = { ...nextGraph.workflow, revision: 9 }
    const second = projectPersistentAuthoringGraph(nextGraph)
    const firstOuter = first.nodes.find((node) => node.id === 'outer')
    const secondOuter = second.nodes.find((node) => node.id === 'outer')

    expect(projectionField(firstOuter, 'compositeSignature')).toBeTruthy()
    expect(projectionField(secondOuter, 'compositeSignature')).not.toBe(
      projectionField(firstOuter, 'compositeSignature')
    )
  })
})

describe('persistent Authoring Graph file import', () => {
  it('accepts a raw graph for the current Workflow', () => {
    expect(parseWorkflowAuthoringGraphImport(
      JSON.stringify(graph),
      'workflow-1'
    )).toEqual(graph)
  })

  it('prefers the server Candidate graph in an Authoring aggregate', () => {
    const candidateGraph = {
      ...graph,
      nodes: graph.nodes.map((node, index) => index === 0
        ? { ...node, name: 'candidate_node' }
        : node)
    }
    const appliedGraph = {
      ...graph,
      nodes: graph.nodes.map((node, index) => index === 0
        ? { ...node, name: 'applied_node' }
        : node)
    }

    const imported = parseWorkflowAuthoringGraphImport(JSON.stringify({
      data: {
        candidate: { graph: candidateGraph },
        applied_graph: appliedGraph
      }
    }), 'workflow-1')

    expect(imported.nodes[0]?.name).toBe('candidate_node')
  })

  it('rejects malformed and unsupported Canonical/Cloud JSON', () => {
    expect(() => parseWorkflowAuthoringGraphImport('{', 'workflow-1'))
      .toThrow('JSON 文件无法解析，请检查文件格式')
    expect(() => parseWorkflowAuthoringGraphImport(JSON.stringify({
      schemaVersion: 2,
      workflow: { nodes: [] }
    }), 'workflow-1')).toThrow(
      '当前持久 Authoring 只接受 OS WorkflowAuthoringGraph 导出'
    )
  })

  it('rejects a graph owned by another Workflow', () => {
    expect(() => parseWorkflowAuthoringGraphImport(
      JSON.stringify(graph),
      'workflow-2'
    )).toThrow(
      '导入文件属于 Workflow workflow-1，不能覆盖当前 Workflow workflow-2'
    )
  })
})

function compositeGraph(): WorkflowAuthoringGraph {
  return {
    workflow: { uuid: 'workflow-parent', revision: 8 },
    nodes: [
      node('root-source', 'source-template'),
      node('outer', 'outer-template', undefined, 'workflow'),
      node('outer-action', 'action-template', 'outer'),
      node('inner', 'inner-template', 'outer', 'workflow'),
      node('inner-action', 'action-template', 'inner'),
      node('root-sink', 'sink-template')
    ],
    edges: [
      edge(
        'external-input',
        'root-source',
        'source-boundary',
        'outer',
        'outer-input'
      ),
      edge('outer-start', 'outer', 'outer-ready', 'outer-action', 'action-in'),
      edge('outer-inner', 'outer-action', 'action-out', 'inner', 'inner-input'),
      edge('inner-start', 'inner', 'inner-ready', 'inner-action', 'action-in'),
      edge(
        'external-output',
        'outer',
        'outer-output',
        'root-sink',
        'sink-boundary'
      )
    ],
    node_templates: [
      { uuid: 'source-template', type: 'action', name: 'root_source' },
      publishedTemplate(
        'outer-template',
        'workflow-child-outer',
        'sha256:outer-contract'
      ),
      { uuid: 'action-template', type: 'action', name: 'internal_action' },
      publishedTemplate(
        'inner-template',
        'workflow-child-inner',
        'sha256:inner-contract'
      ),
      { uuid: 'sink-template', type: 'action', name: 'root_sink' }
    ],
    handle_templates: []
  }
}

function publishedTemplate(
  uuid: string,
  workflowUuid: string,
  contractDigest: string,
  sourceSymbol?: string
): Record<string, unknown> {
  return {
    uuid,
    type: 'workflow',
    node_type: 'workflow',
    name: `workflow:${workflowUuid}`,
    ...(sourceSymbol
      ? {
          meta_data: {
            unilab: {
              workflow_source: {
                symbol: sourceSymbol,
                definition_fqid:
                  `szlab_poly_studio.workflows.material_transfer.${sourceSymbol}`
              }
            }
          }
        }
      : {}),
    schema: {
      'x-unilabos-workflow-contract': {
        version: 1,
        compatibility_version: 1,
        workflow_uuid: workflowUuid,
        workflow_revision: 3,
        applied_source_hash: 'sha256:applied-source',
        contract_digest: contractDigest,
        composition_allow_transparent: false,
        input_order: ['sample'],
        output_order: ['result']
      }
    }
  }
}

function node(
  uuid: string,
  templateUuid: string,
  parentUuid?: string,
  type = 'action'
): Record<string, unknown> {
  return {
    uuid,
    workflow_node_template_uuid: templateUuid,
    name: uuid,
    type,
    param: {},
    ...(parentUuid ? { parent_uuid: parentUuid } : {})
  }
}

function edge(
  uuid: string,
  sourceNodeUuid: string,
  sourceHandleUuid: string,
  targetNodeUuid: string,
  targetHandleUuid: string
): Record<string, unknown> {
  return {
    uuid,
    source_node_uuid: sourceNodeUuid,
    source_handle_uuid: sourceHandleUuid,
    target_node_uuid: targetNodeUuid,
    target_handle_uuid: targetHandleUuid,
    meta_data: {}
  }
}

function edgeIdentity(link: {
  source: string
  sourceHandleUuid?: string
  target: string
  targetHandleUuid?: string
}): string {
  return `${link.source}:${link.sourceHandleUuid}->` +
    `${link.target}:${link.targetHandleUuid}`
}

function projectionField(
  node: unknown,
  key: string
): unknown {
  return node && typeof node === 'object'
    ? (node as Record<string, unknown>)[key]
    : undefined
}
