import { describe, expect, it, vi } from 'vitest'

import { getDefaultBackend } from './backends'
import type { HttpClient } from './http'
import { createWorkflowRuntime } from './workflow'

const WORKFLOW_UUID = '11111111-1111-4111-8111-111111111111'
const RESOURCE_TEMPLATE_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const inputContract = {
  version: 1,
  parameters: [
    {
      name: 'sample_name',
      schema: { type: 'string' },
      required: true,
      title: 'Sample name',
      description: 'Stable sample identity'
    },
    {
      name: 'attempts',
      schema: { type: 'integer', minimum: 1 },
      required: false,
      default: 1,
      title: 'Attempts',
      description: 'Number of attempts'
    }
  ]
}

const outputContract = {
  version: 1,
  outputs: [
    {
      name: 'echo',
      schema: { type: 'string' },
      title: 'Echo',
      description: 'Echoed sample identity',
      implicit: false
    }
  ]
}

describe('Workflow I/O contract projection', () => {
  it('preserves ordered descriptors and stable binding identity', async () => {
    const runtime = runtimeFor(authoringAggregate())

    await expect(runtime.getWorkflowAuthoring(WORKFLOW_UUID)).resolves
      .toMatchObject({
        applied_graph: {
          workflow: {
            meta_data: {
              unilab: {
                input_contract: inputContract,
                output_contract: outputContract,
                output_bindings: {
                  echo: {
                    kind: 'workflow_input',
                    parameter: 'sample_name'
                  }
                }
              }
            }
          }
        }
      })
  })

  it.each([
    [
      'malformed contract envelope',
      { input_contract: { version: 1, parameters: {} } }
    ],
    [
      'unknown schema discriminator',
      {
        input_contract: {
          version: 1,
          parameters: [
            {
              name: 'sample_name',
              schema: { type: 'duration' },
              required: true
            }
          ]
        }
      }
    ],
    [
      'unknown output binding variant',
      {
        output_bindings: {
          echo: { kind: 'literal', value: 'sample-1' }
        }
      }
    ]
  ])('fails closed for %s', async (_label, invalidIo) => {
    const runtime = runtimeFor(authoringAggregate(invalidIo))

    await expect(runtime.getWorkflowAuthoring(WORKFLOW_UUID)).rejects
      .toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })

  it.each([
    [
      'string minimum',
      {
        name: 'review_minimum',
        schema: { type: 'number', minimum: '1' },
        required: true
      }
    ],
    [
      'minimum greater than maximum',
      {
        name: 'review_bounds',
        schema: { type: 'number', minimum: 2, maximum: 1 },
        required: true
      }
    ],
    [
      'wrong enum member family',
      {
        name: 'review_enum_family',
        schema: { type: 'integer', enum: [true] },
        required: true
      }
    ],
    [
      'duplicate enum member',
      {
        name: 'review_enum_duplicate',
        schema: { type: 'string', enum: ['safe', 'safe'] },
        required: true
      }
    ],
    [
      'default with the wrong type or declared constraint',
      {
        name: 'review_default',
        schema: { type: 'integer', minimum: 2 },
        required: false,
        default: true
      }
    ],
    [
      'invalid ResourceSlot allowlist UUID',
      {
        name: 'review_allowlist_uuid',
        schema: {
          $slot: 'ResourceSlot',
          allowed_resource_template_uuids: ['not-a-uuid']
        },
        required: true
      }
    ],
    [
      'duplicate canonical ResourceSlot allowlist UUID',
      {
        name: 'review_allowlist_duplicate',
        schema: {
          $slot: 'ResourceSlot',
          allowed_resource_template_uuids: [
            RESOURCE_TEMPLATE_UUID,
            RESOURCE_TEMPLATE_UUID
          ]
        },
        required: true
      }
    ]
  ])('rejects reviewer-blocking %s', async (_label, invalidParameter) => {
    const runtime = runtimeFor(authoringAggregate({
      input_contract: {
        version: 1,
        parameters: [inputContract.parameters[0], invalidParameter]
      }
    }))

    await expect(runtime.getWorkflowAuthoring(WORKFLOW_UUID)).rejects
      .toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })
})

function authoringAggregate(
  ioOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    workflow_uuid: WORKFLOW_UUID,
    workflow_revision: 7,
    state: 'applied',
    applied_graph: {
      workflow: {
        uuid: WORKFLOW_UUID,
        create_time: '2026-08-01T00:00:00Z',
        update_time: '2026-08-01T00:00:00Z',
        meta_data: {
          unilab: {
            input_contract: inputContract,
            output_contract: outputContract,
            output_bindings: {
              echo: {
                kind: 'workflow_input',
                parameter: 'sample_name'
              }
            },
            ...ioOverrides
          }
        },
        name: 'I1 Workflow I/O contract projection',
        tags: [],
        revision: 7,
        description: null
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

function runtimeFor(data: Record<string, unknown>) {
  return createWorkflowRuntime(
    mockHttp(vi.fn().mockResolvedValue({ code: 0, data })),
    getDefaultBackend('local-python')
  )
}

function mockHttp(request: ReturnType<typeof vi.fn>): HttpClient {
  return {
    request: async <ResponseValue>(
      path: string,
      init?: RequestInit
    ): Promise<ResponseValue> =>
      request(path, init) as Promise<ResponseValue>
  }
}
