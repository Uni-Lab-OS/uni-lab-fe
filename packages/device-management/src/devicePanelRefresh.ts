interface VisibleDeviceActionTask {
  taskUuid: string
  actionRef: string
}

interface DevicePanelRefreshOperations {
  refreshDevices: () => Promise<unknown>
  refreshCatalog: () => Promise<unknown>
  activeTask: VisibleDeviceActionTask | null
  refreshTask: (taskUuid: string, actionRef: string) => Promise<unknown>
}

/**
 * 将设备面板的刷新语义收敛为目录、动作目录与当前任务的一次权威补读。
 *
 * @param operations 可独立失败的目录与 Task 补读操作。
 * @returns 所有刷新操作结算后返回；单个来源失败不会阻断其他来源。
 */
export async function refreshDevicePanelState(
  operations: DevicePanelRefreshOperations
): Promise<void> {
  const refreshes: Promise<unknown>[] = [
    operations.refreshDevices(),
    operations.refreshCatalog()
  ]
  if (operations.activeTask) {
    refreshes.push(operations.refreshTask(
      operations.activeTask.taskUuid,
      operations.activeTask.actionRef
    ))
  }
  await Promise.allSettled(refreshes)
}
