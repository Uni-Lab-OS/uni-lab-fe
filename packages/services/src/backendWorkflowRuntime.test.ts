import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from './http'
import {
  backendWorkflowTaskCreateBody,
  loadBackendWorkflowNodeJobFeedback,
  loadBackendWorkflowRunPreflight
} from './backendWorkflowRuntime'
import { loadBackendWorkflowRunPreparation } from './backendWorkflowDefinition'
import type { WorkflowNodeJobFeedback } from './workflowTaskContracts'

const JOB_UUID = '30000000-0000-4000-8000-000000000001'
const WORKFLOW_UUID = '50000000-0000-4000-8000-000000000001'
const NODE_UUID = '60000000-0000-4000-8000-000000000001'
const TARGET_NODE_UUID = '60000000-0000-4000-8000-000000000002'
const TEMPLATE_UUID = '30000000-0000-4000-8000-000000000001'
const SOURCE_HANDLE_UUID = '40000000-0000-4000-8000-000000000001'
const TARGET_HANDLE_UUID = '40000000-0000-4000-8000-000000000002'
const EDGE_UUID = '70000000-0000-4000-8000-000000000001'
const MATERIAL_TEMPLATE_UUID = '30000000-0000-4000-8000-000000000009'
const MOUNT_UUID = '10000000-0000-4000-8000-000000000009'
const RESOURCE_TEMPLATE_UUID = '20000000-0000-4000-8000-000000000009'

