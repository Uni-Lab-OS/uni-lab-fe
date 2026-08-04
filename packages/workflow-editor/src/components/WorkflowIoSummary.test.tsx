import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { WorkflowIoMetadata } from '@unilab/services'

import { WorkflowIoSummary } from './WorkflowIoSummary'

const NODE_UUID = '22222222-2222-4222-8222-222222222222'
const SOURCE_HANDLE_UUID = '33333333-3333-4333-8333-333333333333'

const appliedIo: WorkflowIoMetadata = {
  input_contract: {
    version: 1,
    parameters: [
      {
        name: 'sample',
        schema: { $slot: 'ResourceSlot' },
        required: true
      },
      {
        name: 'retries',
        schema: { type: 'integer', minimum: 1 },
        required: false,
        default: 2
      },
      {
        name: 'note',
        schema: {
          anyOf: [{ type: 'string' }, { type: 'null' }]
        },
        required: false,
        default: null
      }
    ]
  },
  output_contract: {
    version: 1,
    outputs: [
      {
        name: 'final_sample',
        schema: { $slot: 'ResourceSlot' },
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
    final_sample: {
      kind: 'node_output',
      workflow_node_uuid: NODE_UUID,
      source_handle_uuid: SOURCE_HANDLE_UUID
    },
    sample: {
      kind: 'workflow_input',
      parameter: 'sample'
    }
  }
}

describe('WorkflowIoSummary', () => {
  it('shows the applied inputs and outputs in order with binding identity', () => {
    const markup = renderToStaticMarkup(<WorkflowIoSummary io={appliedIo} />)
    const inputStart = markup.indexOf('输入参数')
    const outputStart = markup.indexOf('输出参数')

    expect(inputStart).toBeGreaterThanOrEqual(0)
    expect(outputStart).toBeGreaterThan(inputStart)

    const inputText = visibleText(markup.slice(inputStart, outputStart))
    expectInOrder(inputText, ['sample', 'retries', 'note'])
    expect(inputText).toMatch(/必填/)
    expect(inputText).toMatch(/默认值\s*：?\s*2/)
    expect(inputText).toMatch(/允许为空/)

    const outputText = visibleText(markup.slice(outputStart))
    expectInOrder(outputText, ['final_sample', 'sample'])
    expect(outputText).toMatch(/系统生成/)
    expect(outputText).toContain(NODE_UUID)
    expect(outputText).toContain(SOURCE_HANDLE_UUID)
    expect(outputText).toMatch(/工作流输入[\s\S]*sample/)
  })
})

function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function expectInOrder(text: string, values: readonly string[]): void {
  let previous = -1
  for (const value of values) {
    const current = text.indexOf(value, previous + 1)
    expect(current).toBeGreaterThan(previous)
    previous = current
  }
}
