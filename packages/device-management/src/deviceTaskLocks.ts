import type {
  WorkflowRuntimePort,
  WorkflowTask,
  WorkflowTaskExecutionLocks
} from '@unilab/services'

export interface DeviceTaskLockOwner {
  taskUuid: string
  description: string
  status: string
  deviceIds: string[]
  locks: WorkflowTaskExecutionLocks
  canUnlock: boolean
}

export interface DeviceTaskLockSnapshot {
  owners: DeviceTaskLockOwner[]
  lockedDeviceIds: Set<string>
  known: boolean
}

/** 只把权威设备锁映射为仪器身份；任务计划中的目标不是已取得的锁。 */
export function projectDeviceTaskLocks(
  task: WorkflowTask,
  locks: WorkflowTaskExecutionLocks,
  instrumentIds: ReadonlySet<string>
): DeviceTaskLockOwner {
  const deviceIds = [...new Set(locks.locks.flatMap(lock =>
    lock.material_uuid && instrumentIds.has(lock.material_uuid)
      ? [lock.material_uuid]
      : []
  ))]
  return {
    taskUuid: task.uuid,
    description: task.description || task.uuid,
    status: locks.task_status,
    deviceIds,
    locks,
    canUnlock: ['failed', 'canceled', 'timeout'].includes(locks.task_status)
  }
}

/** 遍历所有任务页，保留异常终态仍持有的资源；读取失败不能解释为空闲。 */
export async function loadDeviceTaskLocks(
  runtime: WorkflowRuntimePort,
  instrumentIds: ReadonlySet<string>
): Promise<DeviceTaskLockSnapshot> {
  if (!runtime.executionLocks) throw new Error('当前环境不支持任务资源锁读取')
  const owners: DeviceTaskLockOwner[] = []
  let page = 1
  let read = 0
  while (true) {
    const tasks = await (runtime.listWorkflowTaskPresentations ?? runtime.listWorkflowTasks)({
      page,
      page_size: 100
    })
    for (const task of tasks.items) {
      // OS 只在执行锁、资源区间与设备托管全部结清后标记 settled。
      if (['succeeded', 'failed', 'canceled', 'timeout'].includes(task.status)
        && task.cleanup_status === 'settled') continue
      const locks = await runtime.executionLocks.list(task.uuid)
      if (locks.locks.length || locks.active_device_tenancy_count) {
        owners.push(projectDeviceTaskLocks(task, locks, instrumentIds))
      }
    }
    read += tasks.items.length
    if (read >= tasks.total) break
    if (!tasks.items.length) throw new Error('任务目录不完整，请刷新后重试')
    page += 1
  }
  return {
    owners,
    lockedDeviceIds: new Set(owners.flatMap(owner => owner.deviceIds)),
    known: owners.every(owner => owner.locks.active_device_tenancy_count === 0
      && owner.locks.locks.every(lock => lock.scope !== 'device' || lock.material_uuid !== null))
  }
}