describe('Backend 工作流运行 adapter', () => {
  /** 空任务输入可安全省略，并为 Backend 补齐库存绑定数组。 */
  it('只省略空任务输入并补齐库存绑定数组', () => {
    expect(backendWorkflowTaskCreateBody({
      workflow_uuid: WORKFLOW_UUID,
      run_mode: 'normal',
      input: {},
      description: '演示任务'
    })).toEqual({
      workflow_uuid: WORKFLOW_UUID,
      run_mode: 'normal',
      inventory_bindings: [],
      description: '演示任务'
    })
  })

  /** 非空输入不能被静默丢弃，否则运行含义会在前后端之间漂移。 */
  it('拒绝 Backend 尚未实现的非空任务输入', () => {
    expect(() => backendWorkflowTaskCreateBody({
      workflow_uuid: WORKFLOW_UUID,
      run_mode: 'normal',
      input: { sample_count: 3 }
    })).toThrowError('Backend 当前不接受工作流任务输入')
  })

  /** 单节点运行必须携带精确目标，其他运行模式不能越界携带目标。 */
  it('关闭失败处理单节点目标范围错误', () => {
    expect(() => backendWorkflowTaskCreateBody({
      workflow_uuid: WORKFLOW_UUID,
      run_mode: 'single_node'
    })).toThrowError('单节点运行必须明确选择目标工作流节点')
    expect(() => backendWorkflowTaskCreateBody({
      workflow_uuid: WORKFLOW_UUID,
      run_mode: 'step',
      target_node_uuid: NODE_UUID
    })).toThrowError('只有单节点运行可以指定目标工作流节点')
  })

  /** 工作流图投影运行选择与 dev 风格只读画布需要的节点、端口和连线事实。 */
  it('从 Backend 工作流图生成正式运行与只读画布快照', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: backendGraph()
    })

    await expect(loadBackendWorkflowRunPreparation(
      mockHttp(request),
      WORKFLOW_UUID
    )).resolves.toEqual({
      workflow_uuid: WORKFLOW_UUID,
      workflow_revision: 3,
      nodes: [{
        workflow_node_uuid: NODE_UUID,
        workflow_node_template_uuid: TEMPLATE_UUID,
        name: '加热至 60°C',
        type: 'device_action',
        disabled: false,
        description: '加热演示节点',
        action_name: 'auto-heat_chill',
        action_type: 'UniLabJsonCommandAsync',
        position: { x: 90, y: 150 },
        handles: [{
          uuid: SOURCE_HANDLE_UUID,
          handle_key: 'output',
          display_name: '输出',
          io_type: 'source',
          value_type: 'ResourceSlot',
          data_key: 'sample'
        }, {
          uuid: TARGET_HANDLE_UUID,
          handle_key: 'input',
          display_name: '输入',
          io_type: 'target',
          value_type: 'ResourceSlot'
        }]
      }, {
        workflow_node_uuid: TARGET_NODE_UUID,
        workflow_node_template_uuid: TEMPLATE_UUID,
        name: '输送 5 mL',
        type: 'device_action',
        disabled: false,
        handles: [{
          uuid: SOURCE_HANDLE_UUID,
          handle_key: 'output',
          display_name: '输出',
          io_type: 'source',
          value_type: 'ResourceSlot',
          data_key: 'sample'
        }, {
          uuid: TARGET_HANDLE_UUID,
          handle_key: 'input',
          display_name: '输入',
          io_type: 'target',
          value_type: 'ResourceSlot'
        }]
      }],
      edges: [{
        uuid: EDGE_UUID,
        source_node_uuid: NODE_UUID,
        target_node_uuid: TARGET_NODE_UUID,
        source_handle_uuid: SOURCE_HANDLE_UUID,
        target_handle_uuid: TARGET_HANDLE_UUID
      }]
    })
    expect(request).toHaveBeenCalledWith(
      `/api/v1/workflows/${WORKFLOW_UUID}/graph`,
      undefined
    )
  })

  /**
   * Backend 物料来源（MaterialSource）的角色与挂载身份必须进入共享画布，
   * 否则主样品蛇形和完整支线控件会因缺少谱系而静默消失。
   */
  it('保留 Backend 物料来源角色并归一物料占位符', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        workflow: { uuid: WORKFLOW_UUID, revision: 3 },
        nodes: [{
          uuid: NODE_UUID,
          workflow_node_template_uuid: MATERIAL_TEMPLATE_UUID,
          name: '主样品',
          type: 'material_source',
          disabled: false,
          param: {
            mode: 'existing',
            resource_template_uuid: RESOURCE_TEMPLATE_UUID,
            mount: { uuid: MOUNT_UUID },
            material_uuid: null,
            site: null,
            slot_range: null,
            flow_role: 'primary_sample',
            custody_policy: 'shared_source'
          }
        }],
        edges: [],
        handle_templates: [{
          uuid: SOURCE_HANDLE_UUID,
          workflow_node_template_uuid: MATERIAL_TEMPLATE_UUID,
          handle_key: 'material',
          display_name: 'Material',
          io_type: 'source',
          type: 'material',
          required: false,
          data_key: 'material'
        }]
      }
    })

    await expect(loadBackendWorkflowRunPreparation(
      mockHttp(request),
      WORKFLOW_UUID
    )).resolves.toMatchObject({
      nodes: [{
        workflow_node_uuid: NODE_UUID,
        material_source: {
          mode: 'existing',
          resource_template_uuid: RESOURCE_TEMPLATE_UUID,
          mount_uuid: MOUNT_UUID,
          flow_role: 'primary_sample',
          custody_policy: 'shared_source'
        },
        handles: [{
          uuid: SOURCE_HANDLE_UUID,
          value_type: 'ResourceSlot',
          data_key: 'material'
        }]
      }]
    })
  })

  /** 重复节点身份会使目标选择含糊，必须在前端合同边界拒绝。 */
  it('拒绝 Backend 工作流图中的重复节点身份', async () => {
    const node = {
      uuid: NODE_UUID,
      name: '加热至 60°C',
      type: 'device_action',
      disabled: false
    }
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        workflow: { uuid: WORKFLOW_UUID, revision: 3 },
        nodes: [node, node],
        edges: [],
        handle_templates: []
      }
    })

    await expect(loadBackendWorkflowRunPreparation(
      mockHttp(request),
      WORKFLOW_UUID
    )).rejects.toMatchObject({
      code: 'INVALID_BACKEND_WORKFLOW_RUN_PREPARATION'
    })
  })

  /** 单节点候选范围通过查询参数预检，并严格回读相同目标。 */
  it('读取 Backend 单节点运行预检', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: runPreflightReport()
    })

    await expect(loadBackendWorkflowRunPreflight(
      mockHttp(request),
      WORKFLOW_UUID,
      'single_node',
      NODE_UUID
    )).resolves.toEqual(runPreflightReport())
    expect(request).toHaveBeenCalledWith(
      `/api/v1/workflows/${WORKFLOW_UUID}/run-preflight?run_mode=single_node&target_node_uuid=${NODE_UUID}`,
      undefined
    )
  })

  /** 响应中的候选范围必须与请求完全一致，避免运行错误节点。 */
  it('拒绝身份漂移的 Backend 运行预检', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: { ...runPreflightReport(), target_node_uuid: JOB_UUID }
    })

    await expect(loadBackendWorkflowRunPreflight(
      mockHttp(request),
      WORKFLOW_UUID,
      'single_node',
      NODE_UUID
    )).rejects.toMatchObject({
      code: 'INVALID_BACKEND_WORKFLOW_RUN_PREFLIGHT'
    })
  })

  /** 页码反馈必须投影为严格递增的反馈序号游标。 */
  it('遍历 Backend 页码并投影为严格递增的反馈游标', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(numberedPage([feedback(1), feedback(2)], true, 1))
      .mockResolvedValueOnce(numberedPage([feedback(3), feedback(4)], false, 2))

    await expect(loadBackendWorkflowNodeJobFeedback(
      mockHttp(request),
      JOB_UUID,
      { after_sequence: 2, limit: 1 }
    )).resolves.toEqual({
      items: [feedback(3)],
      next_cursor: 3,
      has_more: true
    })
    expect(request).toHaveBeenNthCalledWith(
      1,
      `/api/v1/workflow-node-jobs/${JOB_UUID}/feedback?page=1&page_size=500`,
      undefined
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/api/v1/workflow-node-jobs/${JOB_UUID}/feedback?page=2&page_size=500`,
      undefined
    )
  })

  /** Backend 页码不能跳跃，否则前端可能遗漏持久反馈。 */
  it('拒绝 Backend 未推进的反馈页码合同', async () => {
    const request = vi.fn().mockResolvedValue(numberedPage([], true, 2))

    await expect(loadBackendWorkflowNodeJobFeedback(
      mockHttp(request),
      JOB_UUID
    )).rejects.toMatchObject({ code: 'INVALID_BACKEND_WORKFLOW_FEEDBACK' })
  })
})

/** 构造一个可用于游标断言的 Backend 节点反馈。 */
function feedback(sequence: number): WorkflowNodeJobFeedback {
  return {
    uuid: `40000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    create_time: '2026-08-12T00:00:00Z',
    update_time: '2026-08-12T00:00:00Z',
    meta_data: {},
    workflow_node_job_uuid: JOB_UUID,
    sequence,
    feedback_type: 'progress',
    data: { progress: sequence * 25 },
    observed_at: '2026-08-12T00:00:00Z',
    received_at: '2026-08-12T00:00:00Z',
    idempotency_key: `feedback-${sequence}`
  }
}

