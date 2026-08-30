import type { WorkflowAuthoringAggregate } from '@unilab/services'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

interface TaskInputFormProps {
  aggregate: WorkflowAuthoringAggregate
  form?: unknown
  onChange: (name: string, state: unknown) => void
  onProblem?: (message: string | null) => void
}

const modulePath = './WorkflowTaskInputForm'
const formModule = await import(/* @vite-ignore */ modulePath)
  .catch(() => ({})) as {
    WorkflowTaskInputForm?: ComponentType<TaskInputFormProps>
    workflowEnumValue?: (schema: unknown, selected: string) => unknown
  }

describe('WorkflowTaskInputForm Applied projection', () => {
  it('renders the Applied revision, default hints, and three input states', () => {
    expect(formModule.WorkflowTaskInputForm).toBeTypeOf('function')
    const markup = renderToStaticMarkup(createElement(
      formModule.WorkflowTaskInputForm!,
      { aggregate: aggregate(), onChange: vi.fn() }
    ))
    const text = visibleText(markup)

    expect(text).toMatch(/Applied[^0-9]*7|已应用[^0-9]*7/i)
    expect(text).toMatch(/attempts[\s\S]*(default|默认)[^0-9]*3/i)
    expect(markup).toContain('使用工作流默认值')
    expect(markup).toContain('传入空值')
    expect(markup).toContain('自定义值')
    expect(text).not.toContain('candidate_only')
  })

  it('fails closed for ResourceSlot until the selector round', () => {
    expect(formModule.WorkflowTaskInputForm).toBeTypeOf('function')
    const markup = renderToStaticMarkup(createElement(
      formModule.WorkflowTaskInputForm!,
      { aggregate: aggregate(), onChange: vi.fn() }
    ))
    const text = visibleText(markup)

    expect(text).toMatch(/sample[\s\S]*(ResourceSlot|资源槽|资源位)/i)
    expect(text).toMatch(/暂不支持|尚不可用|不可用|后续.*selector|unavailable/i)
    expect(markup).toMatch(/disabled=""|aria-disabled="true"/i)
  })

  it('enters constrained value editing without clearing a parent rejection', () => {
    expect(formModule.WorkflowTaskInputForm).toBeTypeOf('function')
    const parentProblem = new Error('parent rejected constrained intermediate')
    const onProblem = vi.fn()
    const rejectingChange = vi.fn(() => {
      throw parentProblem
    })
    const render = formModule.WorkflowTaskInputForm as unknown as (
      props: TaskInputFormProps
    ) => unknown
    const rejectedTree = render({
      aggregate: aggregate(),
      onChange: rejectingChange,
      onProblem
    })

    changeSelect(rejectedTree, 'short_code 输入状态', 'value')

    expect(rejectingChange).toHaveBeenCalledWith(
      'short_code',
      { kind: 'value', value: '' }
    )
    expect(onProblem).toHaveBeenCalledWith(parentProblem.message)
    expect(onProblem).not.toHaveBeenCalledWith(null)

    const acceptingChange = vi.fn()
    const acceptedTree = render({
      aggregate: aggregate(),
      onChange: acceptingChange,
      onProblem
    })
    changeSelect(acceptedTree, 'steps 输入状态', 'value')
    expect(acceptingChange).toHaveBeenCalledWith(
      'steps',
      { kind: 'value', value: [] }
    )
  })

  it('shows enum labels while emitting the numeric enum value', () => {
    expect(formModule.WorkflowTaskInputForm).toBeTypeOf('function')
    const descriptor = {
      name: 'selection',
      schema: {
        type: 'integer',
        enum: [1, 2],
        'x-unilabos-enum-labels': ['选项一', '选项二']
      },
      required: false,
      default: 1
    }
    const onChange = vi.fn()
    const render = formModule.WorkflowTaskInputForm as unknown as (
      props: TaskInputFormProps
    ) => unknown
    const tree = render({
      aggregate: aggregate(),
      form: {
        appliedRevision: 7,
        fields: [{ descriptor, state: { kind: 'value', value: 1 } }]
      },
      onChange
    })

    const markup = renderToStaticMarkup(tree as never)
    expect(markup).toContain('value="1"')
    expect(markup).toContain('选项一')
    expect(markup).toContain('选项二')

    expect(formModule.workflowEnumValue).toBeTypeOf('function')
    expect(formModule.workflowEnumValue!(descriptor.schema, '2')).toBe(2)
  })

  it('delegates panel submission races to the tested Task-input decision seam', () => {
    const panelSource = readFileSync(fileURLToPath(new URL(
      '../hooks/usePersistentWorkflowTaskPanel.ts',
      import.meta.url
    )), 'utf8')

    expect(panelSource).toMatch(/submitWorkflowTaskInput/)
  })
})

function aggregate(): WorkflowAuthoringAggregate {
  const graph = (parameters: unknown[]) => ({
    workflow: {
      meta_data: {
        unilab: {
          input_contract: { version: 1, parameters },
          output_contract: { version: 1, outputs: [] },
          output_bindings: {}
        }
      }
    },
    nodes: [],
    edges: [],
    node_templates: [],
    handle_templates: []
  })
  return {
    workflow_uuid: '10000000-0000-4000-8000-000000000001',
    workflow_revision: 7,
    state: 'unapplied_graph',
    applied_graph: graph([
      { name: 'count', schema: { type: 'integer' }, required: true },
      {
        name: 'short_code',
        schema: { type: 'string', minLength: 2 },
        required: true
      },
      {
        name: 'steps',
        schema: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1
        },
        required: true
      },
      {
        name: 'attempts',
        schema: { type: 'integer' },
        required: false,
        default: 3
      },
      {
        name: 'note',
        schema: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        required: false,
        default: null
      },
      { name: 'sample', schema: { $slot: 'ResourceSlot' }, required: true }
    ]),
    draft: null,
    applied_source: null,
    candidate: {
      candidate_hash: 'candidate-8',
      draft_hash: 'draft-8',
      base_workflow_revision: 7,
      graph: graph([
        { name: 'candidate_only', schema: { type: 'string' }, required: true }
      ]),
      normalized_python_source: '',
      source_map: [],
      diagnostics: [],
      changeset: {},
      compiler_version: 'test',
      template_catalog_fingerprint: 'catalog-1'
    }
  } as WorkflowAuthoringAggregate
}

function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function changeSelect(
  tree: unknown,
  ariaLabel: string,
  value: string
): void {
  const select = findElement(tree, (props) =>
    props['aria-label'] === ariaLabel
  )
  const onChange = select.onChange
  if (typeof onChange !== 'function') {
    throw new Error(`${ariaLabel} has no onChange callback`)
  }
  ;(onChange as (event: { target: { value: string } }) => void)({
    target: { value }
  })
}

function findElement(
  node: unknown,
  matches: (props: Record<string, unknown>) => boolean
): Record<string, unknown> {
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return findElement(child, matches)
      } catch {
        // Continue searching the remaining siblings.
      }
    }
    throw new Error('Expected React element was not rendered')
  }
  if (!node || typeof node !== 'object') {
    throw new Error('Expected React element was not rendered')
  }
  const props = (node as { props?: unknown }).props
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    throw new Error('Expected React element was not rendered')
  }
  const record = props as Record<string, unknown>
  if (matches(record)) return record
  return findElement(record.children, matches)
}
