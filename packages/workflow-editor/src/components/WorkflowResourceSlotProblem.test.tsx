import type { WorkflowAuthoringAggregate } from '@unilab/services'
import { ServiceError } from '@unilab/services'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { createWorkflowTaskInputForm } from '../utils/workflowTaskInputForm'
import { WorkflowTaskInputForm } from './WorkflowTaskInputForm'

interface ProblemModule {
  workflowTaskInputProblem(
    error: unknown,
    form: ReturnType<typeof createWorkflowTaskInputForm>
  ): string
}

const modulePath = '../utils/workflowTaskInputProblem'
const problemModule = await import(/* @vite-ignore */ modulePath)
  .catch(() => ({})) as Partial<ProblemModule>

describe('Workflow ResourceSlot Task rejection feedback', () => {
  it.each([
    {
      status: 400,
      code: 'invalid_input',
      backendMessage: 'Material template is not allowed by ResourceSlot',
      expected: /输入不被 OS 接受.*检查.*重试/i
    },
    {
      status: 404,
      code: 'not_found',
      backendMessage: 'material not found',
      expected: /Workflow.*Material.*数据.*刷新.*重试/i
    },
    {
      status: 409,
      code: 'conflict',
      backendMessage: 'Material is not runnable',
      expected: /权威状态.*冲突.*刷新.*重试/i
    }
  ])('maps HTTP $status to an actionable form-level alert', ({
    status,
    code,
    backendMessage,
    expected
  }) => {
    expect(problemModule.workflowTaskInputProblem).toBeTypeOf('function')
    const problem = problemModule.workflowTaskInputProblem!(
      new ServiceError({
        status,
        code,
        message: backendMessage,
        retryable: false
      }),
      createWorkflowTaskInputForm(resourceSlotAggregate())
    )
    const markup = renderToStaticMarkup(createElement(
      WorkflowTaskInputForm,
      {
        aggregate: resourceSlotAggregate(),
        problem,
        onChange: vi.fn()
      }
    ))

    expect(problem).toMatch(expected)
    expect(problem).toContain(`OS ${status} ${code}：${backendMessage}`)
    expect(problem).not.toMatch(/已删除|已不存在|已占用|类型不兼容/)
    expect(markup).toMatch(/role="alert"/)
    expect(visibleText(markup)).toMatch(expected)
  })

  it.each([
    {
      status: 404,
      code: 'workflow_not_found',
      backendMessage: '工作流不存在或已被删除',
      aggregate: resourceSlotAggregate()
    },
    {
      status: 409,
      code: 'HTTP_REQUEST_FAILED',
      backendMessage: 'upstream request failed',
      aggregate: resourceSlotAggregate()
    },
    {
      status: 400,
      code: 'validation_error',
      backendMessage: 'request validation failed',
      aggregate: resourceSlotAggregate()
    },
    {
      status: 404,
      code: 'not_found',
      backendMessage: 'request target not found',
      aggregate: scalarAggregate()
    },
    {
      status: 409,
      code: 'conflict',
      backendMessage: 'request state conflict',
      aggregate: scalarAggregate()
    }
  ])('keeps non-Material $status/$code diagnostics generic', ({
    status,
    code,
    backendMessage,
    aggregate
  }) => {
    expect(problemModule.workflowTaskInputProblem).toBeTypeOf('function')
    const problem = problemModule.workflowTaskInputProblem!(
      new ServiceError({
        status,
        code,
        message: backendMessage,
        retryable: false
      }),
      createWorkflowTaskInputForm(aggregate)
    )

    expect(problem).toBe(`OS ${status} ${code}：${backendMessage}`)
    expect(problem).not.toMatch(
      /Material 已不存在|Material 当前不可用|已占用|ResourceSlot 类型不兼容/
    )
  })
})

function resourceSlotAggregate(): WorkflowAuthoringAggregate {
  return {
    workflow_uuid: '10000000-0000-4000-8000-000000000005',
    workflow_revision: 1,
    state: 'applied',
    applied_graph: {
      workflow: {
        meta_data: {
          unilab: {
            input_contract: {
              version: 1,
              parameters: [{
                name: 'sample',
                schema: { $slot: 'ResourceSlot' },
                required: true
              }]
            },
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

function scalarAggregate(): WorkflowAuthoringAggregate {
  const value = resourceSlotAggregate()
  value.applied_graph.workflow.meta_data = {
    unilab: {
      input_contract: {
        version: 1,
        parameters: [{
          name: 'label',
          schema: { type: 'string' },
          required: true
        }]
      },
      output_contract: { version: 1, outputs: [] },
      output_bindings: {}
    }
  }
  return value
}

function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
