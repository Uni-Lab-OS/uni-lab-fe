import type {
  WorkflowActionHandleTemplate,
  WorkflowAuthoringGraph
} from '@unilab/services'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { TypedActionEditorProjection } from '../utils/workflowActionCatalog'
import { WorkflowActionParameterDrawer } from './WorkflowActionParameterDrawer'

const nodeUuid = '10000000-0000-4000-8000-000000000001'
const targetNodeUuid = '10000000-0000-4000-8000-000000000002'
const inputHandleUuid = '20000000-0000-4000-8000-000000000001'
const outputHandleUuid = '20000000-0000-4000-8000-000000000002'

describe('WorkflowActionParameterDrawer', () => {
  it('presents typed inputs and OS-owned outputs in one focused dialog', () => {
    const markup = renderToStaticMarkup(
      <WorkflowActionParameterDrawer
        open
        nodeName="dose"
        templateName="固体投料"
        editor={editor}
        outputHandles={[outputHandle]}
        graph={graph}
        editable
        onClose={vi.fn()}
        onProviderChange={vi.fn()}
        onLiteralBlur={vi.fn()}
        onClear={vi.fn()}
        onNull={vi.fn()}
      />
    )
    const text = visibleText(markup)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-label="节点参数 dose"')
    expect(text).toMatch(/输入\s*1/)
    expect(text).toMatch(/输出\s*1/)
    expect(text).toContain('target_mass_g')
    expect(text).toContain('commanded_mass_g')
    expect(text).toContain('下游节点：report')
    expect(text).toContain('工作流输出：commanded_mass_g')
    expect(markup).toContain(inputHandleUuid)
    expect(markup).toContain(outputHandleUuid)
  })

  it('makes output handles inspectable without exposing a value editor', () => {
    const markup = renderToStaticMarkup(
      <WorkflowActionParameterDrawer
        open
        nodeName="dose"
        templateName="固体投料"
        editor={editor}
        outputHandles={[outputHandle]}
        graph={graph}
        editable={false}
        onClose={vi.fn()}
        onProviderChange={vi.fn()}
        onLiteralBlur={vi.fn()}
        onClear={vi.fn()}
        onNull={vi.fn()}
      />
    )
    const outputStart = markup.indexOf(outputHandleUuid)
    const outputMarkup = markup.slice(outputStart)

    expect(outputStart).toBeGreaterThanOrEqual(0)
    expect(visibleText(markup)).toContain('OS 操作模板')
    expect(outputMarkup).not.toMatch(/<input|<select/)
  })
})

const editor: TypedActionEditorProjection = {
  nodeUuid,
  templateUuid: '30000000-0000-4000-8000-000000000001',
  fields: [{
    handleUuid: inputHandleUuid,
    dataKey: 'target_mass_g',
    displayName: '目标质量',
    required: true,
    hasDefault: true,
    defaultValue: 1,
    nullable: false,
    editorControl: 'variable_selector',
    valueSchema: { type: 'number', default: 1 },
    valueState: 'value',
    value: 2,
    enumValues: null,
    providerKind: 'literal',
    workflowInput: null,
    workflowInputOptions: ['target_mass_g']
  }],
  diagnostics: []
}

const outputHandle: WorkflowActionHandleTemplate = {
  uuid: outputHandleUuid,
  workflowNodeTemplateUuid: editor.templateUuid,
  handleKey: 'commanded_mass_g',
  ioType: 'source',
  displayName: 'commanded_mass_g',
  valueType: 'float',
  required: false,
  dataSource: 'result',
  dataKey: 'commanded_mass_g',
  valueSchema: { type: 'number' },
  editorControl: 'variable_selector',
  allowedResourceTemplateUuids: null,
  implicitPassthrough: false,
  structuralRole: null
}

const graph: WorkflowAuthoringGraph = {
  workflow: {
    meta_data: {
      unilab: {
        input_contract: { version: 1, parameters: [] },
        output_contract: {
          version: 1,
          outputs: [{
            name: 'commanded_mass_g',
            schema: { type: 'number' },
            implicit: false
          }]
        },
        output_bindings: {
          commanded_mass_g: {
            kind: 'node_output',
            workflow_node_uuid: nodeUuid,
            source_handle_uuid: outputHandleUuid
          }
        }
      }
    }
  },
  nodes: [
    { uuid: nodeUuid, name: 'dose' },
    { uuid: targetNodeUuid, name: 'report' }
  ],
  edges: [{
    source_node_uuid: nodeUuid,
    source_handle_uuid: outputHandleUuid,
    target_node_uuid: targetNodeUuid,
    target_handle_uuid: inputHandleUuid
  }],
  node_templates: [],
  handle_templates: []
}

function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
