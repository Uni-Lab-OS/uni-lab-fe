import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ExperimentOperationControlLibrary } from './ExperimentOperationControlLibrary'
import { createTypedActionNode, projectTypedActionEditor } from '../utils/workflowActionCatalog'
import type { WorkflowActionNodeTemplate, WorkflowAuthoringGraph } from '@unilab/services'

function template(kind: 'condition' | 'repeat_until'): WorkflowActionNodeTemplate {
  const uuid = kind === 'condition' ? '20000000-0000-4000-8000-000000000001' : '20000000-0000-4000-8000-000000000002'
  const resourceTemplateUuid = '10000000-0000-4000-8000-000000000001'
  return { uuid, resourceTemplateUuid, name: kind, displayName: kind,
    actionType: kind, nodeType: kind, actionClass: `unilabos.workflow.authoring:${kind}`,
    schema: { type: 'object', properties: {} }, goal: {}, goalDefault: {}, handles: [],
    wireValue: { uuid, node_type: kind, type: kind, class: `unilabos.workflow.authoring:${kind}`,
      meta_data: { unilab: { executor_kind: kind, framework_owner_only: true } } }
  }
}

const props = () => ({
  catalog: { actionTemplates: [template('condition'), template('repeat_until')], workflowTemplates: [] },
  busy: false, canvasMutationEnabled: true, graphAvailable: true,
  materialSourceCatalogAvailable: true, materialSourceAuthorityBlocked: false,
  materialSourceCatalogLoading: false, materialSourceCatalogError: null,
  onAddManualConfirmation: vi.fn(), onAddAction: vi.fn(), onAddMaterialSource: vi.fn(), onRefreshMaterialSourceCatalog: vi.fn()
})

describe('experiment operation framework nodes', () => {
  it('shows exactly four draggable cards in an expanded independent section', () => {
    const markup = renderToStaticMarkup(<ExperimentOperationControlLibrary {...props()} />)
    expect(markup).toContain('流程控制与物料')
    expect(markup).toContain('物料来源')
    expect(markup).toContain('条件')
    expect(markup).toContain('循环')
    expect(markup.match(/draggable="true"/g)).toHaveLength(4)
    expect(markup).toContain('open=""')
  })
  it('disables missing templates and stale material without hiding the choices', () => {
    const markup = renderToStaticMarkup(<ExperimentOperationControlLibrary {...props()}
      catalog={null} materialSourceAuthorityBlocked />)
    expect(markup.match(/disabled=""/g)).toHaveLength(4)
    expect(markup).not.toContain('draggable="true"')
  })
  it('disables all insertion paths in read-only mode', () => {
    const markup = renderToStaticMarkup(<ExperimentOperationControlLibrary {...props()} canvasMutationEnabled={false} />)
    expect(markup.match(/disabled=""/g)).toHaveLength(4)
    expect(markup).not.toContain('draggable="true"')
  })
  it('routes clicks and drags through the same authority template identity', () => {
    const input = props()
    const tree = ExperimentOperationControlLibrary(input)
    const cards = tree.props.children[1].props.children[1]
    expect(cards[0].props['data-workflow-palette-action']).toBe(input.catalog.actionTemplates[0]!.uuid)
    expect(cards[1].props['data-workflow-palette-action']).toBe(input.catalog.actionTemplates[1]!.uuid)
    expect(cards[2].props['data-workflow-palette-material']).toBe('true')
    cards[0].props.onClick()
    cards[1].props.onClick()
    cards[2].props.onClick()
    expect(input.onAddAction.mock.calls).toEqual(input.catalog.actionTemplates.map(item => [item.uuid]))
    expect(input.onAddMaterialSource).toHaveBeenCalledOnce()
    const setData = vi.fn()
    cards[1].props.onDragStart({ dataTransfer: { setData }, preventDefault: vi.fn() })
    expect(setData).toHaveBeenCalledWith('application/x-unilab-workflow-node-template', JSON.stringify({
      kind: 'action', templateUuid: input.catalog.actionTemplates[1]!.uuid
    }))
  })
  it('人工确认入口点击和拖拽发送确认选择意图，不伪造设备模板', () => {
    const input = props()
    const tree = ExperimentOperationControlLibrary(input)
    const card = tree.props.children[1].props.children[0]
    card.props.onClick()
    expect(input.onAddManualConfirmation).toHaveBeenCalledOnce()
    const setData = vi.fn()
    card.props.onDragStart({ dataTransfer: { setData }, preventDefault: vi.fn() })
    expect(setData).toHaveBeenCalledWith('application/x-unilab-workflow-node-template', JSON.stringify({ kind: 'manual_confirmation' }))
  })
  it.each(['condition', 'repeat_until'] as const)('preserves the authority template and position when inserting %s', kind => {
    const selected = template(kind)
    const catalog = { actionTemplates: [selected], workflowTemplates: [] }
    const graph: WorkflowAuthoringGraph = { workflow: { uuid: '60000000-0000-4000-8000-000000000001', revision: 1 }, nodes: [], edges: [], node_templates: [], handle_templates: [] }
    const created = createTypedActionNode(catalog, graph, { nodeUuid: '40000000-0000-4000-8000-000000000001', templateUuid: selected.uuid, name: kind, position: { x: 100, y: 200 } })
    expect(created.nodes[0]).toMatchObject({ type: kind, workflow_node_template_uuid: selected.uuid, pose: { position: { x: 100, y: 200 } } })
    if (kind === 'condition') {
      expect(created.nodes[0]?.param).toMatchObject({
        predecessor_node_uuids: [],
        branches: [{ label: 'if', condition: { lit: true }, node_uuids: [] }]
      })
    } else {
      expect(created.nodes[0]?.param).toMatchObject({
        loop_variable: 'loop',
        max_iterations: 3,
        until: { lit: true },
        node_uuids: []
      })
    }
    expect(created.node_templates[0]).toEqual(selected.wireValue)
    expect(projectTypedActionEditor(catalog, created, String(created.nodes[0]!.uuid), []).templateUuid).toBe(selected.uuid)
    expect(graph.nodes).toHaveLength(0)
  })
})
