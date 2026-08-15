import type {
  WorkflowAuthoringAggregate,
  WorkflowInputDescriptor
} from '@unilab/services'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

type FieldState =
  | { kind: 'untouched' }
  | { kind: 'explicit_null' }
  | { kind: 'value'; value: unknown }

interface InputForm {
  workflowUuid: string
  appliedRevision: number
  fields: Array<{ descriptor: WorkflowInputDescriptor; state: FieldState }>
}

interface ResourceSlotOption {
  materialUuid: string
  resourceTemplateUuid: string
  displayLabel: string
}

type OptionsState =
  | { kind: 'ready'; options: readonly ResourceSlotOption[] }
  | { kind: 'unavailable' | 'error'; options: []; message: string }

interface Props {
  aggregate: WorkflowAuthoringAggregate
  form?: InputForm
  resourceSlotOptions?: OptionsState
  onChange: (name: string, state: FieldState) => void
  onProblem?: (message: string | null) => void
}

const modulePath = './WorkflowTaskInputForm'
const formModule = await import(/* @vite-ignore */ modulePath)
  .catch(() => ({})) as {
    WorkflowTaskInputForm?: ComponentType<Props>
  }

const TEMPLATE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TEMPLATE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MATERIAL_A1 = '11111111-1111-4111-8111-111111111111'
const MATERIAL_A2 = '33333333-3333-4333-8333-333333333333'
const MATERIAL_B1 = '22222222-2222-4222-8222-222222222222'

const options: readonly ResourceSlotOption[] = [
  {
    materialUuid: MATERIAL_A1,
    resourceTemplateUuid: TEMPLATE_A,
    displayLabel: 'Sample A1'
  },
  {
    materialUuid: MATERIAL_B1,
    resourceTemplateUuid: TEMPLATE_B,
    displayLabel: 'Sample B1'
  },
  {
    materialUuid: MATERIAL_A2,
    resourceTemplateUuid: TEMPLATE_A,
    displayLabel: 'Sample A2'
  }
]

describe('Workflow ResourceSlot Task controls', () => {
  it('filters a single selector by allowlist and emits only closed uuid', () => {
    expect(formModule.WorkflowTaskInputForm).toBeTypeOf('function')
    const onChange = vi.fn()
    const tree = renderForm({
      aggregate: aggregate(singleParameters()),
      resourceSlotOptions: { kind: 'ready', options },
      onChange
    })
    const selector = findByLabel(tree, 'sample 资源位')

    expect(optionValues(selector)).toEqual(['', MATERIAL_A1, MATERIAL_A2])
    expect(visibleText(selector.children)).toContain('Sample A1')
    expect(visibleText(selector.children)).toContain('Sample A2')
    expect(visibleText(selector.children)).not.toContain('Sample B1')
    change(selector, MATERIAL_A1)
    expect(onChange).toHaveBeenCalledWith('sample', {
      kind: 'value',
      value: { uuid: MATERIAL_A1 }
    })
  })

  it('keeps nullable ResourceSlot explicit-null available', () => {
    expect(formModule.WorkflowTaskInputForm).toBeTypeOf('function')
    const onChange = vi.fn()
    const tree = renderForm({
      aggregate: aggregate(singleParameters()),
      resourceSlotOptions: { kind: 'ready', options },
      onChange
    })
    const state = findByLabel(tree, 'optional_sample 输入状态')

    expect(state.disabled).not.toBe(true)
    change(state, 'explicit_null')
    expect(onChange).toHaveBeenCalledWith('optional_sample', {
      kind: 'explicit_null'
    })
  })

  it('preserves duplicate list order and exposes add/remove/reorder controls', () => {
    expect(formModule.WorkflowTaskInputForm).toBeTypeOf('function')
    const descriptor = listParameter()
    const onChange = vi.fn()
    const form: InputForm = {
      workflowUuid: '10000000-0000-4000-8000-000000000001',
      appliedRevision: 7,
      fields: [{
        descriptor,
        state: {
          kind: 'value',
          value: [
            { uuid: MATERIAL_A2 },
            { uuid: MATERIAL_A1 },
            { uuid: MATERIAL_A2 }
          ]
        }
      }]
    }
    const tree = renderForm({
      aggregate: aggregate([descriptor]),
      form,
      resourceSlotOptions: { kind: 'ready', options },
      onChange
    })

    expect([
      findByLabel(tree, 'samples 资源位 1').value,
      findByLabel(tree, 'samples 资源位 2').value,
      findByLabel(tree, 'samples 资源位 3').value
    ]).toEqual([MATERIAL_A2, MATERIAL_A1, MATERIAL_A2])
    expect(findByLabel(tree, 'samples 添加资源位')).toBeDefined()
    click(findByLabel(tree, 'samples 上移 2'))
    expect(onChange).toHaveBeenLastCalledWith('samples', {
      kind: 'value',
      value: [
        { uuid: MATERIAL_A1 },
        { uuid: MATERIAL_A2 },
        { uuid: MATERIAL_A2 }
      ]
    })
    click(findByLabel(tree, 'samples 删除 2'))
    expect(onChange).toHaveBeenLastCalledWith('samples', {
      kind: 'value',
      value: [{ uuid: MATERIAL_A2 }, { uuid: MATERIAL_A2 }]
    })
  })

  it.each([
    {
      name: 'missing port',
      optionsState: undefined,
      message: /未注入|不可用|unavailable/i
    },
    {
      name: 'read failure',
      optionsState: {
        kind: 'error' as const,
        options: [] as [],
        message: 'Material options 读取失败，请重试'
      },
      message: /读取失败.*重试/i
    },
    {
      name: 'no compatible material',
      optionsState: { kind: 'ready' as const, options: [options[1]!] },
      message: /没有.*兼容|无 compatible/i
    }
  ])('fails closed with actionable text for $name', ({
    optionsState,
    message
  }) => {
    expect(formModule.WorkflowTaskInputForm).toBeTypeOf('function')
    const markup = renderToStaticMarkup(createElement(
      formModule.WorkflowTaskInputForm!,
      {
        aggregate: aggregate(singleParameters()),
        resourceSlotOptions: optionsState,
        onChange: vi.fn()
      }
    ))

    expect(visibleText(markup)).toMatch(message)
    expect(markup).toMatch(/disabled=""|aria-disabled="true"/i)
  })
})