/** 构造 Backend 当前使用的页码反馈 envelope。 */
function numberedPage(
  items: WorkflowNodeJobFeedback[],
  hasMore: boolean,
  page: number
): { code: number; data: Record<string, unknown> } {
  return {
    code: 0,
    data: {
      items,
      has_more: hasMore,
      page,
      page_size: 500
    }
  }
}

/** 构造只记录调用并返回 fixture 的最小 HTTP 客户端。 */
function mockHttp(request: ReturnType<typeof vi.fn>): HttpClient {
  return { request }
}

/** 构造通过的单节点 Backend 运行预检报告。 */
function runPreflightReport(): Record<string, unknown> {
  return {
    workflow_uuid: WORKFLOW_UUID,
    workflow_revision: 3,
    run_mode: 'single_node',
    target_node_uuid: NODE_UUID,
    status: 'ready',
    can_run: true,
    checked_at: '2026-08-12T00:00:00Z',
    summary: {
      execution_node_count: 1,
      passed_check_count: 2,
      blocking_check_count: 0,
      deferred_check_count: 1,
      confirmation_required_count: 0
    },
    checks: [{
      type: 'device',
      status: 'passed',
      code: 'device_ready',
      message: '设备在线且支持节点动作',
      blocking: false,
      node_uuid: NODE_UUID,
      node_name: '加热至 60°C',
      details: { action_name: 'auto-heat_chill' }
    }]
  }
}

/** 构造包含画布节点、端口和有向边的 Backend 工作流定义响应。 */
function backendGraph(): Record<string, unknown> {
  return {
    workflow: { uuid: WORKFLOW_UUID, revision: 3 },
    nodes: [{
      uuid: NODE_UUID,
      workflow_node_template_uuid: TEMPLATE_UUID,
      name: '加热至 60°C',
      type: 'device_action',
      disabled: false,
      description: '加热演示节点',
      action_name: 'auto-heat_chill',
      action_type: 'UniLabJsonCommandAsync',
      pose: { x: 90, y: 150 }
    }, {
      uuid: TARGET_NODE_UUID,
      workflow_node_template_uuid: TEMPLATE_UUID,
      name: '输送 5 mL',
      type: 'device_action',
      disabled: false,
      pose: {}
    }],
    edges: [{
      uuid: EDGE_UUID,
      source_node_uuid: NODE_UUID,
      target_node_uuid: TARGET_NODE_UUID,
      source_handle_uuid: SOURCE_HANDLE_UUID,
      target_handle_uuid: TARGET_HANDLE_UUID
    }],
    handle_templates: [{
      uuid: SOURCE_HANDLE_UUID,
      workflow_node_template_uuid: TEMPLATE_UUID,
      handle_key: 'output',
      display_name: '输出',
      io_type: 'source',
      type: 'material',
      data_key: 'sample'
    }, {
      uuid: TARGET_HANDLE_UUID,
      workflow_node_template_uuid: TEMPLATE_UUID,
      handle_key: 'input',
      display_name: '输入',
      io_type: 'target',
      type: 'material'
    }]
  }
}
