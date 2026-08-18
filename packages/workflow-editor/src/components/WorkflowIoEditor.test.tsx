import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { WorkflowAuthoringGraph } from '@unilab/services'

import { WorkflowIoEditor } from './WorkflowIoEditor'

const targetNodeUuid = '40000000-0000-4000-8000-000000000001'
const sourceNodeUuid = '40000000-0000-4000-8000-000000000002'
const targetTemplateUuid = '20000000-0000-4000-8000-000000000001'
const sourceTemplateUuid = '20000000-0000-4000-8000-000000000002'
const targetHandleUuid = '30000000-0000-4000-8000-000000000001'
const sourceHandleUuid = '30000000-0000-4000-8000-000000000002'
const resourceTemplateUuid = '70000000-0000-4000-8000-000000000001'
const otherResourceTemplateUuid = '70000000-0000-4000-8000-000000000002'

describe('WorkflowIoEditor', () => {
  it('exposes editable inputs, outputs, add actions, and stable Handle identity', () => {
    const markup = renderToStaticMarkup(
      <WorkflowIoEditor graph={graph} editable onGraphChange={() => {}} />
    )
    const text = visibleText(markup)

    expect(text).toMatch(/输入参数/)
    expect(text).toMatch(/输出参数/)
    expect(text).toMatch(/添加输入参数/)
    expect(text).toMatch(/添加输出参数/)
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('id="workflow-io-panel-output"')
    expect(markup).toMatch(/id="workflow-io-panel-output"[^>]*hidden=""/)
    expect(text).toContain('count')
    expect(text).toContain('report')
    expect(markup).toContain('<code title="count">count</code>')
    expect(markup).toContain('<code title="report">report</code>')
    expect(markup).toContain(`data-workflow-node-uuid="${targetNodeUuid}"`)
    expect(markup).toContain(`data-workflow-node-uuid="${sourceNodeUuid}"`)
    expect(markup).toContain(
      `data-workflow-handle-template-uuid="${targetHandleUuid}"`
    )
    expect(markup).toContain(
      `data-workflow-handle-template-uuid="${sourceHandleUuid}"`
    )
  })

  it('renders implicit ResourceSlot pass-through output as read-only', () => {
    const markup = renderToStaticMarkup(
      <WorkflowIoEditor graph={graph} editable onGraphChange={() => {}} />
    )
    const implicitStart = markup.indexOf('data-workflow-output-name="sample"')
    const implicitMarkup = markup.slice(
      implicitStart,
      markup.indexOf('</li>', implicitStart) + '</li>'.length
    )

    expect(implicitStart).toBeGreaterThanOrEqual(0)
    expect(implicitMarkup).toContain('aria-readonly="true"')
    expect(implicitMarkup).toMatch(/disabled=""|disabled(?=[ >])/)
    expect(visibleText(implicitMarkup)).toMatch(/系统生成|OS 管理/i)
  })

  it('shows translated labels while preserving complete parameter names', () => {
    const translatedGraph = withIoDescriptors(
      [
        {
          name: 'sample_id',
          schema: { type: 'string' },
          required: false
        },
        {
          name: 'custom_parameter_with_a_long_name',
          title: '自定义参数',
          schema: { type: 'number' },
          required: true
        }
      ],
      [{
        name: 'inspection_result',
        schema: { type: 'string' },
        implicit: false
      }]
    )
    const markup = renderToStaticMarkup(
      <WorkflowIoEditor
        graph={translatedGraph}
        editable
        onGraphChange={() => {}}
      />
    )

    expect(inputMarkup(markup, 'sample_id')).toContain('样品编号')
    expect(inputMarkup(markup, 'sample_id')).toContain(
      '<code title="sample_id">sample_id</code>'
    )
    expect(inputMarkup(markup, 'custom_parameter_with_a_long_name'))
      .toContain('自定义参数')
    expect(inputMarkup(markup, 'custom_parameter_with_a_long_name'))
      .toContain('custom_parameter_with_a_long_name')
    expect(outputMarkup(markup, 'inspection_result')).toContain('检测结果')
  })

  it('renders editable closed-v1 controls without losing recursive schema', () => {
    const markup = renderToStaticMarkup(
      <WorkflowIoEditor
        graph={schemaGraph()}
        editable
        onGraphChange={() => {}}
      />
    )
    const temperature = inputMarkup(markup, 'temperature')
    const labels = inputMarkup(markup, 'labels')
    const payloads = inputMarkup(markup, 'payloads')
    const sample = inputMarkup(markup, 'sample')
    const metrics = outputMarkup(markup, 'metrics')

    expect(temperature).toContain('aria-label="temperature 入参 可选值 JSON"')
    expect(temperature).toContain('value="[20,40]"')
    expect(temperature).toContain('aria-label="temperature 入参 最小值"')
    expect(temperature).toContain('value="10"')
    expect(temperature).toContain('aria-label="temperature 入参 最大值"')
    expect(temperature).toContain('value="80"')

    expect(labels).toMatch(
      /<option(?=[^>]*value="array")(?=[^>]*selected="")[^>]*>/
    )
    expect(labels).toContain('aria-label="labels 入参 项目 数据类型"')
    expect(labels).toContain('aria-label="labels 入参 项目 可选值 JSON"')
    expect(labels).toContain('value="[&quot;fast&quot;,&quot;safe&quot;]"')
    expect(labels).toContain('aria-label="labels 入参 项目 最短长度"')
    expect(labels).toContain('value="4"')
    expect(labels).toContain('aria-label="labels 入参 项目 最长长度"')
    expect(labels).toContain('value="8"')
    expect(labels).toContain('aria-label="labels 入参 最少项目数"')
    expect(labels).toContain('aria-label="labels 入参 最多项目数"')
    expect(payloads).toContain('aria-label="payloads 入参 项目 数据类型"')
    expect(payloads).toMatch(
      /<option(?=[^>]*value="object")(?=[^>]*selected="")[^>]*>/
    )

    expect(sample).toContain(
      'aria-label="sample 入参 允许的资源模板 UUID"'
    )
    expect(sample).toContain(resourceTemplateUuid)
    expect(sample).toContain(otherResourceTemplateUuid)
    expect(metrics).toMatch(
      /<option(?=[^>]*value="array")(?=[^>]*selected="")[^>]*>/
    )
    expect(metrics).toContain('aria-label="metrics 出参 项目 数据类型"')
    expect(metrics).toContain('aria-label="metrics 出参 项目 最小值"')
    expect(metrics).toContain('aria-label="metrics 出参 项目 最大值"')
  })

  it('uses stable Node and Handle UUIDs as input target option values', () => {
    const markup = renderToStaticMarkup(
      <WorkflowIoEditor graph={graph} editable onGraphChange={() => {}} />
    )
    const count = inputMarkup(markup, 'count')

    expect(count).toContain(
      `value="node:${targetNodeUuid}:${targetHandleUuid}"`
    )
    expect(count).not.toMatch(/<option[^>]*value="\d+"[^>]*>/)
  })

  it('offers ordered input and output movement without replacing identities', () => {
    const markup = renderToStaticMarkup(
      <WorkflowIoEditor
        graph={orderingGraph()}
        editable
        onGraphChange={() => {}}
      />
    )

    expect(visibleText(inputMarkup(markup, 'count'))).toMatch(/上移|move up/i)
    expect(visibleText(inputMarkup(markup, 'count'))).toMatch(/下移|move down/i)
    expect(visibleText(outputMarkup(markup, 'report'))).toMatch(/上移|move up/i)
    expect(visibleText(outputMarkup(markup, 'report'))).toMatch(/下移|move down/i)
  })

  it('offers a direct real-identity unbind action for an input binding', () => {
    const markup = renderToStaticMarkup(
      <WorkflowIoEditor graph={graph} editable onGraphChange={() => {}} />
    )
    const count = inputMarkup(markup, 'count')
    const unbindButton = new RegExp(
      '<button' +
      `(?=[^>]*data-workflow-node-uuid="${targetNodeUuid}")` +
      `(?=[^>]*data-workflow-handle-template-uuid="${targetHandleUuid}")` +
      '[^>]*>[^<]*(?:解除|Unbind)',
      'i'
    )

    expect(count).toMatch(unbindButton)
  })

  it.each(['sample', 'samples'])
  ('keeps non-nullable ResourceSlot input %s required until made nullable',
    (name) => {
      const markup = renderToStaticMarkup(
        <WorkflowIoEditor
          graph={schemaGraph()}
          editable
          onGraphChange={() => {}}
        />
      )
      const row = inputMarkup(markup, name)

      expect(row).toMatch(
        /<label[^>]*io-check[^>]*><input(?=[^>]*type="checkbox")(?=[^>]*disabled="")[^>]*\/>必填<\/label>/
      )
      expect(visibleText(row)).toMatch(/允许为空|可空/i)
      expect(row).not.toContain('value="{&quot;uuid&quot;:&quot;&quot;}"')
      expect(row).not.toContain('value="[]"')
    })
})

