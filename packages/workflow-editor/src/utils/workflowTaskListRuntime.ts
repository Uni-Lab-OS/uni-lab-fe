import type {
  WorkflowEventSubscription,
  WorkflowRuntimeInvalidationEvent,
  WorkflowRuntimePort,
  WorkflowTask,
  WorkflowTaskPage
} from '@unilab/services'

export interface WorkflowTaskListUpdateHandlers {
  onTask: (task: WorkflowTask) => void
  onOpen?: () => void
  onError: (message: string) => void
}

/**
 * 订阅工作流运行时失效事件，并精确补读对应工作流任务的权威状态。
 *
 * @param runtime Backend 工作流运行端口。
 * @param handlers 任务补读、连接恢复和错误投影回调。
 * @returns 可释放全局服务器发送事件（SSE）订阅的句柄。
 */
export function subscribeWorkflowTaskListUpdates(
  runtime: WorkflowRuntimePort,
  handlers: WorkflowTaskListUpdateHandlers
): WorkflowEventSubscription {
  let active = true
  const taskSequences = new Map<string, number>()

  /**
   * 从 Backend 补读单个失效任务，忽略同一任务更早返回的响应。
   *
   * @param taskUuid 失效事件携带的工作流任务身份。
   * @returns 补读完成后的 Promise；错误通过任务列表错误回调呈现。
   */
  const rehydrateTask = async (taskUuid: string): Promise<void> => {
    const sequence = (taskSequences.get(taskUuid) ?? 0) + 1
    taskSequences.set(taskUuid, sequence)
    try {
      const task = await runtime.getWorkflowTask(taskUuid)
      if (!active || taskSequences.get(taskUuid) !== sequence) return
      handlers.onTask(task)
    } catch (error) {
      if (!active || taskSequences.get(taskUuid) !== sequence) return
      handlers.onError(
        `工作流任务 ${shortTaskIdentity(taskUuid)} 状态补读失败：${errorMessage(error)}`
      )
    }
  }

  /**
   * 处理全局运行时失效事件；事件本身不携带也不推断任务状态。
   *
   * @param event 全局服务器发送事件（SSE）失效通知。
   * @returns 无返回值；匹配事件会异步触发精确补读。
   */
  const handleInvalidation = (
    event: WorkflowRuntimeInvalidationEvent
  ): void => {
    if (event.event !== 'workflow.runtime.changed') return
    void rehydrateTask(event.data.workflow_task_uuid)
  }

  /** 连接建立或恢复后清除任务列表的实时连接错误。 */
  const handleOpen = (): void => handlers.onOpen?.()

  /**
   * 将实时连接错误转换为可行动的用户提示。
   *
   * @param error 运行时订阅返回的连接异常。
   * @returns 无返回值；任务列表保留上一份权威投影供人工刷新。
   */
  const handleSubscriptionError = (error: Error): void => {
    handlers.onError(`任务状态实时同步中断：${error.message}；可手动刷新`)
  }

  let subscription: WorkflowEventSubscription
  try {
    subscription = runtime.subscribeWorkflowRuntime(handleInvalidation, {
      onOpen: handleOpen,
      onError: handleSubscriptionError
    })
  } catch (error) {
    handlers.onError(
      `任务状态实时同步不可用：${errorMessage(error)}；可手动刷新`
    )
    subscription = { dispose: () => undefined }
  }

  return {
    /** 停止交付延迟补读结果，并释放底层全局服务器发送事件连接。 */
    dispose: () => {
      active = false
      subscription.dispose()
    }
  }
}

/**
 * 把单个 Backend 权威任务状态合并进当前列表页。
 *
 * @param page 当前任务列表页。
 * @param task 服务器发送事件（SSE）失效后精确补读的工作流任务。
 * @returns 保留并行兄弟任务、更新或插入目标任务的新列表页。
 */
export function mergeWorkflowTaskPage(
  page: WorkflowTaskPage,
  task: WorkflowTask
): WorkflowTaskPage {
  const existingIndex = page.items.findIndex((item) => item.uuid === task.uuid)
  if (existingIndex >= 0) {
    return {
      ...page,
      items: page.items.map((item, index) =>
        index === existingIndex ? task : item
      )
    }
  }
  return {
    ...page,
    items: [task, ...page.items].slice(0, page.page_size),
    total: page.total + 1
  }
}

/** 将异常值转换为可展示文本。 */
function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** 返回工作流任务身份的稳定短显示形式。 */
function shortTaskIdentity(taskUuid: string): string {
  return taskUuid.length > 8 ? taskUuid.slice(-8) : taskUuid
}
