import type {
  WorkflowAuthoringAggregate,
  WorkflowInputDescriptor,
  WorkflowTask
} from '@unilab/services'
import { describe, expect, it, vi } from 'vitest'

type FieldState =
  | { kind: 'untouched' }
  | { kind: 'explicit_null' }
  | { kind: 'value'; value: unknown }

interface InputForm {
  appliedRevision: number
  fields: Array<{ descriptor: WorkflowInputDescriptor; state: FieldState }>
}

interface InputFormModule {
  createWorkflowTaskInputForm(
    aggregate: WorkflowAuthoringAggregate
  ): InputForm
  setWorkflowTaskInputField(
    form: InputForm,
    name: string,
    state: FieldState
  ): InputForm
  buildWorkflowTaskInput(form: InputForm): Record<string, unknown>
  submitWorkflowTaskInput(options: {
    form: InputForm
    readApplied: () => Promise<WorkflowAuthoringAggregate>
    createTask: (input: Record<string, unknown>) => Promise<WorkflowTask>
  }): Promise<
    | {
        kind: 'reproject_before_create'
        form: InputForm
        message: string
      }
    | {
        kind: 'created'
        task: WorkflowTask
        message: string
      }
    | {
        kind: 'reproject_after_create'
        task: WorkflowTask
        form: InputForm
        message: string
      }
  >
}

const modulePath = './workflowTaskInputForm'
const formModule = await import(/* @vite-ignore */ modulePath)
  .catch(() => ({})) as Partial<InputFormModule>

