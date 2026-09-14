import type {
  WorkflowExecutionTask,
  WorkflowRuntimeInvalidationEvent,
  WorkflowRuntimePort
} from '@unilab/services'
import { describe, expect, it, vi } from 'vitest'

import {
  createWorkflowTaskViewRuntime,
  workflowTaskSnapshotGraph
} from './workflowTaskViewRuntime'

const WORKFLOW_UUID = '10000000-0000-4000-8000-000000000001'
const TASK_UUID = '20000000-0000-4000-8000-000000000002'

describe('workflowTaskViewRuntime', () => {
  /** 任务工作流界面必须读取创建时冻结的图，而不是工作流当前版本。 */
  it('projects the frozen workflow snapshot as a read-only graph', async () => {
    const task = workflowTask()
    const runtime = createWorkflowTaskViewRuntime(
      {} as WorkflowRuntimePort,
      task
    )

    await expect(runtime.getBackendWorkflowGraph(WORKFLOW_UUID)).resolves
      .toEqual(task.workflow_snapshot)
    await expect(runtime.saveBackendWorkflowGraph(
      WORKFLOW_UUID,
      workflowTaskSnapshotGraph(task)
    )).rejects.toThrow('工作流任务快照只读')
  })

  /** 嵌入画布发现任务时必须锁定选中任务，不能切换到同工作流的新任务。 */
  it('locks task discovery to the selected WorkflowTask identity', async () => {
    const task = workflowTask()
    const listWorkflowTasks = vi.fn()
    const runtime = createWorkflowTaskViewRuntime({
      listWorkflowTasks
    } as unknown as WorkflowRuntimePort, task)

    await expect(runtime.listWorkflowTasks({
      workflow_uuid: WORKFLOW_UUID,
      page: 1,
      page_size: 1
    })).resolves.toMatchObject({ items: [task], total: 1 })
    expect(listWorkflowTasks).not.toHaveBeenCalled()
  })

  /** 全局失效事件只允许选中任务更新右侧运行投影。 */
  it('forwards only the selected task runtime invalidation', () => {
    let sourceListener: (
      event: WorkflowRuntimeInvalidationEvent
    ) => void = () => undefined
    const subscribeWorkflowRuntime = vi.fn((listener) => {
      sourceListener = listener
      return { dispose: vi.fn() }
    })
    const runtime = createWorkflowTaskViewRuntime({
      subscribeWorkflowRuntime
    } as unknown as WorkflowRuntimePort, workflowTask())
    const received: WorkflowRuntimeInvalidationEvent[] = []
    runtime.subscribeWorkflowRuntime((event) => received.push(event))

    sourceListener(runtimeChanged('另一个任务'))
    sourceListener(runtimeChanged(TASK_UUID))
    sourceListener({
      id: 'definition-change',
      event: 'workflow.definition.changed',
      data: { workflow_uuid: WORKFLOW_UUID, workflow_revision: 2 }
    })

    expect(received).toEqual([runtimeChanged(TASK_UUID)])
  })

  /** 不完整或跨工作流快照必须失败关闭，不能展示误导性画布。 */
  it('rejects an incomplete frozen workflow snapshot', () => {
    const task = workflowTask()
    task.workflow_snapshot = { workflow: { uuid: WORKFLOW_UUID } }

    expect(() => workflowTaskSnapshotGraph(task)).toThrow(
      '工作流任务快照不完整'
    )
  })
})

/**
 * 构造一条带完整冻结图的工作流任务测试事实。
 *
 * @returns UUID、生命周期状态与快照均稳定的工作流任务。
 */
function workflowTask(): WorkflowExecutionTask {
  return {
    uuid: TASK_UUID,
    create_time: '2026-08-19T12:00:00+08:00',
    update_time: '2026-08-19T12:00:00+08:00',
    description: '冻结快照测试任务',
    meta_data: {},
    execution_kind: 'workflow',
    workflow_uuid: WORKFLOW_UUID,
    status: 'pending',
    workflow_snapshot: {
      workflow: {
        uuid: WORKFLOW_UUID,
        revision: 1,
        name: '冻结工作流'
      },
      nodes: [],
      edges: [],
      node_templates: [],
      handle_templates: [],
      inventory_requirements: []
    },
    execution_plan: {},
    run_mode: 'normal',
    control_status: 'active',
    cleanup_status: 'none',
    trace_context: {},
    error_info: []
  }
}

/**
 * 构造指定任务身份的工作流运行失效事件。
 *
 * @param taskUuid 需要 Backend 补读的工作流任务 UUID。
 * @returns 可交给运行订阅监听器的失效事件。
 */
function runtimeChanged(taskUuid: string): WorkflowRuntimeInvalidationEvent {
  return {
    id: `event:${taskUuid}`,
    event: 'workflow.runtime.changed',
    data: { workflow_task_uuid: taskUuid }
  }
}
