import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from './http'
import { loadBackendWorkflowPage } from './backendWorkflowCatalog'
import { getDefaultBackend } from './backends'
import { createWorkflowRuntime } from './workflow'

describe('Backend 工作流目录 adapter', () => {
  /** 验证 Backend 页码目录会完整遍历后投影为前端编号分页。 */
  it('遍历 Backend 页码后投影为前端编号分页', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [rawWorkflow('workflow-1', '配液')],
          has_more: true,
          page: 1,
          page_size: 100
        }
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [rawWorkflow('workflow-2', '清洗')],
          has_more: false,
          page: 2,
          page_size: 100
        }
      })

    await expect(loadBackendWorkflowPage(
      mockHttp(request),
      { page: 2, page_size: 1 }
    )).resolves.toEqual({
      items: [{
        uuid: 'workflow-2',
        create_time: '2026-08-01T00:00:00Z',
        update_time: '2026-08-02T00:00:00Z',
        meta_data: {},
        name: '清洗',
        tags: ['S02'],
        revision: 3
      }],
      total: 2,
      page: 2,
      page_size: 1
    })
    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/v1/workflows?page=1&page_size=100',
      undefined
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/v1/workflows?page=2&page_size=100',
      undefined
    )
  })

  /** 验证 Backend 工作流目录页码漂移时关闭失败。 */
  it('拒绝未推进的 Backend 工作流页码', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        items: [],
        has_more: true,
        page: 2,
        page_size: 100
      }
    })

    await expect(
      loadBackendWorkflowPage(mockHttp(request))
    ).rejects.toMatchObject({
      code: 'INVALID_BACKEND_WORKFLOW_CATALOG'
    })
  })

  /** Backend 隔离源码创作与未对齐事件流，同时开放画布和任务运行。 */
  it('在 Backend 模式关闭源码创作与事件订阅，但开放任务运行', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        uuid: '20000000-0000-4000-8000-000000000001',
        workflow_uuid: '10000000-0000-4000-8000-000000000001',
        status: 'pending'
      }
    })
    const runtime = createWorkflowRuntime(
      mockHttp(request),
      getDefaultBackend('local-go')
    )

    await expect(runtime.getWorkflowAuthoring(
      '10000000-0000-4000-8000-000000000001'
    )).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
      capability: 'workflow.authoring'
    })
    await expect(runtime.createWorkflowTask({
      workflow_uuid: '10000000-0000-4000-8000-000000000001',
      input: {}
    })).resolves.toMatchObject({ status: 'pending' })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/workflow-tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          workflow_uuid: '10000000-0000-4000-8000-000000000001',
          inventory_bindings: []
        })
      })
    )
    let subscriptionError: unknown
    try {
      runtime.subscribeWorkflowRuntime(() => undefined)
    } catch (error) {
      subscriptionError = error
    }
    expect(subscriptionError).toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
      capability: 'workflow.subscribeEvents'
    })
    runtime.dispose()
  })
})

/** 返回一条 Backend Workflow 摘要测试记录。 */
function rawWorkflow(uuid: string, name: string): Record<string, unknown> {
  return {
    uuid,
    create_time: '2026-08-01T00:00:00Z',
    update_time: '2026-08-02T00:00:00Z',
    meta_data: {},
    name,
    tags: ['S02'],
    revision: 3
  }
}

/** 创建只实现 request 的 Backend 工作流 HTTP 测试替身。 */
function mockHttp(request: ReturnType<typeof vi.fn>): HttpClient {
  return { request }
}