describe('WorkflowTaskInputForm pure builder', () => {
  it('projects the ordered Applied contract and never the Candidate contract', () => {
    expect(formModule.createWorkflowTaskInputForm).toBeTypeOf('function')
    const form = formModule.createWorkflowTaskInputForm!(aggregate())

    expect(form.appliedRevision).toBe(7)
    expect(form.fields.map(({ descriptor }) => descriptor.name)).toEqual([
      'count', 'enabled', 'label', 'tags', 'config', 'note', 'attempts'
    ])
    expect(form.fields.map(({ state }) => state.kind)).toEqual(
      Array(7).fill('untouched')
    )
    expect(form.fields.map(({ descriptor }) => descriptor.name))
      .not.toContain('candidate_only')
  })

  it('omits untouched optional/default values and rejects a missing required value', () => {
    expect(formModule.createWorkflowTaskInputForm).toBeTypeOf('function')
    expect(formModule.buildWorkflowTaskInput).toBeTypeOf('function')
    const form = formModule.createWorkflowTaskInputForm!(aggregate())

    expect(() => formModule.buildWorkflowTaskInput!(form))
      .toThrow(/count|required|必填/i)

    const complete = requiredValues(form)
    expect(formModule.buildWorkflowTaskInput!(complete)).toEqual({
      count: 0,
      enabled: false,
      label: '',
      tags: [],
      config: {}
    })
    expect(formModule.buildWorkflowTaskInput!(complete)).not.toHaveProperty('note')
    expect(formModule.buildWorkflowTaskInput!(complete)).not.toHaveProperty('attempts')
  })

  it('retains explicit null and every explicit falsy JSON value', () => {
    expect(formModule.createWorkflowTaskInputForm).toBeTypeOf('function')
    expect(formModule.setWorkflowTaskInputField).toBeTypeOf('function')
    expect(formModule.buildWorkflowTaskInput).toBeTypeOf('function')
    let form = requiredValues(formModule.createWorkflowTaskInputForm!(aggregate()))
    form = formModule.setWorkflowTaskInputField!(
      form,
      'note',
      { kind: 'explicit_null' }
    )

    expect(formModule.buildWorkflowTaskInput!(form)).toEqual({
      count: 0,
      enabled: false,
      label: '',
      tags: [],
      config: {},
      note: null
    })
  })

  it('rejects string coercion for integer and boolean controls', () => {
    expect(formModule.createWorkflowTaskInputForm).toBeTypeOf('function')
    expect(formModule.setWorkflowTaskInputField).toBeTypeOf('function')
    const form = formModule.createWorkflowTaskInputForm!(aggregate())

    expect(() => formModule.setWorkflowTaskInputField!(
      form,
      'count',
      { kind: 'value', value: '0' }
    )).toThrow(/integer|number|类型/i)
    expect(() => formModule.setWorkflowTaskInputField!(
      form,
      'enabled',
      { kind: 'value', value: 'false' }
    )).toThrow(/boolean|类型/i)
  })

  it('accepts structurally typed constrained intermediates but rejects them at build', () => {
    expect(formModule.createWorkflowTaskInputForm).toBeTypeOf('function')
    expect(formModule.setWorkflowTaskInputField).toBeTypeOf('function')
    expect(formModule.buildWorkflowTaskInput).toBeTypeOf('function')
    let form = formModule.createWorkflowTaskInputForm!(aggregate({
      parameters: [
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
        }
      ]
    }))

    expect(() => {
      form = formModule.setWorkflowTaskInputField!(
        form,
        'short_code',
        { kind: 'value', value: '' }
      )
      form = formModule.setWorkflowTaskInputField!(
        form,
        'steps',
        { kind: 'value', value: [] }
      )
    }).not.toThrow()
    expect(form.fields.map(({ state }) => state)).toEqual([
      { kind: 'value', value: '' },
      { kind: 'value', value: [] }
    ])
    expect(() => formModule.buildWorkflowTaskInput!(form))
      .toThrow(/short_code.*最短长度|最短长度.*short_code/i)

    form = formModule.setWorkflowTaskInputField!(
      form,
      'short_code',
      { kind: 'value', value: 'ok' }
    )
    expect(() => formModule.buildWorkflowTaskInput!(form))
      .toThrow(/steps.*最少项目数|最少项目数.*steps/i)
    form = formModule.setWorkflowTaskInputField!(
      form,
      'steps',
      { kind: 'value', value: ['mix'] }
    )
    expect(formModule.buildWorkflowTaskInput!(form)).toEqual({
      short_code: 'ok',
      steps: ['mix']
    })
  })

  it('reprojects a changed Applied contract before create and performs no POST', async () => {
    expect(formModule.submitWorkflowTaskInput).toBeTypeOf('function')
    const submitted = requiredValues(
      formModule.createWorkflowTaskInputForm!(aggregate())
    )
    const latest = aggregate({ revision: 8 })
    const createTask = vi.fn(async () => workflowTask(8))

    const result = await formModule.submitWorkflowTaskInput!({
      form: submitted,
      readApplied: vi.fn(async () => latest),
      createTask
    })

    expect(createTask).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      kind: 'reproject_before_create',
      form: { appliedRevision: 8 },
      message: expect.stringMatching(/7[\s\S]*8|revision.*更新/i)
    })
    if (result.kind !== 'reproject_before_create') {
      throw new Error(`Expected pre-create reproject, received ${result.kind}`)
    }
    expect(result.form.fields.every(({ state }) => state.kind === 'untouched'))
      .toBe(true)
  })

  it('rehydrates authority and reprojects after a created Task snapshot race', async () => {
    expect(formModule.submitWorkflowTaskInput).toBeTypeOf('function')
    const submitted = requiredValues(
      formModule.createWorkflowTaskInputForm!(aggregate())
    )
    const beforeCreate = aggregate({ revision: 7 })
    const afterCreate = aggregate({ revision: 9 })
    const readApplied = vi.fn()
      .mockResolvedValueOnce(beforeCreate)
      .mockResolvedValueOnce(afterCreate)
    const created = workflowTask(8)
    const createTask = vi.fn(async () => created)

    const result = await formModule.submitWorkflowTaskInput!({
      form: submitted,
      readApplied,
      createTask
    })

    expect(createTask).toHaveBeenCalledOnce()
    expect(readApplied).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      kind: 'reproject_after_create',
      task: created,
      form: { appliedRevision: 9 },
      message: expect.stringMatching(/任务.*已创建[\s\S]*8[\s\S]*9/i)
    })
    if (result.kind !== 'reproject_after_create') {
      throw new Error(`Expected post-create reproject, received ${result.kind}`)
    }
    expect(result.form.fields.every(({ state }) => state.kind === 'untouched'))
      .toBe(true)
  })

  it('builds closed single/nullable/list ResourceSlot values without identity leakage', () => {
    expect(formModule.createWorkflowTaskInputForm).toBeTypeOf('function')
    expect(formModule.setWorkflowTaskInputField).toBeTypeOf('function')
    expect(formModule.buildWorkflowTaskInput).toBeTypeOf('function')
    let form = formModule.createWorkflowTaskInputForm!(aggregate({
      parameters: [
        {
          name: 'sample',
          schema: {
            $slot: 'ResourceSlot',
            allowed_resource_template_uuids: [
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            ]
          },
          required: true
        },
        {
          name: 'optional_sample',
          schema: {
            anyOf: [
              { $slot: 'ResourceSlot' },
              { type: 'null' }
            ]
          },
          required: false,
          default: null
        },
        {
          name: 'samples',
          schema: {
            type: 'array',
            items: { $slot: 'ResourceSlot' }
          },
          required: true
        }
      ]
    }))
    const first = '11111111-1111-4111-8111-111111111111'
    const second = '33333333-3333-4333-8333-333333333333'
    form = formModule.setWorkflowTaskInputField!(form, 'sample', {
      kind: 'value',
      value: { uuid: first }
    })
    form = formModule.setWorkflowTaskInputField!(form, 'optional_sample', {
      kind: 'explicit_null'
    })
    form = formModule.setWorkflowTaskInputField!(form, 'samples', {
      kind: 'value',
      value: [{ uuid: second }, { uuid: first }, { uuid: second }]
    })

    expect(formModule.buildWorkflowTaskInput!(form)).toEqual({
      sample: { uuid: first },
      optional_sample: null,
      samples: [{ uuid: second }, { uuid: first }, { uuid: second }]
    })
    expect(JSON.stringify(formModule.buildWorkflowTaskInput!(form)))
      .not.toMatch(/resource_template|display|label|tree|index/i)
  })

  it('rejects open or malformed ResourceSlot selector values', () => {
    expect(formModule.createWorkflowTaskInputForm).toBeTypeOf('function')
    expect(formModule.setWorkflowTaskInputField).toBeTypeOf('function')
    const createForm = (): InputForm =>
      formModule.createWorkflowTaskInputForm!(aggregate({
        parameters: [{
          name: 'sample',
          schema: { $slot: 'ResourceSlot' },
          required: true
        }]
      }))
    const uuid = '11111111-1111-4111-8111-111111111111'

    for (const value of [
      uuid,
      {},
      { uuid, resource_template_uuid: 'leak' },
      { uuid, displayLabel: 'leak' },
      { uuid, index: 0 }
    ]) {
      expect(() => formModule.setWorkflowTaskInputField!(
        createForm(),
        'sample',
        { kind: 'value', value }
      )).toThrow(/ResourceSlot|uuid|closed|字段/i)
    }
  })
})

