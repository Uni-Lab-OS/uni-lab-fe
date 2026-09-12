import type {
  WorkflowEventSubscription,
  WorkflowRuntimeInvalidationEvent,
  WorkflowRuntimePort,
  WorkflowTask,
  WorkflowTaskPage
} from '@unilab/services'

/** 初次读取、手动刷新和 SSE 共用一个串行通道；销毁后不再发出排队请求。 */
export function createWorkflowTaskPageLoader(runtime: WorkflowRuntimePort) {
  let active = true
  let generation = 0
  let latestPage: WorkflowTaskPage | null = null
  let tail: Promise<unknown> = Promise.resolve()
  return {
    read: (query: Parameters<WorkflowRuntimePort['listWorkflowTasks']>[0]): Promise<WorkflowTaskPage> => {
      const requestedGeneration = generation
      const result = tail.then(() => {
        if (!active || generation !== requestedGeneration) throw new Error('任务列表已关闭')
        return (runtime.listWorkflowTaskPresentations ?? runtime.listWorkflowTasks)(query).then((page) => {
          if (active && generation === requestedGeneration) latestPage = page
          return page
        })
      })
      tail = result.catch(() => undefined)
      return result
    },
    isCurrent: (page: WorkflowTaskPage) => active && latestPage === page,
    activate: () => {
      generation++
      active = true
      latestPage = null
    },
    dispose: () => { active = false }
  }
}

export interface WorkflowTaskListUpdateHandlers {
  onPage: (page: WorkflowTaskPage) => void
  onRecovered?: () => void
  onError: (message: string) => void
}

/** 全页摘要刷新合并所有失效事件；最多一个请求在途，新事件保留一次尾随补读。 */
export function subscribeWorkflowTaskListUpdates(
  runtime: WorkflowRuntimePort,
  handlers: WorkflowTaskListUpdateHandlers,
  query = { page: 1, page_size: 100, execution_kind: 'workflow' as const },
  sharedLoader?: ReturnType<typeof createWorkflowTaskPageLoader>
): WorkflowEventSubscription {
  const loader = sharedLoader ?? createWorkflowTaskPageLoader(runtime)
  let active = true
  let running = false
  let dirty = false
  let pageError: string | null = null
  let connectionError: string | null = null
  const publishErrors = (): void => {
    if (!active) return
    const message = [connectionError, pageError].filter(Boolean).join('；')
    if (message) handlers.onError(message)
    else handlers.onRecovered?.()
  }
  const drain = async (): Promise<void> => {
    if (!active || running) return
    running = true
    try {
      while (active && dirty) {
        dirty = false
        try {
          const page = await loader.read(query)
          if (!active) return
          handlers.onPage(page)
          pageError = null
          publishErrors()
        } catch (error) {
          if (!active) return
          pageError = `任务列表状态补读失败：${errorMessage(error)}`
          publishErrors()
        }
      }
    } finally {
      running = false
    }
  }
  const handleInvalidation = (event: WorkflowRuntimeInvalidationEvent): void => {
    if (!active || event.event !== 'workflow.runtime.changed') return
    dirty = true
    void drain()
  }
  let subscription: WorkflowEventSubscription
  try {
    subscription = runtime.subscribeWorkflowRuntime(handleInvalidation, {
      onOpen: () => {
        if (!active) return
        connectionError = null
        // 恢复连接也补读当前权威页，不假定历史事件完整交付。
        dirty = true
        void drain()
      },
      onError: (error) => {
        connectionError = `任务状态实时同步中断：${error.message}；可手动刷新`
        publishErrors()
      }
    })
  } catch (error) {
    connectionError = `任务状态实时同步不可用：${errorMessage(error)}；可手动刷新`
    publishErrors()
    subscription = { dispose: () => undefined }
  }
  return {
    dispose: () => {
      active = false
      dirty = false
      if (!sharedLoader) loader.dispose()
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
