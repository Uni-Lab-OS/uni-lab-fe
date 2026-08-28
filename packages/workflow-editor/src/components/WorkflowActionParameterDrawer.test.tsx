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
const readyHandleUuid = '20000000-0000-4000-8000-000000000005'
const resourceHandleUuid = '20000000-0000-4000-8000-000000000003'
const warehouseHandleUuid = '20000000-0000-4000-8000-000000000004'
const materialTemplateUuid = '40000000-0000-4000-8000-000000000001'
const warehouseTemplateUuid = '40000000-0000-4000-8000-000000000002'

describe('WorkflowActionParameterDrawer', () => {
  it('uses the HTML contract editor and mapping-section visual structure', () => {
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
    expect(text).toContain('设备动作参数映射')
    expect(markup).toContain('node-contract-editor')
    expect(markup).toContain('contract-editor-intro')
    expect(markup).toContain('editable-contract-section')
    expect(markup).toContain('editable-contract-head')
    expect(markup).toContain('contract-param-card')
    expect(markup).toContain('mapping-section')
    expect(markup).toContain('mapping-group-label')
    expect(markup).toContain('mapping-row')
    expect(markup).toContain('parameter-provenance')
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

  it('keeps structural ready handles on the canvas but out of business outputs', () => {
    const markup = renderToStaticMarkup(
      <WorkflowActionParameterDrawer
        open
        nodeName="dose"
        templateName="固体投料"
        editor={editor}
        outputHandles={[outputHandle, readyHandle]}
        graph={graph}
        editable
        onClose={vi.fn()}
        onProviderChange={vi.fn()}
        onLiteralBlur={vi.fn()}
        onClear={vi.fn()}
        onNull={vi.fn()}
      />
    )

    expect(visibleText(markup)).toMatch(/输出\s*1/)
    expect(markup).toContain(outputHandleUuid)
    expect(markup).not.toContain(readyHandleUuid)
  })

  it('surfaces required parameters that still need configuration', () => {
    const missingEditor: TypedActionEditorProjection = {
      ...editor,
      fields: [{
        ...editor.fields[0]!,
        valueState: 'missing',
        value: undefined,
        providerKind: 'missing'
      }],
      diagnostics: [{
        handleUuid: inputHandleUuid,
        fieldPath: '/param/target_mass_g',
        severity: 'error',
        code: 'required_action_parameter_missing',
        message: '目标质量为必填参数'
      }]
    }
    const markup = renderToStaticMarkup(
      <WorkflowActionParameterDrawer
        open
        nodeName="dose"
        templateName="固体投料"
        editor={missingEditor}
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

    expect(visibleText(markup)).toMatch(/已配置\s*0/)
    expect(visibleText(markup)).toMatch(/待补\s*1/)
    expect(markup).toContain('class="has-error"')
  })

  it('uses current-lab material selectors filtered by each allowed template', () => {
    const resourceEditor: TypedActionEditorProjection = {
      ...editor,
      fields: [
        resourceField(
          resourceHandleUuid,
          'resource',
          '待转运物料',
          materialTemplateUuid
        ),
        resourceField(
          warehouseHandleUuid,
          'warehouse',
          '目标仓库',
          warehouseTemplateUuid
        )
      ]
    }
    const markup = renderToStaticMarkup(
      <WorkflowActionParameterDrawer
        open
        nodeName="transfer"
        templateName="标准物料转运"
        editor={resourceEditor}
        outputHandles={[]}
        graph={graph}
        editable
        resourceSlotOptions={{
          kind: 'ready',
          options: [
            {
              materialUuid: '50000000-0000-4000-8000-000000000001',
              resourceTemplateUuid: materialTemplateUuid,
              displayLabel: '烧杯 A · …000001'
            },
            {
              materialUuid: '50000000-0000-4000-8000-000000000002',
              resourceTemplateUuid: warehouseTemplateUuid,
              displayLabel: 'S08 仓库 · …000002'
            }
          ]
        }}
        onClose={vi.fn()}
        onProviderChange={vi.fn()}
        onLiteralBlur={vi.fn()}
        onResourceChange={vi.fn()}
        onClear={vi.fn()}
        onNull={vi.fn()}
      />
    )
    const resourceMarkup = listItemMarkup(markup, resourceHandleUuid)
    const warehouseMarkup = listItemMarkup(markup, warehouseHandleUuid)

    expect(resourceMarkup).toContain('待转运物料 实验室物料')
    expect(resourceMarkup).toContain('烧杯 A · …000001')
    expect(resourceMarkup).not.toContain('S08 仓库 · …000002')
    expect(warehouseMarkup).toContain('目标仓库 实验室物料')
    expect(warehouseMarkup).toContain('S08 仓库 · …000002')
    expect(warehouseMarkup).not.toContain('烧杯 A · …000001')
    expect(markup).not.toContain('物料引用（JSON）')
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

const readyHandle: WorkflowActionHandleTemplate = {
  ...outputHandle,
  uuid: readyHandleUuid,
  handleKey: 'ready',
  displayName: 'Ready',
  valueType: 'boolean',
  dataSource: 'dependency',
  dataKey: 'ready',
  valueSchema: { type: 'boolean' },
  structuralRole: 'ready'
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

function resourceField(
  handleUuid: string,
  dataKey: string,
  displayName: string,
  allowedResourceTemplateUuid: string
): TypedActionEditorProjection['fields'][number] {
  return {
    handleUuid,
    dataKey,
    displayName,
    required: true,
    hasDefault: false,
    defaultValue: undefined,
    nullable: false,
    editorControl: 'material_port',
    valueSchema: { $slot: 'ResourceSlot' },
    allowedResourceTemplateUuids: [allowedResourceTemplateUuid],
    valueState: 'missing',
    value: undefined,
    enumValues: null,
    providerKind: 'literal',
    workflowInput: null,
    workflowInputOptions: []
  }
}

function listItemMarkup(markup: string, handleUuid: string): string {
  const start = markup.indexOf(`data-workflow-handle-template-uuid="${handleUuid}"`)
  const end = markup.indexOf('</li>', start)
  if (start < 0 || end < 0) throw new Error(`Missing parameter ${handleUuid}`)
  return visibleText(markup.slice(start, end))
}

function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
