import type { WorkflowIntervention, WorkflowRuntimePort } from '@unilab/services'

export interface InterventionViewState {
  items: WorkflowIntervention[]
  minimized: boolean
  busy: string | null
  error: string | null
  messages: Record<string, string>
  offline?: boolean
  replayable?: string[]
}

/** 保存服务端投影与展示偏好；任何响应缺失、断网或决定接受均不关闭干预。 */
export function createWorkflowInterventionController(runtime: WorkflowRuntimePort) {
  let state: InterventionViewState = { items: [], minimized: false, busy: null, error: null, messages: {} }
  const listeners = new Set<() => void>()
  const keys = new Map<string, string>()
  let disposed = false
  let hostOnline = true
  let eventsOnline = true
  let pendingRefresh: Promise<void> | undefined
  let refreshAgain = false
  const update = (patch: Partial<InterventionViewState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    state.replayable = state.items.filter(item => item.status === 'selected' && item.delivery_status === 'unknown'
      && item.selected_option_id && keys.has(`${item.uuid}:${item.revision}:${item.selected_option_id}`)).map(item => item.uuid)
    for (const listener of listeners) listener()
  }
  const readProjection = async (): Promise<void> => {
    if (!runtime.interventions || disposed || !hostOnline) return
    try {
      do {
        refreshAgain = false
        const [open, selected] = await Promise.all([
          runtime.interventions.list('open'), runtime.interventions.list('selected')
        ])
        const found = new Map([...open, ...selected].map(item => [item.uuid, item]))
        // 列表不是关闭凭据；逐条读取消失项，只有权威 superseded 才移除。
        for (const previous of state.items) {
          if (!found.has(previous.uuid)) found.set(previous.uuid, await runtime.interventions.get(previous.uuid))
        }
        const items = [...found.values()].filter(item => item.status !== 'superseded')
        const messages = { ...state.messages }
        let detailError: string | null = null
        await Promise.all(items.map(async item => {
          if (item.description) { messages[item.uuid] = item.description; return }
          const report = item.meta_data.error_report
          if (report && typeof report === 'object' && 'error_message' in report && typeof report.error_message === 'string') {
            messages[item.uuid] = report.error_message
            return
          }
          try {
            const job = await runtime.getWorkflowNodeJob(item.workflow_node_job_uuid)
            messages[item.uuid] = job.error_info.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n')
          } catch (error) { detailError = errorMessage(error) }
        }))
        if (!hostOnline) return
        update({ items, messages, offline: !eventsOnline, error: !eventsOnline ? '事件连接离线，等待重连。' : detailError ?? (open.length === 500 || selected.length === 500
          ? '干预列表达到服务端查询上限，可能还有未展示项目；请先处理当前干预。' : null) })
      } while (refreshAgain && !disposed)
    } catch (error) { update({ error: errorMessage(error) }) }
  }
  const refresh = (): Promise<void> => {
    if (pendingRefresh) { refreshAgain = true; return pendingRefresh }
    pendingRefresh = readProjection().finally(() => { pendingRefresh = undefined })
    return pendingRefresh
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    minimize: () => update({ minimized: true }),
    restore: () => update({ minimized: false }),
    setOnline: (online: boolean) => {
      if (!runtime.interventions) return
      hostOnline = online
      if (!online) update({ offline: true, error: '工作区宿主离线；保留未决干预，恢复连接后重新读取。' })
      if (online) void refresh()
    },
    refresh,
    start: () => {
      disposed = false
      if (!runtime.interventions) return () => {}
      const subscription = runtime.subscribeWorkflowRuntime(event => {
        if (event.event === 'workflow.runtime.changed') void refresh()
      }, { onOpen: () => { eventsOnline = true; if (hostOnline) void refresh() },
        onError: error => { eventsOnline = false; update({ offline: true, error: errorMessage(error) }) } })
      void refresh()
      return () => { disposed = true; subscription.dispose() }
    },
    decide: async (uuid: string, optionId: string) => {
      const item = state.items.find(candidate => candidate.uuid === uuid)
      if (!item || !runtime.interventions || state.busy || state.offline) return
      const identity = `${uuid}:${item.revision}:${optionId}`
      const replay = item.status === 'selected' && item.delivery_status === 'unknown'
        && item.selected_option_id === optionId && keys.has(identity)
      if (item.status !== 'open' && !replay) return
      const key = keys.get(identity) ?? globalThis.crypto.randomUUID()
      keys.set(identity, key)
      update({ busy: uuid, error: null })
      try {
        const response = await runtime.interventions.decide(uuid, { revision: item.revision, option_id: optionId }, key)
        update({ items: state.items.map(previous => previous.uuid === uuid ? response.intervention : previous) })
        await refresh()
      } catch (error) {
        // 请求结果不确定时先重读；不乐观恢复 open，也不把 HTTP 接受当作完成。
        await refresh()
        update({ error: errorMessage(error) })
      } finally { update({ busy: null }) }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
