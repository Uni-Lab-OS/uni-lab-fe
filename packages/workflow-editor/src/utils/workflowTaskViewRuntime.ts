import type {
  BackendWorkflowGraph,
  WorkflowRuntimePort,
  WorkflowTask
} from '@unilab/services'

/**
 * 为一个已创建的工作流任务（WorkflowTask）构造只读运行端口。
 *
 * @param runtime Backend 权威工作流端口，用于补读指定任务及其作业状态。
 * @param task 选中任务；其 UUID 固定运行投影，其快照固定工作流定义版本。
 * @returns 仅向工作流界面暴露该任务及其冻结工作流图的端口。
 * @throws 任务快照缺少工作流身份、版本或图数组时，读取工作流图会失败。
 */
export function createWorkflowTaskViewRuntime(
  runtime: WorkflowRuntimePort,
  task: WorkflowTask
): WorkflowRuntimePort {
  // 任务 UUID 界定运行状态的唯一读取范围，不能被同工作流的新任务替换。
  const taskUuid = task.uuid
  // 工作流 UUID 校验冻结快照归属，防止跨工作流展示错误定义。
  const workflowUuid = task.workflow_uuid

  return {
    ...runtime,
    getBackendWorkflowGraph: async (requestedWorkflowUuid) => {
      if (requestedWorkflowUuid !== workflowUuid) {
        throw new Error('任务工作流身份与请求不一致')
      }
      return workflowTaskSnapshotGraph(task)
    },
    saveBackendWorkflowGraph: async () => {
      throw new Error('工作流任务快照只读，不能覆盖当前工作流定义')
    },
    listWorkflowTasks: async (query) => {
      if (query?.workflow_uuid !== workflowUuid) {
        return runtime.listWorkflowTasks(query)
      }
      return {
        items: [task],
        total: 1,
        page: query.page ?? 1,
        page_size: query.page_size ?? 1
      }
    },
    subscribeWorkflowRuntime: (onInvalidate, options) =>
      runtime.subscribeWorkflowRuntime((event) => {
        if (
          event.event === 'workflow.runtime.changed' &&
          event.data.workflow_task_uuid === taskUuid
        ) onInvalidate(event)
      }, options)
  }
}

/**
 * 校验并返回任务创建时冻结的工作流图。
 *
 * @param task 带有 Backend `workflow_snapshot` 持久事实的工作流任务。
 * @returns 可由现有工作流画布读取、但不得保存的 Backend 工作流图。
 * @throws 快照不是该任务所属工作流的完整图时抛出可行动错误。
 */
export function workflowTaskSnapshotGraph(
  task: WorkflowTask
): BackendWorkflowGraph {
  // 冻结快照是任务执行的定义权威，不能改为读取工作流当前版本。
  const snapshot = task.workflow_snapshot
  const workflow = record(snapshot.workflow)
  if (
    workflow.uuid !== task.workflow_uuid ||
    !Number.isSafeInteger(workflow.revision) ||
    !Array.isArray(snapshot.nodes) ||
    !Array.isArray(snapshot.edges) ||
    !Array.isArray(snapshot.node_templates) ||
    !Array.isArray(snapshot.handle_templates)
  ) {
    throw new Error('工作流任务快照不完整，无法显示对应工作流界面')
  }
  return snapshot as unknown as BackendWorkflowGraph
}

/**
 * 把未知快照字段收窄为只读键值对象。
 *
 * @param value Backend 返回的未知 JSON 值。
 * @returns 对象值；非对象返回空对象，供调用方统一执行合同校验。
 */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