const graph: WorkflowAuthoringGraph = {
  workflow: {
    uuid: '60000000-0000-4000-8000-000000000001',
    revision: 7,
    meta_data: {
      unilab: {
        input_contract: {
          version: 1,
          parameters: [
            { name: 'count', schema: { type: 'integer' }, required: true },
            {
              name: 'sample',
              schema: { $slot: 'ResourceSlot' },
              required: true
            }
          ]
        },
        output_contract: {
          version: 1,
          outputs: [
            {
              name: 'report',
              schema: { type: 'object' },
              implicit: false
            },
            {
              name: 'sample',
              schema: { $slot: 'ResourceSlot' },
              implicit: true
            }
          ]
        },
        output_bindings: {
          report: {
            kind: 'node_output',
            workflow_node_uuid: sourceNodeUuid,
            source_handle_uuid: sourceHandleUuid
          },
          sample: { kind: 'workflow_input', parameter: 'sample' }
        }
      }
    }
  },
  nodes: [
    {
      uuid: targetNodeUuid,
      workflow_node_template_uuid: targetTemplateUuid,
      name: 'target',
      param: {},
      meta_data: {
        unilab: {
          input_bindings: {
            [targetHandleUuid]: { parameter: 'count' }
          }
        }
      }
    },
    {
      uuid: sourceNodeUuid,
      workflow_node_template_uuid: sourceTemplateUuid,
      name: 'source',
      param: {},
      meta_data: { unilab: { input_bindings: {} } }
    }
  ],
  edges: [],
  node_templates: [
    { uuid: targetTemplateUuid, name: 'target' },
    { uuid: sourceTemplateUuid, name: 'source' }
  ],
  handle_templates: [
    {
      uuid: targetHandleUuid,
      workflow_node_template_uuid: targetTemplateUuid,
      handle_key: 'target_value',
      io_type: 'target'
    },
    {
      uuid: sourceHandleUuid,
      workflow_node_template_uuid: sourceTemplateUuid,
      handle_key: 'result',
      io_type: 'source'
    }
  ]
}

