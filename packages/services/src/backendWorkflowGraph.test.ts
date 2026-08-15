import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from './http'
import {
  loadBackendEditableWorkflowGraph,
  saveBackendEditableWorkflowGraph,
  type BackendWorkflowGraph
} from './backendWorkflowGraph'

const WORKFLOW_UUID = '50000000-0000-4000-8000-000000000001'
const NODE_UUID = '60000000-0000-4000-8000-000000000001'

describe('Backend editable workflow graph adapter', () => {
  /** Backend 画布以 graph revision 为 CAS 基线读取完整定义。 */
  it('loads the authoritative graph without projecting workspace code', async () => {
    const request = vi.fn().mockResolvedValue({ code: 0, data: graph(3) })

    await expect(loadBackendEditableWorkflowGraph(
      mockHttp(request),
      WORKFLOW_UUID
    )).resolves.toMatchObject({ workflow: { uuid: WORKFLOW_UUID, revision: 3 } })
    expect(request).toHaveBeenCalledWith(
      `/api/v1/workflows/${WORKFLOW_UUID}/graph`,
      undefined
    )
  })

  /** 保存只发送 Go Backend 接受的整图字段，并安装响应中的新 revision。 */
  it('saves the complete graph with revision CAS', async () => {
    const request = vi.fn().mockResolvedValue({ code: 0, data: graph(4) })
    const source = graph(3)
    source.nodes[0]!.derived_display_name = '不能回写的派生字段'

    await expect(saveBackendEditableWorkflowGraph(
      mockHttp(request),
      WORKFLOW_UUID,
      source
    )).resolves.toMatchObject({ workflow: { revision: 4 } })

    const init = request.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(request.mock.calls[0]?.[0]).toBe(
      `/api/v1/workflows/${WORKFLOW_UUID}/graph`
    )
    expect(body.revision).toBe(3)
    expect(body.nodes[0]).toMatchObject({
      uuid: NODE_UUID,
      name: '混匀',
      disabled: false
    })
    expect(body.nodes[0].derived_display_name).toBeUndefined()
    expect(init.method).toBe('PUT')
  })
})

function graph(revision: number): BackendWorkflowGraph {
  return {
    workflow: { uuid: WORKFLOW_UUID, revision, name: 'Backend 配液' },
    nodes: [{
      uuid: NODE_UUID,
      workflow_node_template_uuid: '30000000-0000-4000-8000-000000000001',
      name: '混匀',
      type: 'device_action',
      pose: { x: 10, y: 20 },
      param: {},
      execution_policy: {},
      disabled: false,
      minimized: false,
      meta_data: {}
    }],
    edges: [],
    node_templates: [],
    handle_templates: [],
    inventory_requirements: []
  }
}

function mockHttp(request: ReturnType<typeof vi.fn>): HttpClient {
  return {
    request: async <ResponseValue>(
      path: string,
      init?: RequestInit
    ): Promise<ResponseValue> => request(path, init) as Promise<ResponseValue>
  }
}
