import type { DeviceActionRunView } from '@unilab-fe/core'

/** 测试用的单动作运行视图（仅测试导入）。 */
export function runView(
  task: Partial<DeviceActionRunView['task']>,
  job: Partial<DeviceActionRunView['job']>,
): DeviceActionRunView {
  return {
    kind: 'device_action_run_view',
    source: 'os',
    task: {
      kind: 'task_runtime_detail',
      source: 'os',
      taskUuid: 'task-1',
      workflowUuid: null,
      executionKind: 'device_action',
      status: 'running',
      runMode: 'normal',
      controlStatus: 'active',
      cleanupStatus: 'none',
      createdAt: '',
      updatedAt: '',
      raw: {},
      ...task,
    },
    job: {
      kind: 'task_job_summary',
      source: 'os',
      jobUuid: 'job-1',
      workflowNodeUuid: 'node-1',
      topologicalIndex: 0,
      executorKind: 'device',
      status: 'pending',
      attempt: 1,
      currentAttempt: true,
      controlData: {},
      errorInfo: [],
      waitReason: {},
      expectedChangeSet: {},
      raw: {},
      ...job,
    },
  }
}