function requiredValues(initial: InputForm): InputForm {
  let form = initial
  for (const [name, value] of [
    ['count', 0],
    ['enabled', false],
    ['label', ''],
    ['tags', []],
    ['config', {}]
  ] as const) {
    form = formModule.setWorkflowTaskInputField!(
      form,
      name,
      { kind: 'value', value }
    )
  }
  return form
}

function aggregate(options: {
  revision?: number
  parameters?: WorkflowInputDescriptor[]
} = {}): WorkflowAuthoringAggregate {
  const parameters: WorkflowInputDescriptor[] = options.parameters ?? [
    { name: 'count', schema: { type: 'integer' }, required: true },
    { name: 'enabled', schema: { type: 'boolean' }, required: true },
    { name: 'label', schema: { type: 'string' }, required: true },
    {
      name: 'tags',
      schema: { type: 'array', items: { type: 'string' } },
      required: true
    },
    { name: 'config', schema: { type: 'object' }, required: true },
    {
      name: 'note',
      schema: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      required: false,
      default: null
    },
    {
      name: 'attempts',
      schema: { type: 'integer' },
      required: false,
      default: 3
    }
  ]
  const appliedGraph = graph(parameters)
  return {
    workflow_uuid: '10000000-0000-4000-8000-000000000001',
    workflow_revision: options.revision ?? 7,
    state: 'unapplied_graph',
    applied_graph: appliedGraph,
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
  }
}

function workflowTask(snapshotRevision: number): WorkflowTask {
  return {
    uuid: '30000000-0000-4000-8000-000000000001',
    create_time: '2026-08-02T00:00:00Z',
    update_time: '2026-08-02T00:00:00Z',
    meta_data: {},
    workflow_uuid: '10000000-0000-4000-8000-000000000001',
    status: 'pending',
    workflow_snapshot: {
      workflow: { revision: snapshotRevision }
    },
    execution_plan: {},
    run_mode: 'normal',
    control_status: 'active',
    cleanup_status: 'none',
    trace_context: {},
    input: {},
    output: {},
    error_info: []
  }
}

function graph(parameters: WorkflowInputDescriptor[]) {
  return {
    workflow: {
      meta_data: {
        unilab: {
          input_contract: { version: 1 as const, parameters },
          output_contract: { version: 1 as const, outputs: [] },
          output_bindings: {}
        }
      }
    },
    nodes: [],
    edges: [],
    node_templates: [],
    handle_templates: []
  }
}