function schemaGraph(): WorkflowAuthoringGraph {
  return withIoDescriptors(
    [
      {
        name: 'temperature',
        schema: {
          type: 'number',
          enum: [20, 40],
          minimum: 10,
          maximum: 80
        },
        required: true
      },
      {
        name: 'labels',
        schema: {
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
        required: true
      },
      {
        name: 'payloads',
        schema: { type: 'array', items: { type: 'object' } },
        required: true
      },
      {
        name: 'sample',
        schema: {
          $slot: 'ResourceSlot',
          allowed_resource_template_uuids: [
            resourceTemplateUuid,
            otherResourceTemplateUuid
          ]
        },
        required: true
      },
      {
        name: 'samples',
        schema: {
          type: 'array',
          items: {
            $slot: 'ResourceSlot',
            allowed_resource_template_uuids: [resourceTemplateUuid]
          }
        },
        required: true
      }
    ],
    [{
      name: 'metrics',
      schema: {
        type: 'array',
        items: { type: 'number', minimum: 0, maximum: 1 },
        minItems: 1,
        maxItems: 8
      },
      implicit: false
    }]
  )
}

function orderingGraph(): WorkflowAuthoringGraph {
  return withIoDescriptors(
    [
      { name: 'count', schema: { type: 'integer' }, required: true },
      { name: 'mode', schema: { type: 'string' }, required: true }
    ],
    [
      { name: 'report', schema: { type: 'object' }, implicit: false },
      { name: 'summary', schema: { type: 'string' }, implicit: false }
    ]
  )
}

function withIoDescriptors(
  parameters: Array<Record<string, unknown>>,
  outputs: Array<Record<string, unknown>>
): WorkflowAuthoringGraph {
  const next = structuredClone(graph)
  const unilab = next.workflow.meta_data?.unilab as Record<string, unknown>
  unilab.input_contract = { version: 1, parameters }
  unilab.output_contract = { version: 1, outputs }
  unilab.output_bindings = {}
  return next
}

function inputMarkup(markup: string, name: string): string {
  return rowMarkup(markup, `data-workflow-input-name="${name}"`)
}

function outputMarkup(markup: string, name: string): string {
  return rowMarkup(markup, `data-workflow-output-name="${name}"`)
}

function rowMarkup(markup: string, identity: string): string {
  const start = markup.indexOf(identity)
  expect(start).toBeGreaterThanOrEqual(0)
  return markup.slice(start, markup.indexOf('</li>', start) + '</li>'.length)
}

function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