function singleParameters(): WorkflowInputDescriptor[] {
  return [
    {
      name: 'sample',
      schema: {
        $slot: 'ResourceSlot',
        allowed_resource_template_uuids: [TEMPLATE_A]
      },
      required: true
    },
    {
      name: 'optional_sample',
      schema: {
        anyOf: [
          {
            $slot: 'ResourceSlot',
            allowed_resource_template_uuids: [TEMPLATE_A]
          },
          { type: 'null' }
        ]
      },
      required: false,
      default: null
    }
  ]
}

function listParameter(): WorkflowInputDescriptor {
  return {
    name: 'samples',
    schema: {
      type: 'array',
      items: {
        $slot: 'ResourceSlot',
        allowed_resource_template_uuids: [TEMPLATE_A]
      }
    },
    required: true
  }
}

function aggregate(
  parameters: WorkflowInputDescriptor[]
): WorkflowAuthoringAggregate {
  return {
    workflow_uuid: '10000000-0000-4000-8000-000000000001',
    workflow_revision: 7,
    state: 'applied',
    applied_graph: {
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
    },
    draft: null,
    candidate: null,
    applied_source: null,
    topology_authoring: {
      authority: 'python_source',
      graph_mode: 'read_write',
      graph_to_python: 'supported'
    }
  }
}

function renderForm(props: Props): unknown {
  const render = formModule.WorkflowTaskInputForm as unknown as (
    input: Props
  ) => unknown
  return render(props)
}

function findByLabel(tree: unknown, ariaLabel: string): Record<string, unknown> {
  return findElement(tree, (props) => props['aria-label'] === ariaLabel)
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
        // Continue searching siblings.
      }
    }
    throw new Error('Expected accessible control was not rendered')
  }
  if (!node || typeof node !== 'object') {
    throw new Error('Expected accessible control was not rendered')
  }
  const props = (node as { props?: unknown }).props
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    throw new Error('Expected accessible control was not rendered')
  }
  const record = props as Record<string, unknown>
  if (matches(record)) return record
  return findElement(record.children, matches)
}

function optionValues(select: Record<string, unknown>): unknown[] {
  return collectElements(select.children, (props) => props.value !== undefined)
    .map((props) => props.value)
}

function collectElements(
  node: unknown,
  matches: (props: Record<string, unknown>) => boolean
): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((child) =>
    collectElements(child, matches)
  )
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: unknown }).props
  if (!props || typeof props !== 'object' || Array.isArray(props)) return []
  const record = props as Record<string, unknown>
  return [
    ...(matches(record) ? [record] : []),
    ...collectElements(record.children, matches)
  ]
}

function change(control: Record<string, unknown>, value: string): void {
  const onChange = control.onChange
  if (typeof onChange !== 'function') throw new Error('Control has no onChange')
  ;(onChange as (event: { target: { value: string } }) => void)({
    target: { value }
  })
}

function click(control: Record<string, unknown>): void {
  const onClick = control.onClick
  if (typeof onClick !== 'function') throw new Error('Control has no onClick')
  ;(onClick as () => void)()
}

function visibleText(value: unknown): string {
  if (typeof value === 'string') {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  return collectText(value).join(' ').replace(/\s+/g, ' ').trim()
}

function collectText(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(collectText)
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  return collectText(props?.children)
}
