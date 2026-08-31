import { describe, expect, it, vi } from 'vitest'

import { getDefaultBackend } from './backends'
import type { HttpClient } from './http'
import {
  createWorkflowRuntime,
  type WorkflowRevision
} from './workflow'

const revision: WorkflowRevision = {
  schema_version: '2',
  revision_id: 'rev-1',
  workflow_id: 'wf-1',
  invocations: [
    { node_id: 'branch', action_ref: 'os_control.branch', node_type: 'branch' },
    { node_id: 'yes', action_ref: 'pump-1.dose' },
    { node_id: 'no', action_ref: 'camera-1.inspect' }
  ],
  control_edges: [
    { source: 'branch', target: 'yes', branch: 'true' },
    { source: 'branch', target: 'no', branch: 'false' }
  ]
}

describe('workflow authoring adapters', () => {
  it('uses the OS authoring boundary for JSON and Python conversion', async () => {
    const candidate = {
      revision_id: 'authoring-code-1',
      parent_revision_id: 'rev-1',
      canonical_ir: revision,
      python_source: 'pump.dose(volume=5)',
      diagnostics: []
    }
    const request = vi.fn()
      .mockResolvedValueOnce({
        base_revision_id: 'rev-1',
        candidate,
        diagnostics: []
      })
      .mockResolvedValueOnce({
        base_revision_id: 'rev-1',
        candidate,
        diagnostics: []
      })
      .mockResolvedValueOnce({
        base_revision_id: 'rev-1',
        candidate,
        diagnostics: []
      })
    const runtime = createWorkflowRuntime(
      mockHttp(request),
      getDefaultBackend('local-python')
    )

    await runtime.generatePythonWorkflow(
      'rev-1',
      revision,
      'workflows/wf-1.py'
    )
    await runtime.compilePythonWorkflow(
      'rev-1',
      candidate.python_source,
      'workflows/wf-1.py'
    )
    await runtime.validateAuthoringCandidate('rev-1', candidate)

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/v1/authoring/generate-python',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          base_revision_id: 'rev-1',
          canonical_ir: revision,
          source_uri: 'workflows/wf-1.py'
        })
      })
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/v1/authoring/compile',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          base_revision_id: 'rev-1',
          python_source: candidate.python_source,
          source_uri: 'workflows/wf-1.py'
        })
      })
    )
    expect(request).toHaveBeenNthCalledWith(
      3,
      '/api/v1/authoring/validate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          base_revision_id: 'rev-1',
          candidate
        })
      })
    )
  })

  it('通过 OS 权威接口创建、删除并读取工作流修改日志', async () => {
    /** 依次模拟创建、日志与删除的统一响应外层。 */
    const workflowUuid = '10000000-0000-4000-8000-000000000001'
    const request = vi.fn()
      .mockResolvedValueOnce({
        code: 0,
        data: {
          uuid: workflowUuid,
          create_time: '2026-08-11T00:00:00Z',
          update_time: '2026-08-11T00:00:00Z',
          meta_data: {},
          name: '配液工作流',
          description: '自动配液',
          tags: ['S01'],
          revision: 1,
          definition_status: 'empty'
        }
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{
            sequence: 1,
            workflow_uuid: workflowUuid,
            revision: 1,
            action: 'created',
            summary: '创建工作流',
            details: {},
            create_time: '2026-08-11T00:00:00Z'
          }],
          total: 1,
          page: 1,
          page_size: 100
        }
      })
      .mockResolvedValueOnce({ code: 0 })
    const runtime = createWorkflowRuntime(
      mockHttp(request),
      getDefaultBackend('local-python')
    )

    await runtime.createWorkflowDefinition({
      name: '配液工作流',
      description: '自动配液',
      tags: ['S01']
    })
    await runtime.listWorkflowDefinitionChanges(workflowUuid)
    await runtime.deleteWorkflowDefinition(workflowUuid)

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/v1/workflows',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: '配液工作流',
          description: '自动配液',
          tags: ['S01'],
          meta_data: {}
        })
      })
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/api/v1/workflows/${workflowUuid}/change-log?page=1&page_size=100`,
      undefined
    )
    expect(request).toHaveBeenNthCalledWith(
      3,
      `/api/v1/workflows/${workflowUuid}`,
      { method: 'DELETE' }
    )
  })

  it('通过正式 OS 事务创建实验操作定义和 Python 源码', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      code: 0,
      data: {
        uuid: '20000000-0000-4000-8000-000000000001',
        create_time: '2026-08-29T00:00:00Z',
        update_time: '2026-08-29T00:00:00Z',
        meta_data: {
          unilab: {
            definition_kind: 'operation',
            operation: { category: '样品前处理' }
          }
        },
        name: '称量并投料',
        description: '称量固体并加入目标容器。',
        tags: ['样品前处理'],
        revision: 2
      }
    })
    const runtime = createWorkflowRuntime(
      mockHttp(request),
      getDefaultBackend('local-python')
    )

    const created = await runtime.createExperimentOperation({
      name: '称量并投料',
      categories: ['样品前处理', '固体处理'],
      description: '称量固体并加入目标容器。'
    })

    expect(created.meta_data).toMatchObject({
      unilab: { definition_kind: 'operation' }
    })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/workflows/operations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: '称量并投料',
          categories: ['样品前处理', '固体处理'],
          description: '称量固体并加入目标容器。'
        })
      })
    )
  })
})

function mockHttp(
  request: ReturnType<typeof vi.fn>
): HttpClient {
  return {
    request: async <ResponseValue>(
      path: string,
      init?: RequestInit
    ): Promise<ResponseValue> =>
      request(path, init) as Promise<ResponseValue>
  }
}
