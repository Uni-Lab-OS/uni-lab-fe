import { describe, expect, it, vi } from 'vitest'

import { getDefaultBackend } from './backends'
import type { HttpClient } from './http'
import { createWorkflowRuntime } from './workflow'

describe('workflow catalog port', () => {
  it('lists the workflows exposed by the current OS backend', async () => {
    const rawPage = {
      items: [{
        uuid: '335da2e9-024b-562f-8bf8-35dba0b52a90',
        name: '堆栈、S05 与 S06 联调',
        revision: 1,
        tags: ['package', 'szlab_poly_studio'],
        meta_data: { package_fqid: 'community.szlab.workflow' },
        create_time: '2026-08-02T08:10:22Z',
        update_time: '2026-08-02T08:10:22Z'
      }],
      has_more: false,
      page: 1,
      page_size: 100
    }
    const request = vi.fn().mockResolvedValue({ code: 0, data: rawPage })
    const runtime = createWorkflowRuntime(
      mockHttp(request),
      getDefaultBackend('local-python')
    )

    await expect(runtime.listWorkflows({
      page: 1,
      page_size: 100
    })).resolves.toEqual({
      items: rawPage.items,
      total: 1,
      page: 1,
      page_size: 100
    })

    expect(request).toHaveBeenCalledWith(
      '/api/v1/workflows?page=1&page_size=100',
      undefined
    )
  })
})

function mockHttp(request: ReturnType<typeof vi.fn>): HttpClient {
  return {
    request: async <ResponseValue>(
      path: string,
      init?: RequestInit
    ): Promise<ResponseValue> =>
      request(path, init) as Promise<ResponseValue>
  }
}
