import { describe, expect, it } from 'vitest'
import type { WorkflowInputParameter } from '../../domain/workflow-definition/model'
import { normalizeWorkflowInput, workflowInputDefaults } from './input'

const parameters: readonly WorkflowInputParameter[] = [
  {
    name: 'resource',
    required: true,
    schema: { $slot: 'ResourceSlot' },
  },
  {
    name: 'enabled',
    required: false,
    defaultValue: true,
    schema: { type: 'boolean' },
  },
  {
    name: 'options',
    required: false,
    schema: { type: 'object' },
  },
]

describe('run preparation input projection', () => {
  it('projects declared defaults into form values', () => {
    expect(workflowInputDefaults(parameters)).toEqual({ enabled: true })
  })

  it('normalizes resource slots and JSON fields', () => {
    expect(
      normalizeWorkflowInput(
        {
          workflowInput: {
            resource: 'material-1',
            enabled: false,
            options: '{\"mode\":\"safe\"}',
          },
        },
        parameters,
      ),
    ).toEqual({
      resource: { uuid: 'material-1' },
      enabled: false,
      options: { mode: 'safe' },
    })
  })

  it('rejects malformed JSON with the parameter label', () => {
    expect(() => normalizeWorkflowInput({ options: '{' }, parameters)).toThrow(
      '参数“options”必须是合法 JSON',
    )
  })
})
